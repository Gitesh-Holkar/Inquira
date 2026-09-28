import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
export const TEST_DB = "inquira_test";

/** Recreates the test database from migrations once per `vitest run`. */
export default async function setup() {
  try {
    execSync("bash scripts/local-db.sh up", { stdio: "ignore" });
  } catch {
    // A reachable Postgres given via TEST_ADMIN_DATABASE_URL is fine too.
  }
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${TEST_DB} with (force)`);
  await admin.unsafe(`create database ${TEST_DB}`);
  await admin.end();

  const url = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
  const c = postgres(url, { max: 1, onnotice: () => {} });
  await c.unsafe(readFileSync("scripts/local-db/supabase-shim.sql", "utf8"));
  await migrate(drizzle(c), { migrationsFolder: "drizzle" });
  await c.end();
  process.env.DATABASE_URL = url;
}
