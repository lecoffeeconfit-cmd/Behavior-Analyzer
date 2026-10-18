import type { PanelRequest, VideoSource } from "@video-analyzer/shared/types";

// This grants temporary page access only when the user clicks the toolbar icon.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
});
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  // Must be called before awaiting anything: Chrome requires a user gesture.
  void chrome.sidePanel.open({ windowId: tab.windowId });
});

async function detect(tabId: number): Promise<{ videos: VideoSource[]; warnings: string[] }> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:/.test(tab.url)) throw new Error("Open an HTTP or HTTPS page with a video. Chrome settings, the Web Store, extension pages, and local file pages cannot be inspected.");
  let injections: chrome.scripting.InjectionResult[];
  try {
    injections = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
  } catch {
    throw new Error("Chrome has not granted access to this page. Click the Video Analyzer toolbar icon on the video tab, then Refresh videos. Restricted Chrome pages cannot be inspected.");
  }
  const settled = await Promise.allSettled(injections.map(async (frame) => {
    const response = await chrome.tabs.sendMessage(tabId, { type: "VA_DETECT" }, { documentId: frame.documentId });
    if (!response?.ok) throw new Error(response?.error || "Frame unavailable");
    return (response.data as VideoSource[]).map((video) => ({ ...video, tabId, frameId: frame.frameId, documentId: frame.documentId! }));
  }));
  return {
    videos: settled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
    warnings: ["Embedded players on other origins or inside closed shadow roots may be unavailable. No protected streams are downloaded.", ...(settled.some((r) => r.status === "rejected") ? ["One or more embedded frames could not be inspected."] : [])],
  };
}

chrome.runtime.onMessage.addListener((message: PanelRequest, sender, respond) => {
  // Content scripts cannot invoke privileged operations or access saved reports/keys.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  if (!["DETECT", "CAPTURE", "CANCEL", "SEEK"].includes(message?.type)) return false;
  void (async () => {
    if (message.type === "DETECT") return detect(message.tabId);
    const source = message.source;
    if (!Number.isInteger(source?.tabId) || !source?.documentId || !source?.id) throw new Error("Choose a video on the current page first.");
    const response = await chrome.tabs.sendMessage(source.tabId, {
      ...message, type: `VA_${message.type}`,
    }, { documentId: source.documentId });
    if (!response?.ok) throw new Error(response?.error || "The player changed. Refresh videos and select it again.");
    return response.data;
  })().then((data) => respond({ ok: true, data }), (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : "The page could not be inspected." }));
  return true;
});
