import path from "node:path";

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  maxUploadBytes: numberEnv("MAX_UPLOAD_MB", 500) * 1024 * 1024,
  maxVideoMinutes: numberEnv("MAX_VIDEO_MINUTES", 30),
  maxConcurrentJobs: Math.max(1, Math.floor(numberEnv("MAX_CONCURRENT_JOBS", 2))),
  jobRetentionMinutes: numberEnv("JOB_RETENTION_MINUTES", 30),
  jobHardDeleteMinutes: numberEnv("JOB_HARD_DELETE_MINUTES", 120),
  analysisFaceFps: numberEnv("ANALYSIS_FACE_FPS", 4),
  analysisPoseFps: numberEnv("ANALYSIS_POSE_FPS", 2),
  whisperModel: process.env.WHISPER_MODEL || "tiny",
  storageRoot: process.env.BEHAVIOR_ANALYZER_TMP || "/tmp/behavior-analyzer",
  pythonBin: process.env.PYTHON_BIN || "python3",
};

export function jobDirectory(jobId: string): string {
  return path.join(config.storageRoot, jobId);
}

export function isSafeJobId(jobId: string): boolean {
  return /^[a-f0-9]{24}$/.test(jobId);
}
