import type { ProductPlatform } from "@video-analyzer/shared/platform";
import type { CaptureResult } from "@video-analyzer/shared/types";
import { request } from "./bridge";
import { createCloudClient, validateBackend } from "@video-analyzer/shared/cloud-client";
import { audioBlobToBase64Wav } from "@video-analyzer/analysis/wav";

const cloud = createCloudClient({
  getEndpoint: async () => (await chrome.storage.local.get("backendEndpoint")).backendEndpoint as string || "",
  getToken: async () => (await chrome.storage.session.get("accountToken")).accountToken as string || "",
  setToken: async (accountToken) => { await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }); await chrome.storage.session.set({ accountToken }); },
});
export const extensionPlatform: ProductPlatform = {
  kind: "extension", assetBase: globalThis.chrome?.runtime?.id ? chrome.runtime.getURL("") : "/",
  async detect() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error("No active video tab was found.");
    return request({ type: "DETECT", tabId: tab.id });
  },
  capture: (source, runId, seconds) => request<CaptureResult>({ type: "CAPTURE", source, runId, seconds }),
  cancel: (source, runId) => request({ type: "CANCEL", source, runId }),
  seek: (source, timestamp) => request({ type: "SEEK", source, timestamp }),
  onProgress(callback) {
    const listener = (message: { type: string; runId: string; progress: number; stage: string }, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && sender.tab && message.type === "CAPTURE_PROGRESS") callback(message.runId, message.progress, message.stage);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  },
  onPageChange(callback) {
    const changed = () => callback();
    const updated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => { if (change.status === "complete") callback(); };
    chrome.tabs.onActivated.addListener(changed); chrome.tabs.onUpdated.addListener(updated);
    return () => { chrome.tabs.onActivated.removeListener(changed); chrome.tabs.onUpdated.removeListener(updated); };
  },
  async setBackend(endpoint) {
    const { permission } = validateBackend(endpoint);
    const previous = (await chrome.storage.local.get("backendEndpoint")).backendEndpoint as string | undefined;
    if (!await chrome.permissions.request({ origins: [permission] })) throw new Error("Backend permission was declined. Free analysis is still available.");
    await chrome.storage.local.set({ backendEndpoint: endpoint });
    if (previous !== endpoint) await cloud.logout();
    if (previous && validateBackend(previous).permission !== permission) await chrome.permissions.remove({ origins: [validateBackend(previous).permission] });
  },
  getBackend: async () => (await chrome.storage.local.get("backendEndpoint")).backendEndpoint as string || "",
  ...cloud,
  transcribe: async (blob) => cloud.transcribeWav(await audioBlobToBase64Wav(blob)),
};
