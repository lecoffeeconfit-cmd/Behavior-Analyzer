// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { boundedJson, billingReady, corsHeaders } from "../apps/web/server/config";
import { handleStripeWebhook } from "../apps/web/server/stripe";
import { GET, POST } from "../apps/web/app/api/pro/[operation]/route";
afterEach(() => vi.unstubAllEnvs());
describe("secure optional backend", () => {
  it("Free status works while every backend integration is absent", async () => {
    vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("SUPABASE_URL", "");
    const response = await GET(new Request("http://localhost/api/pro/status"), { params: Promise.resolve({ operation: "status" }) });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ configured: false, billingReady: false, tier: "free" });
  });
  it("rejects unknown origins rather than using wildcard credential access", () => {
    vi.stubEnv("WEB_ORIGIN", "https://web.example"); vi.stubEnv("CHROME_EXTENSION_IDS", "abc");
    expect(corsHeaders(new Request("https://web.example", { headers: { origin: "chrome-extension://abc" } })).get("Access-Control-Allow-Origin")).toBe("chrome-extension://abc");
    expect(() => corsHeaders(new Request("https://web.example", { headers: { origin: "https://attacker.example" } }))).toThrow("not allowed");
  });
  it("never treats a supplied tier or user id as authentication", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test"); vi.stubEnv("SUPABASE_URL", "https://auth.example"); vi.stubEnv("SUPABASE_ANON_KEY", "public-test");
    const response = await POST(new Request("http://localhost/api/pro/analyze", { method: "POST", body: JSON.stringify({ tier: "pro", userId: "somebody" }) }), { params: Promise.resolve({ operation: "analyze" }) });
    expect(response.status).toBe(401);
  });
  it("bounds streaming JSON even without a content length", async () => {
    await expect(boundedJson(new Request("https://example.org", { method: "POST", body: JSON.stringify({ huge: "a".repeat(1000) }) }), 50)).rejects.toThrow("size limit");
  });
  it("cannot activate live keys, and verifies Stripe signatures before database access", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test"); vi.stubEnv("SUPABASE_URL", "https://auth.example"); vi.stubEnv("SUPABASE_ANON_KEY", "test"); vi.stubEnv("WEB_ORIGIN", "https://web.example");
    vi.stubEnv("BILLING_MODE", "test"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_example"); vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test"); vi.stubEnv("STRIPE_PRICE_ID", "price_test");
    expect(billingReady()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example"); expect(billingReady()).toBe(true);
    await expect(handleStripeWebhook("{}", "invalid")).rejects.toThrow("signature");
    const stripe = new Stripe("sk_test_example"), body = JSON.stringify({ id: "evt_test", type: "unhandled.test", livemode: false, data: { object: {} } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_test" });
    await expect(handleStripeWebhook(body, signature)).resolves.toBeUndefined();
    const live = JSON.stringify({ id: "evt_live", type: "unhandled.test", livemode: true, data: { object: {} } });
    await expect(handleStripeWebhook(live, stripe.webhooks.generateTestHeaderString({ payload: live, secret: "whsec_test" }))).rejects.toThrow("Live billing events");
  });
});
