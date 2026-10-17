import { Pool } from "pg";
import type { PoolClient } from "pg";
import { ApiError } from "./config";
let pool: Pool | undefined;
export function database() {
  if (!process.env.DATABASE_URL) throw new ApiError(503, "The optional Pro database is not configured.");
  pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true } });
  return pool;
}
export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
