import type { AnalysisEvent, CaptureResult, VideoReport, VisionResult, AudioResult } from "@video-analyzer/shared/types";
import { mean } from "./signals";
import { formatTime } from "@video-analyzer/shared/format";

export function buildReport(capture: CaptureResult, vision: VisionResult, audio: AudioResult | null): VideoReport {
  const { frames, transcript, source } = capture;
  const events: AnalysisEvent[] = [];
  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i], last = frames[i - 1];
    if (frame.motion > 0.18) events.push({ timestamp: frame.timestamp, category: "combined", event: "frame-change", label: "Large visual change", value: frame.motion, detail: "A cut, camera movement, or subject movement changed the sampled pixels." });
    if (Math.abs(frame.brightness - last.brightness) > 0.12) events.push({ timestamp: frame.timestamp, category: "combined", event: "lighting", label: "Brightness shift", value: frame.brightness, detail: "Average frame luminance changed. Exposure, editing, and scene changes can all explain this." });
  }
  // Compare only a single visible face. Multi-person slots are spatial, not identity tracking.
  const faceCounts = new Map<number, number>();
  vision.faces.forEach((f) => faceCounts.set(f.timestamp, (faceCounts.get(f.timestamp) || 0) + 1));
  const single = vision.faces.filter((f) => faceCounts.get(f.timestamp) === 1);
  for (let i = 1; i < single.length; i++) {
    const face = single[i], last = single[i - 1];
    if (face.timestamp <= last.timestamp || face.timestamp - last.timestamp > 0.6 || Math.hypot(face.x - last.x, face.y - last.y) > 0.12) continue;
    if (Math.abs(face.yaw - last.yaw) > 0.07) events.push({ timestamp: face.timestamp, category: "face", event: "head-turn", label: "Head direction shifted", detail: `Image-space yaw proxy ${face.yaw.toFixed(2)}. Not a calibrated angle or statement about intent.` });
    if (Math.abs(face.roll - last.roll) > 8) events.push({ timestamp: face.timestamp, category: "face", event: "head-tilt", label: "Head tilt changed", detail: `Eye-line roll ${face.roll.toFixed(1)}°. Camera rotation can affect this measurement.` });
    if (Math.abs(face.brow - last.brow) > 0.025) events.push({ timestamp: face.timestamp, category: "face", event: "brow-shift", label: "Eyebrow position changed", detail: "Brow-to-eye spacing changed relative to face width. No emotional interpretation is assigned." });
    if (face.blink > 0.5 && last.blink <= 0.5) events.push({ timestamp: face.timestamp, category: "eyes", event: "eye-closure", label: "Sampled eye closure", detail: "A blink-like closure was present in a sampled frame. Brief blinks between samples may be missed." });
    if (Math.abs(face.gazeX - last.gazeX) > 0.1) events.push({ timestamp: face.timestamp, category: "eyes", event: "iris-shift", label: "Iris position shifted", detail: "Relative iris position changed in the image. This is not a calibrated gaze target." });
  }
  vision.poses.filter((p) => p.movement > 0.035).forEach((p) => events.push({ timestamp: p.timestamp, category: "body", event: "body-movement", label: "Shoulder position shifted", detail: "Image-space shoulder position changed. Camera movement and different people entering the frame can affect this." }));
  for (let i = 1; i < vision.poses.length; i++) {
    const pose = vision.poses[i], previous = vision.poses.slice(0, i).filter((p) => p.slot === pose.slot).at(-1);
    if (!previous || pose.timestamp - previous.timestamp <= 0 || pose.timestamp - previous.timestamp > 0.8) continue;
    for (const wrist of [15, 16]) {
      const a = pose.points[wrist], b = previous.points[wrist];
      if ((a?.visibility || 0) > 0.6 && (b?.visibility || 0) > 0.6 && Math.hypot(a.x - b.x, a.y - b.y) > 0.06) events.push({ timestamp: pose.timestamp, category: "body", event: "wrist-motion", label: `${wrist === 15 ? "Left" : "Right"} hand / wrist movement`, detail: "Visible wrist position changed between samples. Gesture meaning and intention are not inferred." });
    }
  }
  const visibleFrames = new Set(vision.faces.map((f) => f.timestamp)).size;
  const luminance = mean(frames.map((f) => f.brightness));
  const motion = mean(frames.slice(1).map((f) => f.motion));
  const summary = [
    `${formatTime(capture.start)}–${formatTime(capture.end)} observed · ${frames.length} readable frame${frames.length === 1 ? "" : "s"} from ${source.width || "?"} × ${source.height || "?"} video.`,
    frames.length ? `Average luminance ${(luminance * 100).toFixed(0)}%; ${frames.length > 1 ? `frame-to-frame pixel change ${(motion * 100).toFixed(1)}%.` : "motion needs multiple frames."}` : "Visual access is unavailable. See the access notes below.",
    vision.faces.length ? `Faces detected in ${visibleFrames} of ${frames.length} sampled frames. ${events.filter((e) => e.category === "face" || e.category === "eyes").length} facial signal changes flagged for review.` : "No face measurements available in the observed window.",
    transcript.length ? `Accessible captions contain ${transcript.length} segments. ${extractiveSummary(transcript.map((s) => s.text).join(" "))}` : "No transcript was accessible. You can import a VTT caption file or explicitly use optional audio transcription.",
  ];
  const observations = [
    "No validated deepfake classifier is installed. A probability of AI generation cannot be calculated from these measurements.",
    "Facial spacing, eye closures, pixel changes, compression artifacts, and lighting shifts also occur in authentic video. They are review cues, not proof of synthesis.",
    "Capture time, location, identity, and time of day cannot be established from frame brightness or color temperature.",
  ];
  if (frames.length) observations.push(`Observed luminance range: ${(Math.min(...frames.map((f) => f.brightness)) * 100).toFixed(0)}–${(Math.max(...frames.map((f) => f.brightness)) * 100).toFixed(0)}%.`);
  return {
    id: crypto.randomUUID(), createdAt: Date.now(), source, start: capture.start, end: capture.end,
    // Retain bounded representative images; retain measurements for every sampled frame.
    frames: frames.map((f, i) => ({ ...f, image: i === 0 || i === frames.length - 1 || i % Math.max(1, Math.ceil(frames.length / 6)) === 0 ? f.image : "" })),
    faces: vision.faces, poses: vision.poses, voice: audio?.samples || [], voiceClock: audio?.clock || "elapsed",
    transcript, transcriptSource: capture.transcriptSource, transcriptClock: "video", summary,
    events: events.sort((a, b) => a.timestamp - b.timestamp).slice(0, 200),
    warnings: [...capture.warnings, ...vision.warnings, ...(audio?.warning ? [audio.warning] : []),
      "Sampling at about 4 fps can miss brief expressions and blinks. Relative landmark changes are estimates affected by lighting, pose, resolution, and camera motion.",
      "Trust, honesty, fear, intent, and relationships are not measurable from these signals. No such scores are assigned."],
    authenticity: { verdict: "Inconclusive", probability: null, observations },
  };
}

export function extractiveSummary(text: string): string {
  // Deterministic caption excerpt: no generated claims or remote processing.
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return sentences.slice(0, 3).join(" ").slice(0, 600);
}

export function answerLocally(report: VideoReport, question: string): { text: string; timestamps: number[] } {
  if (/deepfake|fake|synthetic|ai.generated|real video/i.test(question)) return { text: report.authenticity.observations.slice(0, 2).join(" "), timestamps: [] };
  if (/truth|lying|lie\b|honest|trust|fear|scared|emotion|intent/i.test(question)) return { text: "This report cannot establish truthfulness, trust, fear, emotion, or intent. It can show observable movements and acoustic changes for you to review in context.", timestamps: [] };
  if (/summary|summarize|overview/i.test(question)) return { text: report.summary.join("\n\n"), timestamps: [] };
  const terms = question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter((word) => !["what", "when", "where", "does", "were", "this", "that", "video", "about", "show", "with", "have", "happened", "said", "the"].includes(word)) || [];
  const ranked = report.transcript.map((segment) => ({ segment, score: terms.reduce((sum, term) => sum + Number(segment.text.toLowerCase().includes(term)), 0) })).filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  if (ranked.length) return { text: `Relevant caption excerpts (local text retrieval${report.transcriptClock === "elapsed" ? "; capture elapsed time" : ""}):\n\n${ranked.map(({ segment }) => `[${formatTime(segment.start)}] ${segment.text}`).join("\n\n")}`, timestamps: report.transcriptClock === "elapsed" ? [] : ranked.map(({ segment }) => segment.start) };
  const relevant = report.events.filter((e) => terms.some((term) => `${e.label} ${e.category} ${e.detail}`.toLowerCase().includes(term))).slice(0, 4);
  if (relevant.length) return { text: relevant.map((e) => `[${formatTime(e.timestamp)}] ${e.label}. ${e.detail}`).join("\n\n"), timestamps: relevant.map((e) => e.timestamp) };
  return { text: "I could not find evidence for that question in the accessible captions or measured signals. Try a caption keyword, “head”, “brightness”, or “summary”. Optional AI can reason over the report when you explicitly enable it.", timestamps: [] };
}
