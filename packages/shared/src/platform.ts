import type { CaptureResult, VideoReport, VideoSource } from "./types";
import type { Entitlement } from "./plans";
export interface ProductPlatform {
  kind: "web" | "extension";
  assetBase: string;
  detect: () => Promise<{ videos: VideoSource[]; warnings: string[] }>;
  capture: (source: VideoSource, runId: string, seconds: number) => Promise<CaptureResult>;
  cancel: (source: VideoSource, runId: string) => Promise<void>;
  seek: (source: VideoSource, timestamp: number) => Promise<void>;
  onProgress: (callback: (runId: string, progress: number, stage: string) => void) => () => void;
  onPageChange?: (callback: () => void) => () => void;
  setBackend: (endpoint: string) => Promise<void>;
  getBackend: () => Promise<string>;
  account: () => Promise<Entitlement>;
  login: (email: string, password: string, register: boolean) => Promise<void>;
  logout: () => Promise<void>;
  ask: (reports: VideoReport[], question: string) => Promise<string>;
  transcribe?: (blob: Blob) => Promise<{ segments: import("./types").TranscriptSegment[]; text: string }>;
}
