/**
 * Prepares a local install (GOAL G-PLT-5): keys, database and company data. Run by the Docker image before
 * the app starts (docker/start-app.sh), and safe to run again: every step checks what is already there.
 *
 * 1. Keys: APP_ENCRYPTION_KEY and CRON_SECRET from the environment, else from DATA_DIR/secrets.env, else new
 *    random ones. The effective values are written to DATA_DIR/secrets.env (mode 600) so the app and the
 *    worker use the same keys after every restart. Losing that file means re-entering Gmail/TradeIndia keys.
 * 2. Waits for Postgres, applies scripts/local-db/supabase-shim.sql, then every migration.
 * 3. Seeds SEED_DIR (default seed/example) without an owner: the first person to open Inquira creates it.
 *
 * Refuses to run against a Supabase database: the shim is for a database Inquira owns.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL ?? "";
const dataDir = path.resolve(process.env.DATA_DIR || ".data");
const secretsFile = path.join(dataDir, "secrets.env");
const log = (s: string) => console.log(`[setup] ${s}`);

if (!url) throw new Error("DATABASE_URL is not set.");
if (/supabase\.(co|com)|pooler\.supabase/i.test(url)) throw new Error("Refusing: local setup is for a database Inquira owns, not a Supabase project.");

function readSecrets(): Record<string, string> {
  if (!existsSync(secretsFile)) return {};
  return Object.fromEntries(readFileSync(secretsFile, "utf8").split("\n").map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => [m[1]!, m[2]!]));
}
const saved = readSecrets();
const keys = {
  APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY || saved.APP_ENCRYPTION_KEY || randomBytes(32).toString("base64"),
  CRON_SECRET: process.env.CRON_SECRET || saved.CRON_SECRET || randomBytes(24).toString("base64url"),
};
mkdirSync(dataDir, { recursive: true });
writeFileSync(secretsFile, Object.entries(keys).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
chmodSync(secretsFile, 0o600);
log(saved.APP_ENCRYPTION_KEY ? "Keys loaded" : `Keys created in ${secretsFile} (keep this file; it encrypts saved Gmail and TradeIndia keys)`);
Object.assign(process.env, keys);

const client = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 5 });
for (let i = 1; ; i++) {
  try {
    await client`select 1`;
    break;
  } catch (e) {
    if (i >= 60) throw e;
    if (i === 1) log("Waiting for the database…");
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await client.unsafe(readFileSync(path.join(process.cwd(), "scripts/local-db/supabase-shim.sql"), "utf8"));
await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
await client.end();
log("Database ready");

const { seed } = await import("@/server/seed");
const { closeDb } = await import("@/db/client");
try {
  await seed({ seedDir: path.resolve(process.env.SEED_DIR || "seed/example"), log: (s) => log(s) });
} finally {
  await closeDb();
}
