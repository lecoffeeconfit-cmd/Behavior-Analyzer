export type JobStatus = "queued" | "processing" | "complete" | "failed";

export type AnalysisCategory = "eyes" | "face" | "voice" | "body" | "speech" | "combined";

export interface AnalysisEvent {
  timestamp: number;
  endTimestamp?: number;
  category: AnalysisCategory;
  event: string;
  label: string;
  value?: number;
  baseline?: number;
  differencePercent?: number;
  confidence?: number;
  duration?: number;
  detail?: string;
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
  label?: string;
}

export interface AnalysisSection {
  summary: Record<string, string | number | boolean>;
  events: AnalysisEvent[];
  series: TimeSeriesPoint[];
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface AnalysisResult {
  jobId: string;
  duration: number;
  media: {
    width?: number;
    height?: number;
    frameRate?: number;
    hasAudio?: boolean;
    audioSampleRate?: number;
    audioChannels?: number;
    format?: string;
    sizeBytes?: number;
  };
  baseline: Record<string, number | string | boolean>;
  overview: {
    behavioralChanges: number;
    faceVisiblePercentage: number;
    bodyVisiblePercentage: number;
    notableMoments: AnalysisEvent[];
    methodNote: string;
  };
  subjects: Array<{
    subjectId: string;
    detectionConfidence?: number;
    faceVisiblePercentage: number;
    bodyVisiblePercentage: number;
  }>;
  timeline: AnalysisEvent[];
  eyes: AnalysisSection;
  face: AnalysisSection;
  body: AnalysisSection;
  voice: AnalysisSection;
  transcript: TranscriptSegment[];
  summary: string[];
}

export interface JobSnapshot {
  status: JobStatus;
  progress: number;
  stage: string;
  result: AnalysisResult | null;
  error: string | null;
}
