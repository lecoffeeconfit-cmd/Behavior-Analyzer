import { createUrlJob } from "../../../../lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) return Response.json({ error: "Paste a direct video URL first." }, { status: 400 });
    const jobId = await createUrlJob(body.url.trim());
    return Response.json({ jobId }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The video URL could not be accepted." }, { status: 400 });
  }
}
