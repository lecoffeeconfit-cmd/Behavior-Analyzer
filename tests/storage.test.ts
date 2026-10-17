import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { clearReports, deleteReport, listReports, saveReport } from "../packages/shared/src/storage";
import { buildReport } from "../packages/analysis/src/report";
import type { CaptureResult } from "../packages/shared/src/types";
beforeEach(clearReports);
it("persists reports across reads, updates by ID, and deletes without a backend", async () => {
  const report = buildReport({ source: { title: "Local file" }, frames: [], transcript: [], warnings: [], transcriptSource: "None", start: 0, end: 0 } as unknown as CaptureResult, { faces: [], poses: [], warnings: [] }, null);
  await saveReport(report); expect((await listReports())[0].id).toBe(report.id);
  await saveReport({ ...report, summary: ["Updated locally"] }); expect(await listReports()).toHaveLength(1);
  expect((await listReports())[0].summary).toEqual(["Updated locally"]);
  await deleteReport(report.id); expect(await listReports()).toEqual([]);
});
