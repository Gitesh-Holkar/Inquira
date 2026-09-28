import { execSync } from "node:child_process";

/** Fresh e2e database: shim + migrations + seed + demo data (local Postgres only). */
export default async function globalSetup() {
  const admin = "postgres://postgres:postgres@127.0.0.1:54322/postgres";
  const url = "postgres://postgres:postgres@127.0.0.1:54322/inquira_e2e";
  const run = (cmd: string, env: Record<string, string> = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
  run("bash scripts/local-db.sh up");
  run(`psql ${admin} -q -c "drop database if exists inquira_e2e with (force)" -c "create database inquira_e2e"`);
  run(`psql ${url} -q -f scripts/local-db/supabase-shim.sql`);
  run("npx tsx scripts/db-migrate.ts", { DATABASE_URL: url });
  run("npx tsx scripts/seed.ts", { DATABASE_URL: url, SEED_OWNER_EMAIL: "owner@example.com", SEED_LOCAL_AUTH: "1", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" });
  run("npx tsx scripts/demo-data.ts", { DATABASE_URL: url });
}
