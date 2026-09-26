import { getJobSnapshot, removeJob } from "../../../../lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const snapshot = getJobSnapshot(jobId);
  if (!snapshot) return Response.json({ error: "Job not found or already deleted." }, { status: 404 });
  return Response.json(snapshot, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const removed = await removeJob(jobId);
  if (!removed && getJobSnapshot(jobId)?.status === "processing") return Response.json({ error: "The analysis is still processing." }, { status: 409 });
  return Response.json({ deleted: true });
}
