/**
 * Applies drizzle/ migrations to a Supabase project over HTTPS using the Management API
 * (POST /v1/projects/{ref}/database/query). Needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF.
 * Bookkeeping is identical to drizzle's migrator (drizzle.__drizzle_migrations: hash + created_at),
 * so `npm run db:migrate` and this script can be mixed safely.
 *
 *   npm run db:remote:apply            # apply pending migrations
 *   npm run db:remote:apply -- --check # just run `select 1` and list applied migrations
 *   npm run db:remote:apply -- --sql "select count(*) from app.leads"
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)\./)?.[1];
if (!token || !ref) {
  console.error("Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (or NEXT_PUBLIC_SUPABASE_URL).");
  process.exit(1);
}

export async function query<T = Record<string, unknown>>(q: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : []) as T[];
}

const args = process.argv.slice(2);
if (args[0] === "--sql") {
  console.log(JSON.stringify(await query(args[1] ?? "select 1"), null, 2));
  process.exit(0);
}

console.log("Connecting to project", ref, "...");
console.log("select 1 →", JSON.stringify(await query("select 1 as ok, current_database() as db, version() as version")));

await query(`create schema if not exists drizzle;
  create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
const applied = new Set((await query<{ hash: string }>("select hash from drizzle.__drizzle_migrations")).map((r) => r.hash));

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: { idx: number; when: number; tag: string }[];
};
if (args[0] === "--check") {
  console.log(`Applied ${applied.size}/${journal.entries.length} migrations.`);
  process.exit(0);
}

for (const e of journal.entries) {
  const sqlText = readFileSync(`drizzle/${e.tag}.sql`, "utf8");
  const hash = createHash("sha256").update(sqlText).digest("hex");
  if (applied.has(hash)) {
    console.log("✓ already applied", e.tag);
    continue;
  }
  const statements = sqlText.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  // One request = one implicit transaction on the server; wrap explicitly for safety.
  const body = ["begin;", ...statements.map((s) => (s.endsWith(";") ? s : s + ";")),
    `insert into drizzle.__drizzle_migrations (hash, created_at) values ('${hash}', ${e.when});`, "commit;"].join("\n");
  await query(body);
  console.log("→ applied", e.tag);
}
console.log("Done.");
