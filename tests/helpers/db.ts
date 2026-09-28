import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { memberships, organizations, orgSettings } from "@/modules/core/schema";
import type { Ctx, Role } from "@/modules/core/types";

/** Empties every app table (TRUNCATE bypasses the append-only row triggers). */
export async function resetDb() {
  const db = getDb();
  const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'app'`);
  const names = rows.map((r) => `app."${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
  await db.execute(sql`delete from auth.users`);
}

export async function createUser(email = `u-${randomUUID().slice(0, 8)}@example.com`) {
  const id = randomUUID();
  await getDb().execute(sql`insert into auth.users (id, email) values (${id}, ${email})`);
  return { id, email };
}

export async function createOrg(name = `Org ${randomUUID().slice(0, 6)}`) {
  const db = getDb();
  const [org] = await db
    .insert(organizations)
    .values({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), createdBy: "system:test" })
    .returning();
  await db.insert(orgSettings).values({ orgId: org!.id, createdBy: "system:test", features: { gmail: true, tradeindia: true, quotes: true, buyleads: true, mcp: true } });
  return org!;
}

export async function addMember(orgId: string, user: { id: string; email: string }, role: Role) {
  await getDb().insert(memberships).values({ orgId, userId: user.id, email: user.email, role, createdBy: "system:test" });
}

/** An org with one member of the given role, returning a ready-to-use human Ctx. */
export async function setupOrgWithUser(role: Role = "owner") {
  const org = await createOrg();
  const user = await createUser();
  await addMember(org.id, user, role);
  const ctx: Ctx = { orgId: org.id, actor: { kind: "human", userId: user.id, email: user.email, role } };
  return { org, user, ctx };
}

export const systemCtx = (orgId: string): Ctx => ({ orgId, actor: { kind: "system", job: "test" } });
export const mcpCtx = (orgId: string, tokenName = "test-token"): Ctx => ({
  orgId,
  actor: { kind: "mcp", tokenId: randomUUID(), tokenName, scopes: ["mcp"] },
});

/** Drizzle wraps driver errors ("Failed query: ..."); return the root Postgres message. */
export function rootMessage(e: unknown): string {
  let cur: unknown = e;
  let msg = "";
  while (cur && typeof cur === "object") {
    msg = (cur as { message?: string }).message ?? msg;
    cur = (cur as { cause?: unknown }).cause;
  }
  return msg;
}

export async function expectDbError(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    const m = rootMessage(e);
    if (!re.test(m)) throw new Error(`Expected DB error matching ${re}, got: ${m}`);
    return;
  }
  throw new Error(`Expected DB error matching ${re}, but the query succeeded`);
}
