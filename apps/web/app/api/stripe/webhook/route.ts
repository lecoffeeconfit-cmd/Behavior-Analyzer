import { ApiError } from "../../../../server/config";
import { handleStripeWebhook } from "../../../../server/stripe";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 200000) throw new ApiError(413, "Webhook too large.");
    const text = await request.text(); if (text.length > 200000) throw new ApiError(413, "Webhook too large.");
    await handleStripeWebhook(text, request.headers.get("stripe-signature") || "");
    return Response.json({ received: true });
  } catch (error) { return Response.json({ error: error instanceof ApiError ? error.message : "Webhook processing failed." }, { status: error instanceof ApiError ? error.status : 503 }); }
}
