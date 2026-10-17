import type { Entitlement } from "./plans";
import type { VideoReport } from "./types";

export function validateBackend(endpoint: string) {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash) throw new Error("Use a backend URL without embedded credentials or query strings.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Use HTTPS for the Pro backend, or localhost for development.");
  return { base: url.href.replace(/\/$/, ""), permission: `${url.protocol}//${url.hostname}/*` };
}
export function createCloudClient(storage: { getEndpoint: () => Promise<string>; getToken: () => Promise<string>; setToken: (token: string) => Promise<void> }) {
  async function api(operation: string, body?: unknown, auth = true) {
    const endpoint = await storage.getEndpoint();
    if (!endpoint) throw new Error("The optional Pro backend is not connected. Free analysis remains fully available.");
    const { base } = validateBackend(endpoint);
    const token = auth ? await storage.getToken() : "";
    const response = await fetch(`${base}/api/pro/${operation}`, {
      method: body === undefined ? "GET" : "POST", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(55_000),
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `The Pro service returned HTTP ${response.status}.`);
    return data;
  }
  return {
    account: async (): Promise<Entitlement> => api("status"),
    login: async (email: string, password: string, register: boolean) => {
      const data = await api(register ? "register" : "login", { email, password }, false);
      if (!data.accessToken) throw new Error(data.message || "Check your email to confirm your account, then sign in.");
      await storage.setToken(data.accessToken);
    },
    logout: async () => { await storage.setToken(""); },
    ask: async (reports: VideoReport[], question: string): Promise<string> => {
      const data = await api("analyze", { requestId: crypto.randomUUID(), question: question.slice(0, 2000), reports: reports.slice(0, 3).map((report) => ({ title: report.source.title, start: report.start, end: report.end, summary: report.summary, transcript: report.transcript.slice(0, 30), events: report.events.slice(0, 20), frames: report.frames.filter((f) => f.image).filter((_, i, a) => i === 0 || i === Math.floor(a.length / 2) || i === a.length - 1).slice(0, reports.length > 1 ? 1 : 3).map((f) => ({ timestamp: f.timestamp, image: f.image })), limitations: report.warnings, authenticity: report.authenticity })) });
      return data.answer;
    },
    checkout: async (): Promise<string> => (await api("checkout", {})).url,
    transcribeWav: async (wav: string): Promise<{ text: string; segments: import("./types").TranscriptSegment[] }> => api("transcribe", { requestId: crypto.randomUUID(), wav }),
  };
}
