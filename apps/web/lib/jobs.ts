import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { config, jobDirectory, isSafeJobId } from "./config";
import type { AnalysisResult, JobSnapshot } from "./types";

type JobRecord = JobSnapshot & {
  id: string;
  dir: string;
  inputPath: string | null;
  source: "upload" | "url";
  sourceUrl?: string;
  createdAt: number;
  updatedAt: number;
};

const jobs = new Map<string, JobRecord>();
let activeJobs = 0;
let cleanupStarted = false;

function touch(job: JobRecord): void {
  job.updatedAt = Date.now();
}

function newJob(source: JobRecord["source"], sourceUrl?: string): JobRecord {
  const id = randomBytes(12).toString("hex");
  const job: JobRecord = {
    id,
    dir: jobDirectory(id),
    inputPath: null,
    source,
    sourceUrl,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "queued",
    progress: 0,
    stage: "Receiving video",
    result: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

export function getJob(jobId: string): JobRecord | undefined {
  return isSafeJobId(jobId) ? jobs.get(jobId) : undefined;
}

export function getJobSnapshot(jobId: string): JobSnapshot | null {
  const job = getJob(jobId);
  if (!job) return null;
  return { status: job.status, progress: job.progress, stage: job.stage, result: job.result, error: job.error };
}

export async function writeUpload(file: File): Promise<string> {
  ensureCleanupLoop();
  if (!file || typeof file.stream !== "function") throw new Error("No upload was provided.");
  if (file.size <= 0) throw new Error("The uploaded file is empty.");
  if (file.size > config.maxUploadBytes) throw new Error(`Videos must be smaller than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`);

  const job = newJob("upload");
  await fs.mkdir(job.dir, { recursive: true });
  const inputPath = path.join(job.dir, "input-video");
  try {
    await pipeline(Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream), createWriteStream(inputPath));
    const stat = await fs.stat(inputPath);
    if (stat.size > config.maxUploadBytes) throw new Error(`Videos must be smaller than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`);
    job.inputPath = inputPath;
    job.stage = "Reading media";
    touch(job);
    enqueue(job);
    return job.id;
  } catch (error) {
    await removeJob(job.id);
    throw error;
  }
}

export async function createUrlJob(rawUrl: string): Promise<string> {
  ensureCleanupLoop();
  const url = await validateDirectVideoUrl(rawUrl);
  const job = newJob("url", url.toString());
  await fs.mkdir(job.dir, { recursive: true });
  enqueue(job);
  return job.id;
}

function enqueue(job: JobRecord): void {
  void processQueue(job);
}

async function processQueue(job: JobRecord): Promise<void> {
  while (activeJobs >= config.maxConcurrentJobs) await new Promise((resolve) => setTimeout(resolve, 350));
  if (!jobs.has(job.id)) return;
  activeJobs += 1;
  job.status = "processing";
  job.stage = job.source === "url" ? "Receiving video" : "Reading media";
  job.progress = 3;
  touch(job);
  try {
    if (job.source === "url" && job.sourceUrl) {
      job.inputPath = await downloadUrl(job, job.sourceUrl);
    }
    if (!job.inputPath) throw new Error("The video could not be prepared.");
    const result = await runPythonAnalysis(job);
    job.result = result;
    job.status = "complete";
    job.progress = 100;
    job.stage = "Complete";
    touch(job);
    scheduleRetention(job.id);
  } catch (error) {
    job.status = "failed";
    job.progress = Math.min(99, job.progress);
    job.stage = "Analysis failed";
    job.error = error instanceof Error ? error.message : "Analysis failed unexpectedly.";
    touch(job);
    scheduleRetention(job.id, 10 * 60 * 1000);
  } finally {
    activeJobs -= 1;
  }
}

async function runPythonAnalysis(job: JobRecord): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const args = [
      path.join(process.cwd(), "analysis", "analyze.py"),
      "--input",
      job.inputPath as string,
      "--output",
      path.join(job.dir, "result.json"),
      "--job-id",
      job.id,
      "--max-minutes",
      String(config.maxVideoMinutes),
      "--face-fps",
      String(config.analysisFaceFps),
      "--pose-fps",
      String(config.analysisPoseFps),
      "--whisper-model",
      config.whisperModel,
    ];
    const child = spawn(config.pythonBin, args, { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    let outputBuffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      outputBuffer += chunk.toString();
      const lines = outputBuffer.split("\n");
      outputBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("PROGRESS ")) continue;
        try {
          const update = JSON.parse(line.slice("PROGRESS ".length)) as { progress?: number; stage?: string };
          if (typeof update.progress === "number") job.progress = Math.max(job.progress, Math.min(99, update.progress));
          if (update.stage) job.stage = update.stage;
          touch(job);
        } catch { /* Ignore malformed progress lines. */ }
      }
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `The analysis worker exited with code ${code ?? "unknown"}.`));
        return;
      }
      try {
        const json = await fs.readFile(path.join(job.dir, "result.json"), "utf8");
        resolve(JSON.parse(json) as AnalysisResult);
      } catch (error) {
        reject(new Error(`The analysis completed without a readable report: ${error instanceof Error ? error.message : "invalid result"}`));
      }
    });
  });
}

async function downloadUrl(job: JobRecord, initial: string): Promise<string> {
  let current = initial;
  let response: Response | null = null;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await validateSafeUrl(current);
    response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(30_000), headers: { "user-agent": "BehaviorAnalyzer/1.0" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("The video URL redirected too many times.");
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }
  if (!response || !response.ok || !response.body) throw new Error(`The video URL returned HTTP ${response?.status ?? "no response"}.`);
  const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
  const extension = path.extname(new URL(current).pathname).toLowerCase();
  const validTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);
  const validExtensions = new Set([".mp4", ".mov", ".webm", ".m4v"]);
  if (!validTypes.has(contentType) && !(contentType === "" && validExtensions.has(extension)) && !(contentType === "application/octet-stream" && validExtensions.has(extension))) {
    throw new Error("This URL does not point directly to an MP4, MOV, or WebM video. Web pages from social platforms are not supported.");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > config.maxUploadBytes) throw new Error(`Videos must be smaller than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`);

  const inputPath = path.join(job.dir, "input-video");
  const destination = createWriteStream(inputPath);
  let received = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      received += part.value.byteLength;
      if (received > config.maxUploadBytes) {
        await reader.cancel();
        throw new Error(`Videos must be smaller than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`);
      }
      if (!destination.write(Buffer.from(part.value))) await new Promise<void>((resolve) => destination.once("drain", resolve));
    }
    destination.end();
    await new Promise<void>((resolve, reject) => { destination.once("finish", resolve); destination.once("error", reject); });
    job.stage = "Reading media";
    job.progress = 8;
    touch(job);
    return inputPath;
  } catch (error) {
    destination.destroy();
    await fs.rm(inputPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function validateDirectVideoUrl(rawUrl: string): Promise<URL> {
  const initial = await validateSafeUrl(rawUrl);
  let current = initial.toString();
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const checked = await validateSafeUrl(current);
    const response = await fetch(checked, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "user-agent": "BehaviorAnalyzer/1.0" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("The video URL redirected too many times.");
      current = new URL(location, current).toString();
      continue;
    }
    if ([405, 501].includes(response.status)) return checked;
    if (!response.ok) throw new Error(`The video URL returned HTTP ${response.status}.`);
    const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
    const extension = path.extname(checked.pathname).toLowerCase();
    const validTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);
    const validExtensions = new Set([".mp4", ".mov", ".webm", ".m4v"]);
    if (!validTypes.has(contentType) && !(contentType === "" && validExtensions.has(extension))) throw new Error("This URL does not point directly to an MP4, MOV, or WebM video. Web pages from social platforms are not supported.");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > config.maxUploadBytes) throw new Error(`Videos must be smaller than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`);
    return checked;
  }
  throw new Error("The video URL could not be validated.");
}

export async function validateSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Enter a valid direct video URL."); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only http:// and https:// video URLs are supported.");
  if (url.username || url.password) throw new Error("Video URLs with embedded credentials are not supported.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard HTTP and HTTPS ports are supported.");
  const hostname = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname)) throw new Error("Local and internal URLs are not allowed.");
  const records = await lookup(hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) throw new Error("The video host resolves to a private or internal address.");
  return url;
}

function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    return octets[0] === 10 || octets[0] === 127 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 169 && octets[1] === 254) || octets[0] === 0;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
    return normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
  }
  return true;
}

function scheduleRetention(jobId: string, delay = config.jobRetentionMinutes * 60 * 1000): void {
  const timer = setTimeout(() => { void removeJob(jobId); }, delay);
  timer.unref();
}

export async function removeJob(jobId: string): Promise<boolean> {
  const job = getJob(jobId);
  if (!job) return false;
  if (job.status === "processing") return false;
  jobs.delete(jobId);
  await fs.rm(job.dir, { recursive: true, force: true });
  return true;
}

async function cleanupExpiredJobs(): Promise<void> {
  await fs.mkdir(config.storageRoot, { recursive: true });
  const entries = await fs.readdir(config.storageRoot, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - config.jobHardDeleteMinutes * 60 * 1000;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeJobId(entry.name)) continue;
    if (jobs.get(entry.name)?.status === "processing") continue;
    const full = path.join(config.storageRoot, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.rm(full, { recursive: true, force: true });
      jobs.delete(entry.name);
    }
  }
}

function ensureCleanupLoop(): void {
  if (cleanupStarted) return;
  cleanupStarted = true;
  void cleanupExpiredJobs();
  const interval = setInterval(() => { void cleanupExpiredJobs(); }, 10 * 60 * 1000);
  interval.unref();
}

ensureCleanupLoop();
