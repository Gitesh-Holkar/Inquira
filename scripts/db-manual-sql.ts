/**
 * Prints the SQL to apply pending migrations by hand, for someone who has only the database's SQL
 * editor (Supabase → SQL Editor): paste, run once. It records each migration the same way
 * `npm run db:migrate` and `npm run db:remote:apply` do, so all three can be mixed.
 *
 *   npm run db:manual-sql -- 0003_org_payment_terms 0004_org_price_list_map
 *   npm run db:manual-sql              # every migration in the journal (for a look; apply only what is pending)
 *
 * Running the output twice is harmless: the second run fails on its first statement and changes nothing.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { when: number; tag: string }[] };
const wanted = process.argv.slice(2);
const unknown = wanted.filter((t) => !journal.entries.some((e) => e.tag === t));
if (unknown.length) {
  console.error(`Not in drizzle/meta/_journal.json: ${unknown.join(", ")}`);
  process.exit(1);
}
const out = ["begin;"];
for (const e of journal.entries.filter((e) => !wanted.length || wanted.includes(e.tag))) {
  const text = readFileSync(`drizzle/${e.tag}.sql`, "utf8");
  const hash = createHash("sha256").update(text).digest("hex");
  out.push(`-- ${e.tag}`, ...text.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean).map((s) => (s.endsWith(";") ? s : `${s};`)));
  out.push(`insert into drizzle.__drizzle_migrations (hash, created_at) values ('${hash}', ${e.when});`);
}
out.push("commit;");
console.log(out.join("\n"));
