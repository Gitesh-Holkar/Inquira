import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb, withSystemTx } from "@/db/client";
import { isDevAuth } from "./env";
import { DEV_COOKIE, verifyDevSession } from "./dev-auth";
import { supabaseConfigured, supabaseServer } from "./supabase/server";
import { membershipsForUserInternal } from "@/modules/core/service";
import { can, type Permission } from "@/modules/core/permissions";
import type { Ctx, Role } from "@/modules/core/types";

export const ORG_COOKIE = "inquira_org";

export type SessionUser = { id: string; email: string };

export async function getSessionUser(): Promise<SessionUser | null> {
  if (isDevAuth()) {
    const store = await cookies();
    const id = verifyDevSession(store.get(DEV_COOKIE)?.value);
    if (!id) return null;
    const rows = await getDb().execute<{ email: string }>(sql`select email from auth.users where id = ${id}`);
    return rows[0] ? { id, email: rows[0].email } : null;
  }
  if (!supabaseConfigured()) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser(); // verifies the JWT with Supabase Auth
  return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
}

export type AppSession = { user: SessionUser; ctx: Ctx; role: Role; orgName: string; orgs: { orgId: string; orgName: string; role: Role }[] };

/** Current user + org context, or null when signed out / not a member of any org. */
export async function getAppSession(): Promise<AppSession | null> {
  const user = await getSessionUser();
  return user ? appSessionFor(user) : null;
}

/** Org context for a signed-in user, or null when they aren't a member of any organisation. */
export async function appSessionFor(user: SessionUser): Promise<AppSession | null> {
  const mships = await withSystemTx((tx) => membershipsForUserInternal(tx, user.id));
  if (!mships.length) return null;
  const store = await cookies();
  const wanted = store.get(ORG_COOKIE)?.value;
  const m = mships.find((x) => x.orgId === wanted) ?? mships[0]!;
  return {
    user,
    role: m.role,
    orgName: m.orgName,
    orgs: mships.map((x) => ({ orgId: x.orgId, orgName: x.orgName, role: x.role })),
    ctx: { orgId: m.orgId, actor: { kind: "human", userId: user.id, email: user.email || m.email, role: m.role } },
  };
}

/**
 * For pages/actions: redirects to /login when signed out. A signed-in user without a membership
 * goes to /login too, which then explains it (instead of looping back to the sign-in form).
 */
export async function requireSession(perm?: Permission): Promise<AppSession> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const s = await appSessionFor(user);
  if (!s) redirect("/login");
  if (perm && !can(s.ctx, perm)) redirect("/?denied=1");
  return s;
}

/** Local development only: the id of a user in the local auth.users shim. */
export async function devUserIdByEmail(email: string): Promise<string | null> {
  if (!isDevAuth()) return null;
  const rows = await getDb().execute<{ id: string }>(sql`select id from auth.users where lower(email) = ${email.toLowerCase()}`);
  return rows[0]?.id ?? null;
}
