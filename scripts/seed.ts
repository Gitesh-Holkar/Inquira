/**
 * Seeds the organisation, owner account, catalog, rates, templates and rules. Idempotent.
 *   SEED_OWNER_EMAIL=you@company.com npm run db:seed
 * Owner account:
 *   - With NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: created (or found) in Supabase Auth.
 *     Set a password via "Forgot password" on the login page (see docs/SETUP.md §4).
 *   - Otherwise (local dev): a row in the local auth.users shim.
 *   - SEED_OWNER_USER_ID skips account creation and just uses that id.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { closeDb } from "@/db/client";
import { seed } from "@/server/seed";

/** Accepts "you@x.com", "<you@x.com>" or "Name <you@x.com>" (people paste all three). */
export function parseOwnerEmail(raw: string | undefined): string | null {
  const m = (raw ?? "").match(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/);
  return m ? m[0].toLowerCase() : null;
}
export const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");

const email = parseOwnerEmail(process.env.SEED_OWNER_EMAIL ?? "owner@example.com") ?? "";
const orgName = process.env.SEED_ORG_NAME ?? "STDM Food & Beverages Pvt. Ltd.";

export async function ensureSupabaseUser(emailAddr: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) throw new Error(`Supabase admin users list failed: ${res.status}`);
    const body = (await res.json()) as { users: { id: string; email?: string }[] };
    const hit = body.users.find((u) => u.email?.toLowerCase() === emailAddr);
    if (hit) return hit.id;
    if (body.users.length < 200) break;
  }
  const res = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email: emailAddr, email_confirm: true }) });
  if (!res.ok) throw new Error(`Supabase create user failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

async function ensureLocalUser(emailAddr: string): Promise<string> {
  const c = postgres(process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", { max: 1, onnotice: () => {} });
  try {
    const [row] = await c`select id from auth.users where lower(email) = ${emailAddr}`;
    if (row) return row.id as string;
    const id = randomUUID();
    await c`insert into auth.users (id, email) values (${id}, ${emailAddr})`;
    return id;
  } finally {
    await c.end();
  }
}

const isMain = /scripts\/seed\.ts$/.test(process.argv[1] ?? "");
if (isMain) {
  if (!email) {
    console.error("SEED_OWNER_EMAIL must contain an email address, e.g. you@company.com");
    process.exit(1);
  }
  try {
    const useSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) && process.env.SEED_LOCAL_AUTH !== "1";
    const ownerUserId = process.env.SEED_OWNER_USER_ID ?? (useSupabase ? await ensureSupabaseUser(email) : await ensureLocalUser(email));
    console.log(`Owner: ${maskEmail(email)} (${useSupabase ? "Supabase Auth" : "local"} user ${ownerUserId})`);
    await seed({ orgName, ownerUserId, ownerEmail: email, log: (s) => console.log(s) });
    if (useSupabase) console.log("Next: open the app, click 'Forgot password?' and enter your email to set your password.");
  } finally {
    await closeDb();
  }
}
