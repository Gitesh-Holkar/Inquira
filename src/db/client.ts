import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { env } from "@/lib/env";

function createDb(url: string) {
  const client = postgres(url, {
    // Supabase transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    max: env().DB_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  return { client, db: drizzle(client, { schema, casing: "snake_case" }) };
}

type DbBundle = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __inquiraDb?: DbBundle };

export function getDb() {
  if (!g.__inquiraDb) g.__inquiraDb = createDb(env().DATABASE_URL);
  return g.__inquiraDb.db;
}

export async function closeDb() {
  if (g.__inquiraDb) {
    await g.__inquiraDb.client.end({ timeout: 5 });
    g.__inquiraDb = undefined;
  }
}

export type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the root db or a transaction. */
export type Executor = Db | Tx;

/**
 * Runs `fn` in a transaction as Postgres role `authenticated` with the user's id in
 * request.jwt.claims, exactly like Supabase's Data API does, so RLS policies apply.
 */
export async function withUserTx<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/** System actors (cron jobs, MCP) run as the table owner; services MUST scope every query by org_id. */
export async function withSystemTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}
