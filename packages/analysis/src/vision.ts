import type { CapturedFrame, VisionResult } from "@video-analyzer/shared/types";
export function analyzeVision(frames: CapturedFrame[], signal: AbortSignal, progress: (value: number, stage: string) => void, base: string): Promise<VisionResult> {
  if (!frames.length) return Promise.resolve({ faces: [], poses: [], warnings: [] });
  return new Promise((resolve, reject) => {
    // Classic worker permits the packaged MediaPipe WASM loader's importScripts.
    const worker = new Worker(`${base}vision-worker.js`);
    const cleanup = () => { worker.terminate(); clearTimeout(timeout); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new Error("Analysis cancelled. No report was saved.")); };
    const timeout = setTimeout(() => { cleanup(); resolve({ faces: [], poses: [], warnings: ["Local landmark analysis reached the 90-second time limit. Pixel measurements remain available."] }); }, 90_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      if (event.data.type === "progress") progress(event.data.progress, event.data.stage);
      if (event.data.type === "result") { cleanup(); resolve(event.data.result); }
    };
    worker.onerror = (error) => { cleanup(); resolve({ faces: [], poses: [], warnings: [`The local vision worker could not start: ${error.message || "unknown worker error"}. Captions and pixel measurements are retained.`] }); };
    if (signal.aborted) { abort(); return; }
    worker.postMessage({ frames, base });
  });
}
