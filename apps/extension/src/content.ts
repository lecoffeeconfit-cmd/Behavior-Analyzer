import { observeVideo } from "@video-analyzer/analysis/capture";
import type { CaptureResult, VideoSource } from "@video-analyzer/shared/types";

(() => {
  const scope = globalThis as typeof globalThis & { __videoAnalyzerInstalled?: boolean };
  if (scope.__videoAnalyzerInstalled) return;
  scope.__videoAnalyzerInstalled = true;
  const ids = new WeakMap<HTMLVideoElement, string>();
  const encrypted = new WeakSet<HTMLVideoElement>();
  const observed = new WeakSet<HTMLVideoElement>();
  const cancellations = new Map<string, AbortController>();

  function videos(root: Document | ShadowRoot = document): HTMLVideoElement[] {
    const result = Array.from(root.querySelectorAll("video"));
    for (const element of root.querySelectorAll("*")) if (element.shadowRoot) result.push(...videos(element.shadowRoot));
    return result;
  }
  function describe(video: HTMLVideoElement): VideoSource {
    if (!ids.has(video)) ids.set(video, crypto.randomUUID());
    if (!observed.has(video)) {
      observed.add(video);
      video.addEventListener("encrypted", () => encrypted.add(video));
    }
    const rect = video.getBoundingClientRect();
    const url = new URL(location.href); url.search = ""; url.hash = "";
    return {
      id: ids.get(video)!, tabId: -1, frameId: 0, documentId: "",
      title: video.getAttribute("aria-label") || video.getAttribute("title") || document.title || "Untitled video",
      pageUrl: url.href, sourceKind: video.currentSrc.startsWith("blob:") ? "Browser stream" : video.currentSrc ? "HTML5 video" : "Unloaded player",
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      currentTime: video.currentTime || 0, width: video.videoWidth, height: video.videoHeight,
      paused: video.paused, protected: !!video.mediaKeys || encrypted.has(video),
      captions: video.textTracks.length,
      visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight,
    };
  }
  function find(id: string) {
    const video = videos().find((video) => ids.get(video) === id);
    if (!video) throw new Error("This player was removed or replaced. Refresh videos and choose the current player.");
    return video;
  }
  const sendProgress = (runId: string, progress: number, stage: string, timestamp: number) => {
    void chrome.runtime.sendMessage({ type: "CAPTURE_PROGRESS", runId, progress, stage, timestamp }).catch(() => undefined);
  };

  async function capture(source: VideoSource, runId: string, seconds: number): Promise<CaptureResult> {
    if (cancellations.size) throw new Error("A capture is already running. Cancel it before starting another.");
    const video = find(source.id), controller = new AbortController();
    cancellations.set(runId, controller);
    try { return await observeVideo(video, { ...describe(video), tabId: source.tabId, frameId: source.frameId, documentId: source.documentId }, { seconds, signal: controller.signal, progress: (value, stage, timestamp) => sendProgress(runId, value, stage, timestamp) }); }
    finally { cancellations.delete(runId); }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === "VA_DETECT") { respond({ ok: true, data: videos().map(describe) }); return false; }
    if (message.type === "VA_CANCEL") { cancellations.get(message.runId)?.abort(); respond({ ok: true, data: null }); return false; }
    if (message.type === "VA_SEEK") {
      try {
        const video = find(message.source.id);
        if (!Number.isFinite(message.timestamp) || message.timestamp < 0) throw new Error("Invalid timestamp.");
        if (!video.seekable.length) throw new Error("This player does not expose a seekable timeline.");
        let canSeek = false;
        for (let i = 0; i < video.seekable.length; i++) if (message.timestamp >= video.seekable.start(i) && message.timestamp <= video.seekable.end(i)) canSeek = true;
        if (!canSeek) throw new Error("This timestamp is outside the player's seekable range.");
        video.currentTime = message.timestamp;
        video.scrollIntoView({ behavior: "smooth", block: "center" });
        respond({ ok: true, data: null });
      } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : "Seeking is unavailable." }); }
      return false;
    }
    if (message.type !== "VA_CAPTURE") return false;
    void capture(message.source, message.runId, message.seconds).then((data) => respond({ ok: true, data }), (error) => respond({ ok: false, error: error.message }));
    return true;
  });
})();
