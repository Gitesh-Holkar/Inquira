/**
 * Sign-in accounts adapter (GOAL G-PLT-2, G-PLT-6): finds or creates the sign-in account for an email
 * address so that person can be made a member. It never sets a password: the person sets their own
 * with "Forgot password? / First time here?" on the sign-in page.
 *
 * - Supabase sign-in: the Supabase Auth admin API with the service role key (server only, never sent
 *   to a browser). Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * - Development sign-in (local only): the local auth.users table.
 * - Local mode (milestone M2) adds its own implementation here.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { AppError } from "./errors";
import { env, isDevAuth } from "./env";

export type AccountKind = "supabase" | "local";
export type AccountDirectory = { kind: AccountKind; findOrCreate(email: string): Promise<{ id: string; created: boolean }> };

/**
 * Supabase Auth: the user with this email, or a new confirmed user without a password.
 * Pages through the admin user list (200 a page, up to 4,000 users) before creating.
 */
export async function findOrCreateSupabaseUser(cfg: { url: string; serviceKey: string }, email: string, f: typeof fetch = fetch): Promise<{ id: string; created: boolean }> {
  const headers = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" };
  const base = cfg.url.replace(/\/$/, "");
  for (let page = 1; page <= 20; page++) {
    const res = await f(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) throw new AppError("INTEGRATION", `Supabase Auth could not list users (${res.status}). Check SUPABASE_SERVICE_ROLE_KEY.`);
    const body = (await res.json()) as { users: { id: string; email?: string }[] };
    const hit = body.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return { id: hit.id, created: false };
    if (body.users.length < 200) break;
  }
  const res = await f(`${base}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email, email_confirm: true }) });
  if (!res.ok) throw new AppError("INTEGRATION", `Supabase Auth could not create the account (${res.status}).`);
  return { id: ((await res.json()) as { id: string }).id, created: true };
}

/** Which kind of accounts this deployment can create, or null when it cannot (shown on the Members screen). */
export function accountKind(): AccountKind | null {
  if (isDevAuth()) return "local";
  const e = env();
  return e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : null;
}

export function accountDirectory(deps: { fetchImpl?: typeof fetch } = {}): AccountDirectory | null {
  const kind = accountKind();
  if (kind === "local") {
    return {
      kind,
      async findOrCreate(email) {
        const db = getDb();
        const [row] = await db.execute<{ id: string }>(sql`select id from auth.users where lower(email) = ${email}`);
        if (row) return { id: row.id, created: false };
        const id = randomUUID();
        await db.execute(sql`insert into auth.users (id, email) values (${id}, ${email})`);
        return { id, created: true };
      },
    };
  }
  if (kind === "supabase") {
    const e = env();
    return { kind, findOrCreate: (email) => findOrCreateSupabaseUser({ url: e.NEXT_PUBLIC_SUPABASE_URL!, serviceKey: e.SUPABASE_SERVICE_ROLE_KEY! }, email, deps.fetchImpl) };
  }
  return null;
}
