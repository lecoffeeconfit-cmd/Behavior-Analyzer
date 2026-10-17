import { extractTranscript } from "./transcript";
import { frameSignals } from "./signals";
import type { CaptureResult, CapturedFrame, VideoSource } from "@video-analyzer/shared/types";

export async function observeVideo(video: HTMLVideoElement, source: VideoSource, options: { seconds: number; signal: AbortSignal; progress: (value: number, stage: string, timestamp: number) => void }): Promise<CaptureResult> {
  const frames: CapturedFrame[] = [], warnings: string[] = [], start = video.currentTime;
  let encrypted = source.protected || !!video.mediaKeys;
  const onEncrypted = () => { encrypted = true; };
  video.addEventListener("encrypted", onEncrypted);
  const captionPromise = extractTranscript(video).catch(() => ({ segments: [], source: "Caption track unavailable" }));
  const canvas = document.createElement("canvas"), context = canvas.getContext("2d", { willReadFrequently: true });
  const duration = Math.min(12, Math.max(0, options.seconds));
  const started = performance.now();
  let previous: Uint8ClampedArray | undefined, lastTime = -1;
  const check = () => { if (options.signal.aborted) throw new Error("Analysis cancelled. No report was saved."); };
  try {
    check();
    if (encrypted) warnings.push("DRM/encrypted player: frame and audio capture disabled. Accessible captions and metadata are retained.");
    else if (!video.videoWidth || video.readyState < 2) warnings.push("No decoded frame is available. Start the player and analyze again.");
    else if (!context) warnings.push("Canvas pixel access is unavailable in this browser.");
    else {
      if (video.paused && duration > 0) warnings.push("The player was paused. Only one still frame was captured; start playback to observe movement.");
      const scale = Math.min(1, 640 / video.videoWidth, 640 / video.videoHeight);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      do {
        check();
        if (encrypted || video.mediaKeys) { frames.length = 0; warnings.push("Encryption was detected during playback. All frames were discarded."); break; }
        if (video.currentTime !== lastTime) {
          try {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            frames.push({ timestamp: video.currentTime, image: canvas.toDataURL("image/jpeg", 0.68), ...frameSignals(pixels, canvas.width, canvas.height, previous) });
            previous = pixels; lastTime = video.currentTime;
          } catch { warnings.push("The browser blocks pixels from this cross-origin video. Visual measurements are unavailable. No capture workaround was attempted."); break; }
        }
        const elapsed = (performance.now() - started) / 1000;
        options.progress(Math.min(60, 8 + elapsed / Math.max(1, duration) * 52), `Observing playback · ${frames.length} sampled frames`, video.currentTime);
        if (!duration || video.paused || video.ended || elapsed >= duration) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      } while (frames.length < 49);
    }
    const captions = await captionPromise; check();
    return { source: { ...source, protected: encrypted || !!video.mediaKeys, width: video.videoWidth, height: video.videoHeight, currentTime: start, duration: Number.isFinite(video.duration) ? video.duration : 0 }, frames, transcript: captions.segments, transcriptSource: captions.source, warnings, start, end: frames.at(-1)?.timestamp ?? start };
  } finally { video.removeEventListener("encrypted", onEncrypted); }
}
