import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const fixtureDir = resolve("fixtures");
const artifacts = resolve("artifacts/qa"); await mkdir(artifacts, { recursive: true });
const mime = { ".html": "text/html", ".webm": "video/webm", ".vtt": "text/vtt", ".jpg": "image/jpeg" };
function fixtureServer(port) {
  const server = createServer(async (req, res) => {
    try {
      const name = new URL(req.url, "http://localhost").pathname === "/" ? "video-fixture.html" : new URL(req.url, "http://localhost").pathname.slice(1);
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) { res.writeHead(404); res.end(); return; }
      const body = await readFile(join(fixtureDir, name));
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]), end = Math.min(body.length - 1, range[2] ? Number(range[2]) : body.length - 1);
        if (start > end) { res.writeHead(416); res.end(); return; }
        res.writeHead(206, { "Content-Type": mime[extname(name)] || "application/octet-stream", "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${body.length}`, "Accept-Ranges": "bytes" }); res.end(body.subarray(start, end + 1));
      } else { res.writeHead(200, { "Content-Type": mime[extname(name)] || "application/octet-stream", "Content-Length": body.length, "Accept-Ranges": "bytes" }); res.end(body); }
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
const server = await fixtureServer(4177), crossServer = await fixtureServer(4178);
const next = spawn(process.execPath, ["../../node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "127.0.0.1"], { cwd: resolve("apps/web"), stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = ""; next.stdout.on("data", (b) => { serverOutput += b; }); next.stderr.on("data", (b) => { serverOutput += b; });
const temp = await mkdtemp(join(tmpdir(), "video-analyzer-e2e-"));
let browser, extension;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch("http://127.0.0.1:3000/api/health")).ok) break; } catch { /* Wait for production server. */ }
    if (i === 99) throw new Error(`Production website did not start: ${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  const generator = await browser.newPage(); await generator.goto("http://127.0.0.1:4177/");
  const recording = await generator.evaluate(async () => {
    const bitmap = await createImageBitmap(await (await fetch("/portrait.jpg")).blob());
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext("2d"), stream = canvas.captureStream(8), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1000000 });
    recorder.ondataavailable = (e) => chunks.push(e.data); recorder.start();
    const started = performance.now();
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        const elapsed = performance.now() - started;
        ctx.fillStyle = elapsed > 1700 ? "#334b44" : "#152e24"; ctx.fillRect(0, 0, 640, 360);
        ctx.drawImage(bitmap, 175, 0, 288, 360);
        ctx.fillStyle = "#a3f1ce"; ctx.fillRect(10 + elapsed / 3000 * 120, 290, 25, 25);
        if (elapsed > 3000) { clearInterval(timer); recorder.onstop = resolve; recorder.stop(); }
      }, 100);
    });
    stream.getTracks().forEach((t) => t.stop()); bitmap.close();
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await writeFile(join(fixtureDir, "video.webm"), Buffer.from(recording)); await generator.close();
  const web = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const webErrors = []; web.on("pageerror", (e) => webErrors.push(e.message));
  await web.goto("http://127.0.0.1:3000/");
  await web.screenshot({ path: join(artifacts, "web-ready.png"), fullPage: true, animations: "disabled" });
  await web.locator("input[type=file]").first().setInputFiles(join(fixtureDir, "video.webm"));
  await web.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  await web.getByLabel("Observation window").selectOption("0");
  await web.getByRole("button", { name: "Analyze video", exact: true }).click();
  await web.getByText("REPORT READY", { exact: true }).waitFor({ timeout: 100000 });
  await web.getByRole("tab", { name: "Signals", exact: true }).click();
  assert.equal(await web.locator(".chart").count() >= 8, true, "Website must have actual face measurements, not just unavailable placeholders");
  await web.getByRole("tab", { name: "Overview", exact: true }).click();
  await web.screenshot({ path: join(artifacts, "web-report.png"), fullPage: true, animations: "disabled" });
  await web.getByRole("tab", { name: "Authenticity", exact: true }).click();
  await web.getByText("Unavailable", { exact: true }).waitFor();
  await web.getByRole("button", { name: "Library" }).click();
  await web.getByLabel("Search local history").fill("video.webm"); assert.equal(await web.locator(".history-card").count(), 1);
  await web.reload(); await web.getByRole("button", { name: "Library" }).click();
  await web.locator(".history-card").waitFor();
  await web.getByRole("button", { name: "Pro & account" }).click();
  assert.equal(await web.getByText("$2.99", { exact: false }).count() > 0, true);
  await web.setViewportSize({ width: 390, height: 844 });
  assert.equal(await web.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Mobile UI must not overflow horizontally");
  await web.screenshot({ path: join(artifacts, "web-mobile.png"), fullPage: true, animations: "disabled" });
  assert.deepEqual(webErrors, [], "No website page errors");
  console.log("PASS website: real local upload → model inference → report → authenticity → persistent history → responsive Pro view");

  const unpacked = join(temp, "extension"); await cp(resolve("dist/extension"), unpacked, { recursive: true });
  const manifest = JSON.parse(await readFile(join(unpacked, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3); assert.equal(manifest.host_permissions, undefined, "Production extension must not request persistent website access");
  // Test-only host grant replaces the human toolbar gesture in automated Chromium.
  // The shipped manifest is never changed by this test.
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await writeFile(join(unpacked, "manifest.json"), JSON.stringify(manifest));
  extension = await chromium.launchPersistentContext(join(temp, "profile"), { channel: "chromium", headless: true, viewport: { width: 420, height: 950 }, args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`, "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  const worker = extension.serviceWorkers()[0] || await extension.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const fixture = await extension.newPage(); await fixture.goto("http://127.0.0.1:4177/");
  await fixture.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  const panel = await extension.newPage(); const extensionErrors = []; panel.on("pageerror", (e) => extensionErrors.push(e.message));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.startsWith("http://127.0.0.1:4177/"))?.id);
  const found = await panel.evaluate((tabId) => chrome.runtime.sendMessage({ type: "DETECT", tabId }), tabId);
  assert.equal(found.ok, true); assert.equal(found.data.videos.length, 2);
  const source = found.data.videos[0];
  const captured = await panel.evaluate((source) => chrome.runtime.sendMessage({ type: "CAPTURE", source, runId: "smoke-snapshot", seconds: 0 }), source);
  assert.equal(captured.ok, true); assert.equal(captured.data.frames.length, 1); assert.equal(captured.data.transcript.length, 3);
  await fixture.waitForFunction(() => { const video = document.querySelector("#first"); return video.seekable.length && video.seekable.end(0) >= 1; });
  const seek = await panel.evaluate((source) => chrome.runtime.sendMessage({ type: "SEEK", source, timestamp: 1 }), source);
  assert.equal(seek.ok, true, seek.error); assert.ok(Math.abs(await fixture.locator("#first").evaluate((v) => v.currentTime) - 1) < .2);
  const windowId = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id);
  await panel.evaluate((windowId) => chrome.sidePanel.open({ windowId }), windowId);
  assert.equal((await panel.evaluate(() => chrome.sidePanel.getOptions({}))).path, "sidepanel.html");
  // Verify that ordinary tainted canvas restrictions remain in force.
  await fixture.evaluate(() => { const v = document.createElement("video"); v.id = "cross"; v.src = "http://localhost:4178/video.webm"; v.controls = true; document.body.append(v); });
  await fixture.waitForFunction(() => document.querySelector("#cross")?.readyState >= 2);
  const crossFound = await panel.evaluate((tabId) => chrome.runtime.sendMessage({ type: "DETECT", tabId }), tabId);
  const blocked = await panel.evaluate((source) => chrome.runtime.sendMessage({ type: "CAPTURE", source, runId: "smoke-cors", seconds: 0 }), crossFound.data.videos[2]);
  assert.equal(blocked.ok, true); assert.equal(blocked.data.frames.length, 0); assert.ok(blocked.data.warnings.join(" ").includes("cross-origin"));
  await fixture.locator("#first").evaluate((v) => v.dispatchEvent(new Event("encrypted")));
  const protectedFound = await panel.evaluate((tabId) => chrome.runtime.sendMessage({ type: "DETECT", tabId }), tabId);
  assert.equal(protectedFound.data.videos[0].protected, true);
  const protectedCapture = await panel.evaluate((source) => chrome.runtime.sendMessage({ type: "CAPTURE", source, runId: "smoke-protected", seconds: 0 }), protectedFound.data.videos[0]);
  assert.equal(protectedCapture.data.frames.length, 0); assert.equal(protectedCapture.data.transcript.length, 3);
  // Run the production UI end to end with the original, minimally privileged manifest code.
  await panel.getByRole("button", { name: "Local file", exact: true }).click();
  await panel.locator("input[type=file]").first().setInputFiles(join(fixtureDir, "video.webm"));
  await panel.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  await panel.getByLabel("Observation window").selectOption("0");
  await panel.getByRole("button", { name: "Analyze video", exact: true }).click();
  await panel.getByText("REPORT READY", { exact: true }).waitFor({ timeout: 100000 });
  await panel.getByRole("tab", { name: "Signals", exact: true }).click();
  assert.ok(await panel.locator(".chart").count() >= 8, `MV3 CSP and packaged models must yield real face data. ${await panel.locator(".access-notes").textContent()}`);
  await panel.screenshot({ path: join(artifacts, "extension-signals.png"), fullPage: true, animations: "disabled" });
  await panel.getByRole("tab", { name: "Overview", exact: true }).click();
  await panel.screenshot({ path: join(artifacts, "extension-report.png"), fullPage: true, animations: "disabled" });
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await panel.getByRole("button", { name: "Library" }).click(); await panel.locator(".history-card").waitFor();
  assert.deepEqual(extensionErrors, [], "No extension page errors");
  console.log("PASS extension: MV3 load, Side Panel API, two-player detection, captions, frame capture, seeking, CORS/DRM handling, packaged model inference, local history");
  console.log("Screenshots saved in artifacts/qa/. The fixture uses a public MediaPipe test portrait; no customer video or cloud API is used.");
} finally {
  await extension?.close(); await browser?.close(); next.kill(); server.close(); crossServer.close(); await rm(temp, { recursive: true, force: true });
}
