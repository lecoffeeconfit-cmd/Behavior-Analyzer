import { DEFAULT_PLAN } from "@video-analyzer/shared/plans";
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function positive(name: string, fallback: number) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) throw new ApiError(503, `Server setting ${name} must be a positive number.`);
  return value;
}
export function settings() {
  return {
    priceCents: Math.ceil(positive("PRO_PRICE_CENTS", DEFAULT_PLAN.monthlyPriceCents)),
    monthlyCredits: Math.floor(positive("PRO_MONTHLY_CREDITS", 60)),
    requestCredits: Math.ceil(positive("PRO_REQUEST_CREDITS", 1)),
    maxRequestCostCents: positive("PRO_MAX_REQUEST_COST_CENTS", 5),
    maxUserCostCents: positive("PRO_MAX_MONTHLY_COST_CENTS", 100),
    maxGlobalCostCents: positive("PRO_GLOBAL_MONTHLY_COST_CENTS", 10000),
    maxOutputTokens: Math.min(2000, Math.floor(positive("AI_MAX_OUTPUT_TOKENS", 800))),
    // Conservative deployment-specific upper rates. Administrators must match their model's pricing.
    inputCentsPerMillion: positive("AI_INPUT_CENTS_PER_MILLION_TOKENS", 100),
    outputCentsPerMillion: positive("AI_OUTPUT_CENTS_PER_MILLION_TOKENS", 400),
    imageTokenUpperBound: Math.max(6000, positive("AI_IMAGE_TOKEN_UPPER_BOUND", 6000)),
    transcriptionCentsPerMinute: positive("AI_TRANSCRIPTION_CENTS_PER_MINUTE", 10),
  };
}
export function configured() { return !!(process.env.DATABASE_URL && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY); }
export function billingReady() { return configured() && process.env.BILLING_MODE === "test" && !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") && !!process.env.STRIPE_WEBHOOK_SECRET && !!process.env.STRIPE_PRICE_ID && !!process.env.WEB_ORIGIN; }
export function trustedHttpsUrl(value: string | undefined): URL {
  if (!value) throw new ApiError(503, "This optional service has not been configured by the administrator.");
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new ApiError(503, "The server has an invalid service URL.");
  return url;
}
export function corsHeaders(request: Request): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  const origin = request.headers.get("origin");
  if (!origin) return headers; // API uses bearer tokens, never cookie authorization.
  const allowed = [process.env.WEB_ORIGIN, ...(process.env.CHROME_EXTENSION_IDS || "").split(",").filter(Boolean).map((id) => `chrome-extension://${id.trim()}`)];
  if (process.env.NODE_ENV !== "production") allowed.push("http://localhost:3000", "http://127.0.0.1:3000");
  if (!allowed.includes(origin)) throw new ApiError(403, "This client origin is not allowed by the backend.");
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return headers;
}
export async function boundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new ApiError(413, "Request exceeds the processing size limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "A JSON body is required.");
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maxBytes) { await reader.cancel(); throw new ApiError(413, "Request exceeds the processing size limit."); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "Invalid JSON request."); }
}
