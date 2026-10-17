import type { AnalysisEvent, TranscriptSegment, TimeSeriesPoint } from "./legacy-types";
export type { AnalysisEvent, TranscriptSegment, TimeSeriesPoint };

export interface VideoSource {
  id: string; tabId: number; frameId: number; documentId: string;
  title: string; pageUrl: string; sourceKind: string;
  duration: number; currentTime: number; width: number; height: number;
  paused: boolean; protected: boolean; captions: number; visible: boolean;
  metadata?: Record<string, string | number | boolean>;
}
export interface CapturedFrame {
  timestamp: number; image: string;
  brightness: number; contrast: number; warmth: number; motion: number;
  heatmap: number[];
  edgeEnergy?: number; blockBoundaryExcess?: number;
}
export interface CaptureResult {
  source: VideoSource; frames: CapturedFrame[]; transcript: TranscriptSegment[];
  transcriptSource: string; warnings: string[]; start: number; end: number;
}
export interface FaceSample {
  timestamp: number; slot: number; x: number; y: number;
  eyeOpen: number; brow: number; mouth: number; yaw: number; pitch: number; roll: number;
  eyeDistanceRatio: number; blink: number; gazeX: number; gazeY: number;
  points: Array<{x: number; y: number}>;
}
export interface PoseSample {
  timestamp: number; slot: number; torsoAngle: number; movement: number;
  points: Array<{x: number; y: number; visibility?: number}>;
}
export interface VisionResult { faces: FaceSample[]; poses: PoseSample[]; warnings: string[] }
export interface VoiceSample { timestamp: number; rms: number; pitch: number | null }
export interface AudioResult {
  samples: VoiceSample[]; blob: Blob | null; warning?: string;
  clock: "video" | "elapsed";
}
export interface VideoReport {
  id: string; createdAt: number; source: VideoSource; start: number; end: number;
  frames: CapturedFrame[]; faces: FaceSample[]; poses: PoseSample[];
  voice: VoiceSample[]; voiceClock: "video" | "elapsed";
  transcript: TranscriptSegment[]; transcriptSource: string; transcriptClock: "video" | "elapsed";
  summary: string[]; events: AnalysisEvent[]; warnings: string[];
  authenticity: { verdict: "Inconclusive"; probability: null; observations: string[] };
  remote?: { summary?: string; provider: string };
}
export type PanelRequest =
  | { type: "DETECT"; tabId: number }
  | { type: "CAPTURE"; source: VideoSource; runId: string; seconds: number }
  | { type: "CANCEL"; source: VideoSource; runId: string }
  | { type: "SEEK"; source: VideoSource; timestamp: number };
export type ResponseEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };
export interface IntegrationSettings { endpoint: string; model: string; transcriptionModel: string }
