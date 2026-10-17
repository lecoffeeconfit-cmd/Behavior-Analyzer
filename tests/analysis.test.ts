import { describe, expect, it } from "vitest";
import { frameSignals, estimatePitch } from "../packages/analysis/src/signals";
import { parseVtt } from "../packages/analysis/src/transcript";
import { answerLocally, buildReport } from "../packages/analysis/src/report";
import { detailedReportHtml } from "../packages/analysis/src/export";
import { encodeWav } from "../packages/analysis/src/wav";
import { validateWav, validateCloudRequest } from "../apps/web/server/cloud";
import { checkBudget, isEntitled } from "../apps/web/server/metering";
import { validateBackend } from "../packages/shared/src/cloud-client";
import { searchReports } from "../packages/shared/src/storage";
import type { CaptureResult, VideoReport } from "../packages/shared/src/types";

export const capture: CaptureResult = {
  source: { id: "video-1", tabId: 1, frameId: 0, documentId: "doc-1", title: "A test recording", pageUrl: "https://example.org/video", sourceKind: "HTML5 video", duration: 20, currentTime: 2, width: 640, height: 360, paused: false, protected: false, captions: 1, visible: true },
  start: 2, end: 2.25, warnings: [], transcriptSource: "Public captions",
  frames: [{ timestamp: 2, image: "data:image/jpeg;base64,AA==", brightness: .2, contrast: .1, warmth: .02, motion: 0, heatmap: Array(48).fill(0) }, { timestamp: 2.25, image: "data:image/jpeg;base64,AA==", brightness: .5, contrast: .1, warmth: .02, motion: .3, heatmap: Array(48).fill(.3) }],
  transcript: [{ start: 2, end: 5, text: "The red car turns left." }],
};
export const report = (): VideoReport => buildReport(capture, { faces: [], poses: [], warnings: [] }, null);
describe("local video evidence", () => {
  it("measures luminance, contrast, and spatial motion from pixels", () => {
    const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    expect(frameSignals(black, 2, 1).brightness).toBe(0);
    const measured = frameSignals(white, 2, 1, black);
    expect(measured.brightness).toBeCloseTo(1); expect(measured.motion).toBe(1);
    expect(measured.contrast).toBeCloseTo(0); expect(Math.max(...measured.heatmap)).toBe(1);
  });
  it("estimates a known pitch without selecting a subharmonic and rejects silence", () => {
    const samples = Float32Array.from({ length: 2048 }, (_, i) => .2 * Math.sin(2 * Math.PI * 220 * i / 16000));
    expect(estimatePitch(samples, 16000)).toBeGreaterThan(215);
    expect(estimatePitch(samples, 16000)).toBeLessThan(225);
    expect(estimatePitch(new Float32Array(2048), 16000)).toBeNull();
  });
  it("parses real VTT timestamps, cue identifiers, tags and settings", () => {
    expect(parseVtt("WEBVTT\n\ncue-1\n00:01:02.500 --> 00:01:05.000 align:start\n<v Speaker>Look &amp; listen.</v>\n\n00:02.000 --> 00:01.000\ninvalid")).toEqual([{ start: 62.5, end: 65, text: "Look & listen." }]);
  });
  it("returns a useful report even when visual models or captions are unavailable", () => {
    const result = buildReport({ ...capture, frames: [], transcript: [] }, { faces: [], poses: [], warnings: ["Model failed"] }, null);
    expect(result.summary.join(" ")).toContain("unavailable"); expect(result.warnings).toContain("Model failed");
    expect(result.authenticity.probability).toBeNull(); expect(result.authenticity.verdict).toBe("Inconclusive");
  });
  it("creates timestamped scene/lighting evidence without invented authenticity scores", () => {
    const result = report(); expect(result.events.map((e) => e.event)).toContain("lighting");
    expect(result.events.every((e) => e.timestamp === 2.25)).toBe(true);
    expect(result.authenticity.probability).toBeNull();
  });
  it("retrieves caption evidence and refuses unsupported mental state / authenticity claims", () => {
    expect(answerLocally(report(), "What did the car do?").text).toContain("red car turns left");
    expect(answerLocally(report(), "Is the person telling the truth?").text).toContain("cannot establish");
    expect(answerLocally(report(), "Is this AI generated?").text).toContain("No validated deepfake classifier");
    const elapsed = { ...report(), transcriptClock: "elapsed" as const };
    expect(answerLocally(elapsed, "car").timestamps).toEqual([]);
  });
  it("searches transcript text and produces escaped downloadable reports", () => {
    const result = report(); result.source.title = "<script>alert(1)</script>";
    expect(searchReports([result], "red car")).toHaveLength(1); expect(searchReports([result], "absent")).toHaveLength(0);
    const html = detailedReportHtml(result); expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
  });
});
describe("cloud boundary", () => {
  it("only permits TLS providers or explicit loopback development", () => {
    expect(validateBackend("https://example.org/").permission).toBe("https://example.org/*");
    expect(validateBackend("http://localhost:3000").base).toBe("http://localhost:3000");
    expect(() => validateBackend("http://public.example.org")).toThrow();
    expect(() => validateBackend("https://secret@example.org")).toThrow();
  });
  it("rejects stale, canceled, future, and absent entitlements", () => {
    const now = new Date("2026-10-16T00:00:00Z");
    const sub = { user_id: "user", status: "active", period_start: new Date("2026-10-01"), period_end: new Date("2026-11-01") };
    expect(isEntitled(sub, now)).toBe(true); expect(isEntitled({ ...sub, status: "canceled" }, now)).toBe(false);
    expect(isEntitled(sub, new Date("2026-12-01"))).toBe(false); expect(isEntitled(sub, new Date("2026-09-01"))).toBe(false); expect(isEntitled(undefined, now)).toBe(false);
  });
  it("enforces credit, per-request, per-user, and global cost ceilings", () => {
    expect(() => checkBudget(60, 0, 0, 1)).toThrow("credit");
    expect(() => checkBudget(0, 0, 0, 6)).toThrow("cost");
    expect(() => checkBudget(0, 100, 0, 1)).toThrow("cost");
    expect(() => checkBudget(0, 0, 10000, 1)).toThrow("cost");
    expect(() => checkBudget(0, 0, 0, 1)).not.toThrow();
  });
  it("bounds reports, images and provider input before reserving usage", () => {
    expect(() => validateCloudRequest({ requestId: "id", question: "?", reports: Array(4).fill({ frames: [] }) })).toThrow();
    expect(() => validateCloudRequest({ requestId: "id", question: "?", reports: [{ frames: [{ timestamp: 0, image: "https://attacker.example/image" }] }] })).toThrow();
    expect(() => validateCloudRequest({ requestId: "id", question: "?", reports: [{ frames: [], transcript: "a".repeat(30000) }] })).toThrow();
    expect(validateCloudRequest({ requestId: "id", question: "summary", reports: [{ frames: [], summary: ["Observed"] }] }).estimate).toBeGreaterThan(0);
  });
  it("creates canonical audio and enforces duration from PCM bytes on the server", () => {
    const bytes = encodeWav(new Float32Array(48000 * 20), 48000);
    const data = validateWav({ requestId: "id", wav: Buffer.from(bytes).toString("base64") });
    expect(data.seconds).toBe(12); expect(bytes.length).toBe(384044);
    const invalid = Buffer.from(bytes); invalid.writeUInt16LE(2, 22);
    expect(() => validateWav({ requestId: "id", wav: invalid.toString("base64") })).toThrow("mono");
  });
});
