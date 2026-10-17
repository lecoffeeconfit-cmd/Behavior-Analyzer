import { database, inTransaction } from "./db";
import { ApiError, billingReady, configured, settings } from "./config";
import type { Entitlement } from "@video-analyzer/shared/plans";
export interface Subscription { user_id: string; status: string; period_start: Date; period_end: Date }
export function isEntitled(subscription: Subscription | undefined, now = new Date()) { return !!subscription && ["active", "trialing"].includes(subscription.status) && new Date(subscription.period_start) <= now && new Date(subscription.period_end) > now; }
export function checkBudget(credits: number, cost: number, globalCost: number, estimate: number, limits = settings()) {
  if (credits + limits.requestCredits > limits.monthlyCredits) throw new ApiError(429, "Monthly AI credit allowance reached. Free local analysis remains available.");
  if (estimate > limits.maxRequestCostCents || cost + estimate > limits.maxUserCostCents || globalCost + estimate > limits.maxGlobalCostCents) throw new ApiError(429, "The configured processing cost limit was reached. Reduce the request or use local analysis.");
}
export async function entitlement(userId?: string): Promise<Entitlement> {
  const limits = settings();
  const base: Entitlement = { configured: configured(), billingReady: billingReady(), authenticated: !!userId, tier: "free", monthlyPriceCents: limits.priceCents, currency: "USD", allowance: limits.monthlyCredits, used: 0, remaining: 0, requestCredits: limits.requestCredits, estimatedMaxCostCents: limits.maxRequestCostCents, renewsAt: null, capabilities: [] };
  if (!userId) return base;
  const sub = (await database().query<Subscription>("SELECT * FROM va_subscriptions WHERE user_id=$1", [userId])).rows[0];
  if (!isEntitled(sub)) return base;
  const total = (await database().query("SELECT COALESCE(SUM(credits),0)::int AS used, COALESCE(SUM(cost_cents),0)::int AS cost FROM va_usage WHERE user_id=$1 AND period_start=$2", [userId, sub.period_start])).rows[0];
  return { ...base, tier: "pro", used: total.used, remaining: Math.max(0, limits.monthlyCredits - total.used), processingBudgetRemainingCents: Math.max(0, limits.maxUserCostCents - total.cost), renewsAt: new Date(sub.period_end).toISOString(), capabilities: ["questions", "comparison", "detailed_reports", ...(process.env.AI_TRANSCRIPTION_MODEL ? ["transcription"] : [])] };
}
export async function reserveUsage(userId: string, requestId: string, estimateCostCents: number) {
  if (!/^[a-f\d-]{36}$/i.test(requestId)) throw new ApiError(400, "A unique request identifier is required.");
  if (!Number.isInteger(estimateCostCents) || estimateCostCents <= 0) throw new ApiError(400, "A valid server-side cost reservation is required.");
  return inTransaction(async (client) => {
    // A global transaction lock makes concurrent per-user AND global budget checks atomic.
    await client.query("SELECT pg_advisory_xact_lock(80417211)");
    const sub = (await client.query<Subscription>("SELECT * FROM va_subscriptions WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
    if (!isEntitled(sub)) throw new ApiError(403, "An active, server-verified Pro subscription is required.");
    if ((await client.query("SELECT id FROM va_usage WHERE id=$1", [requestId])).rowCount) throw new ApiError(409, "This request has already been submitted. It was not charged again.");
    const active = (await client.query("SELECT COUNT(*)::int AS count FROM va_usage WHERE user_id=$1 AND status='reserved' AND created_at > NOW()-INTERVAL '2 minutes'", [userId])).rows[0].count;
    if (active >= 1) throw new ApiError(429, "A cloud request is already running. Wait for it to finish.");
    const used = (await client.query("SELECT COALESCE(SUM(credits),0)::int AS credits, COALESCE(SUM(cost_cents),0)::int AS cost FROM va_usage WHERE user_id=$1 AND period_start=$2", [userId, sub.period_start])).rows[0];
    const global = (await client.query("SELECT COALESCE(SUM(cost_cents),0)::int AS cost FROM va_usage WHERE created_at >= date_trunc('month',NOW())")).rows[0].cost;
    const limits = settings(); checkBudget(used.credits, used.cost, global, estimateCostCents, limits);
    await client.query("INSERT INTO va_usage(id,user_id,period_start,credits,cost_cents,status) VALUES($1,$2,$3,$4,$5,'reserved')", [requestId, userId, sub.period_start, limits.requestCredits, estimateCostCents]);
  });
}
export async function finishUsage(requestId: string, success: boolean) {
  // On provider errors/timeouts retain the worst-case COST reservation: the provider
  // may have billed. Refund the user credit without allowing repeated errors to overspend.
  await database().query("UPDATE va_usage SET status=$2,credits=CASE WHEN $3 THEN credits ELSE 0 END WHERE id=$1 AND status='reserved'", [requestId, success ? "complete" : "failed", success]);
}
