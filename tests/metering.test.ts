// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const embedded = new PGlite();
vi.mock("../apps/web/server/db", () => ({
  database: () => ({ query: async (sql: string, params?: unknown[]) => { const r = await embedded.query(sql, params); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; } }),
  inTransaction: (work: (client: unknown) => Promise<unknown>) => embedded.transaction(async (tx) => work({ query: async (sql: string, params?: unknown[]) => { const r = await tx.query(sql, params); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; } })),
}));
import { entitlement, finishUsage, reserveUsage } from "../apps/web/server/metering";
const user = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => { await embedded.exec(await readFile("apps/web/server/schema.sql", "utf8")); }, 30000);
beforeEach(async () => {
  vi.stubEnv("PRO_MONTHLY_CREDITS", "2"); vi.stubEnv("PRO_MAX_MONTHLY_COST_CENTS", "100");
  await embedded.exec("TRUNCATE va_usage,va_subscriptions CASCADE");
  await embedded.query("INSERT INTO va_subscriptions VALUES($1,'sub_test','cus_test','active',NOW()-INTERVAL '1 day',NOW()+INTERVAL '29 days',1)", [user]);
});
afterAll(async () => { await embedded.close(); vi.unstubAllEnvs(); });
it("atomically limits simultaneous reservations to one in-flight request", async () => {
  const outcomes = await Promise.allSettled([reserveUsage(user, crypto.randomUUID(), 1), reserveUsage(user, crypto.randomUUID(), 1)]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await embedded.query("SELECT * FROM va_usage")).rows).toHaveLength(1);
});
it("rejects duplicate submissions and stops after the real SQL monthly allowance", async () => {
  const id = crypto.randomUUID(); await reserveUsage(user, id, 1); await finishUsage(id, true);
  await expect(reserveUsage(user, id, 1)).rejects.toThrow("already");
  const second = crypto.randomUUID(); await reserveUsage(user, second, 1); await finishUsage(second, true);
  await expect(reserveUsage(user, crypto.randomUUID(), 1)).rejects.toThrow("allowance");
  expect((await entitlement(user)).remaining).toBe(0);
});
it("refunds user credits after failure while retaining cost reservations", async () => {
  const id = crypto.randomUUID(); await reserveUsage(user, id, 4); await finishUsage(id, false);
  const row = (await embedded.query<{ credits: number; cost_cents: number; status: string }>("SELECT * FROM va_usage")).rows[0];
  expect(row).toMatchObject({ credits: 0, cost_cents: 4, status: "failed" });
});
it("renews allowance using the verified subscription period without deleting audit history", async () => {
  const id = crypto.randomUUID(); await reserveUsage(user, id, 1); await finishUsage(id, true);
  await embedded.query("UPDATE va_subscriptions SET period_start=NOW()-INTERVAL '1 hour' WHERE user_id=$1", [user]);
  const status = await entitlement(user); expect(status.used).toBe(0); expect(status.remaining).toBe(2);
  expect((await embedded.query("SELECT * FROM va_usage")).rows).toHaveLength(1);
});
it("rejects inactive subscriptions before creating any ledger row", async () => {
  await embedded.query("UPDATE va_subscriptions SET status='canceled' WHERE user_id=$1", [user]);
  await expect(reserveUsage(user, crypto.randomUUID(), 1)).rejects.toThrow("server-verified");
  expect((await embedded.query("SELECT * FROM va_usage")).rows).toHaveLength(0);
});
