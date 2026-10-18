import { FaceLandmarker, PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { measureFace } from "./landmarks";
import type { CapturedFrame, VisionResult, PoseSample } from "@video-analyzer/shared/types";

self.onmessage = async (event: MessageEvent<{ frames: CapturedFrame[]; base: string }>) => {
  const { frames, base } = event.data;
  const result: VisionResult = { faces: [], poses: [], warnings: [] };
  let face: FaceLandmarker | undefined, pose: PoseLandmarker | undefined;
  try {
    const wasm = await FilesetResolver.forVisionTasks(`${base}wasm`);
    face = await FaceLandmarker.createFromOptions(wasm, {
      baseOptions: { modelAssetPath: `${base}models/face_landmarker.task`, delegate: "CPU" },
      runningMode: "IMAGE", numFaces: 3, outputFaceBlendshapes: true,
    });
    try {
      pose = await PoseLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: `${base}models/pose_landmarker_lite.task`, delegate: "CPU" },
        runningMode: "IMAGE", numPoses: 3, outputSegmentationMasks: false,
      });
    } catch { result.warnings.push("The local pose model could not initialize. Body landmarks are unavailable."); }
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      // Decode in memory. Fetching a data: URL would require broadening the
      // extension's connect-src policy even though no network is needed.
      const encoded = frame.image.slice(frame.image.indexOf(",") + 1);
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      try {
        const detected = face.detect(bitmap);
        // Spatial slots per frame, never biometric identity or persistent people tracking.
        const ordered = detected.faceLandmarks.map((points, i) => ({ points, blends: detected.faceBlendshapes[i] })).sort((a, b) => a.points[1].x - b.points[1].x);
        ordered.forEach(({ points, blends }, slot) => {
          const coefficients = Object.fromEntries(blends?.categories.map((value) => [value.categoryName, value.score]) || []);
          result.faces.push(measureFace(points, coefficients, frame.timestamp, slot));
        });
        if (pose && index % 2 === 0) {
          pose.detect(bitmap).landmarks.sort((a, b) => a[0].x - b[0].x).forEach((points, slot) => {
            const shoulders = { x: (points[11].x + points[12].x) / 2, y: (points[11].y + points[12].y) / 2 };
            const hips = { x: (points[23].x + points[24].x) / 2, y: (points[23].y + points[24].y) / 2 };
            if ([11, 12, 23, 24].some((i) => (points[i].visibility ?? 0) < 0.5)) return;
            const previous = result.poses.filter((p) => p.slot === slot).at(-1);
            const sample: PoseSample = {
              timestamp: frame.timestamp, slot,
              torsoAngle: Math.atan2(shoulders.x - hips.x, Math.max(0.001, hips.y - shoulders.y)) * 180 / Math.PI,
              movement: previous ? Math.hypot(shoulders.x - (previous.points[11].x + previous.points[12].x) / 2, shoulders.y - (previous.points[11].y + previous.points[12].y) / 2) : 0,
              points: points.map(({ x, y, visibility }) => ({ x, y, visibility })),
            };
            result.poses.push(sample);
          });
        }
      } finally { bitmap.close(); }
      self.postMessage({ type: "progress", progress: 62 + (index + 1) / frames.length * 32, stage: `Mapping face & motion · ${index + 1}/${frames.length}` });
    }
  } catch (error) {
    result.warnings.push(`Local landmark analysis unavailable: ${error instanceof Error ? error.message : "model initialization failed"}. Pixel and caption results are still available.`);
  } finally {
    face?.close(); pose?.close();
    self.postMessage({ type: "result", result });
  }
};
