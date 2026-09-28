/**
 * Seeds a Supabase project from an environment WITHOUT direct Postgres access (HTTPS only),
 * e.g. the Claude Code cloud container. From your own machine just use `npm run db:seed`.
 *
 *   1. Creates (or finds) the owner in Supabase Auth via the Admin API (HTTPS).
 *   2. Seeds a scratch LOCAL Postgres through the normal services (same code as db:seed).
 *   3. Dumps the app-schema rows (pg_dump --data-only --inserts) and applies them to the
 *      project through the Management API in one transaction.
 * Refuses to run if the remote project already has an organisation (idempotency).
 *
 * Needs: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, NEXT_PUBLIC_SUPABASE_URL,
 *        SUPABASE_SERVICE_ROLE_KEY, SEED_OWNER_EMAIL, local Postgres binaries (scripts/local-db.sh).
 */
import { execSync } from "node:child_process";
import { ensureSupabaseUser } from "./seed";

const need = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SEED_OWNER_EMAIL"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing env:", missing.join(", "));
  process.exit(1);
}
const ref = process.env.SUPABASE_PROJECT_REF!;
const token = process.env.SUPABASE_ACCESS_TOKEN!;

async function query<T = Record<string, unknown>>(q: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 800)}`);
  return (text ? JSON.parse(text) : []) as T[];
}

const [{ n } = { n: 0 }] = await query<{ n: number }>("select count(*)::int as n from app.organizations");
if (n > 0) {
  console.log(`Remote project already has ${n} organisation(s); nothing to do. (Use the app to change data.)`);
  process.exit(0);
}

const email = process.env.SEED_OWNER_EMAIL!.trim().toLowerCase();
const ownerId = await ensureSupabaseUser(email);
console.log(`Owner ${email} → Supabase Auth user ${ownerId}`);

const local = "postgres://postgres:postgres@127.0.0.1:54322/inquira_remote_seed";
const admin = "postgres://postgres:postgres@127.0.0.1:54322/postgres";
const sh = (cmd: string, env: Record<string, string> = {}) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, ...env } }).toString();
sh("bash scripts/local-db.sh up");
sh(`psql ${admin} -q -c "drop database if exists inquira_remote_seed with (force)" -c "create database inquira_remote_seed"`);
sh(`psql ${local} -q -f scripts/local-db/supabase-shim.sql`);
sh("npx tsx scripts/db-migrate.ts", { DATABASE_URL: local });
console.log(sh("npx tsx scripts/seed.ts", { DATABASE_URL: local, SEED_OWNER_USER_ID: ownerId, SEED_LOCAL_AUTH: "1" }));

// Keep the whole dump (INSERTs can span lines) minus psql meta-commands (\restrict …) and
// settings a non-superuser can't change. pg_dump orders tables by foreign-key dependency.
const dump = sh(`pg_dump ${local} --data-only --schema=app --inserts --column-inserts --no-owner --no-privileges`)
  .split("\n")
  .filter((l) => !l.startsWith("\\") && !/^SET (row_security|transaction_timeout)/.test(l))
  .join("\n");
const count = (dump.match(/^INSERT INTO /gm) ?? []).length;
console.log(`Applying ${count} rows to project ${ref}…`);
await query(`begin;\n${dump}\ncommit;`);
const check = await query<{ orgs: number; products: number; rates: number; members: number }>(
  "select (select count(*)::int from app.organizations) orgs, (select count(*)::int from app.products) products, (select count(*)::int from app.price_entries) rates, (select count(*)::int from app.memberships) members",
);
console.log("Remote now has:", JSON.stringify(check[0]));
sh(`psql ${admin} -q -c "drop database if exists inquira_remote_seed with (force)"`);
console.log(`Done. Sign in at your app URL with "Forgot password?" → ${email} to set a password.`);
