import { ApiError, boundedJson, configured, corsHeaders } from "../../../../server/config";
import { authenticate, verifyUser } from "../../../../server/auth";
import { entitlement } from "../../../../server/metering";
import { analyzeCloud, transcribeCloud } from "../../../../server/cloud";
import { createTestCheckout } from "../../../../server/stripe";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };
async function handle(request: Request, context: Context) {
  let headers = new Headers({ "Cache-Control": "no-store" });
  try {
    headers = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const { operation } = await context.params;
    if (request.method === "GET" && operation === "status") {
      const user = configured() && request.headers.has("authorization") ? await verifyUser(request) : undefined;
      return Response.json(await entitlement(user?.id), { headers });
    }
    if (request.method !== "POST") throw new ApiError(404, "Endpoint not found.");
    if (!configured()) throw new ApiError(503, "Pro is not configured on this backend. All Free features remain available locally.");
    if (["login", "register"].includes(operation)) return Response.json(await authenticate(await boundedJson(request, 4096), operation === "register"), { headers });
    const user = await verifyUser(request);
    if (operation === "analyze") return Response.json(await analyzeCloud(user.id, await boundedJson(request, 2_500_000)), { headers });
    if (operation === "transcribe") return Response.json(await transcribeCloud(user.id, await boundedJson(request, 530000)), { headers });
    if (operation === "checkout") {
      if ((await entitlement(user.id)).tier === "pro") throw new ApiError(409, "This account already has an active Pro subscription.");
      return Response.json(await createTestCheckout(user), { headers });
    }
    throw new ApiError(404, "Endpoint not found.");
  } catch (error) {
    return Response.json({ error: error instanceof ApiError ? error.message : "The optional Pro service is unavailable. Local analysis remains available." }, { status: error instanceof ApiError ? error.status : 503, headers });
  }
}
export { handle as GET, handle as POST, handle as OPTIONS };
