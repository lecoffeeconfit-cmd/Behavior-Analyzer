import type { PanelRequest, ResponseEnvelope } from "@video-analyzer/shared/types";
export async function request<T>(message: PanelRequest): Promise<T> {
  if (!globalThis.chrome?.runtime?.id) throw new Error("Load the dist folder in Chrome → Extensions → Load unpacked. This interface runs inside the extension.");
  const response = await chrome.runtime.sendMessage(message) as ResponseEnvelope<T>;
  if (!response?.ok) throw new Error(response?.error || "Chrome could not contact the page. Click the extension icon again and retry.");
  return response.data;
}
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "Live";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
