import { writeUpload } from "../../../../lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedExtensions = new Set([".mp4", ".mov", ".webm"]);
const allowedTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "application/octet-stream"]);

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length"));
    const maxBytes = Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024;
    if (Number.isFinite(contentLength) && contentLength > maxBytes + 1024 * 1024) return Response.json({ error: "The upload is larger than the configured limit." }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file") || form.get("video");
    if (!(file instanceof File)) return Response.json({ error: "Choose an MP4, MOV, or WebM video first." }, { status: 400 });
    const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!allowedExtensions.has(extension) || (file.type && !allowedTypes.has(file.type))) return Response.json({ error: "Only MP4, MOV, and WebM videos are supported." }, { status: 415 });
    const jobId = await writeUpload(file);
    return Response.json({ jobId }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The video could not be uploaded." }, { status: 400 });
  }
}
