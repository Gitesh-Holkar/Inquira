/**
 * Members screen (GOAL G-PLT-2): adding a teammate needs no SQL. Every call runs as a signed-in person
 * under row-level security, the way the Settings → Members screen calls it.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { auditLogs } from "@/modules/core/schema";
import { membershipsForUserInternal } from "@/modules/core/service";
import { changeMemberRole, inviteMember, listMembers, removeMember } from "@/modules/core/members";
import { findOrCreateSupabaseUser, type AccountDirectory } from "@/lib/accounts";
import { listLeads } from "@/modules/leads/service";
import { addMember, createUser, mcpCtx, resetDb, setupOrgWithUser } from "./helpers/db";
import type { Ctx, Role } from "@/modules/core/types";

const human = (orgId: string, user: { id: string; email: string }, role: Role): Ctx => ({ orgId, actor: { kind: "human", userId: user.id, email: user.email, role } });
/** A sign-in directory backed by the local auth.users table, like development sign-in. */
const accounts: AccountDirectory = {
  kind: "supabase",
  async findOrCreate(email) {
    const [row] = await getDb().execute<{ id: string }>(sql`select id from auth.users where lower(email) = ${email}`);
    if (row) return { id: row.id, created: false };
    return { id: (await createUser(email)).id, created: true };
  },
};

describe("members (G-PLT-2)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("an owner adds a teammate by email; the teammate can then use the app; it is audited", async () => {
    const { org, ctx, user } = await setupOrgWithUser("owner");
    const r = await inviteMember(ctx, { email: "  Asha@Example.com ", role: "sales" }, { accounts });
    expect(r).toMatchObject({ accountKind: "supabase", accountCreated: true, member: { email: "asha@example.com", role: "sales" } });
    expect((await listMembers(ctx, {})).map((m) => [m.email, m.role])).toEqual([[user.email, "owner"], ["asha@example.com", "sales"]]);
    // The new person has a membership, so their sign-in now opens the company.
    const ms = await withSystemTx((tx) => membershipsForUserInternal(tx, r.member.userId));
    expect(ms).toMatchObject([{ orgId: org.id, role: "sales" }]);
    await expect(listLeads(human(org.id, { id: r.member.userId, email: "asha@example.com" }, "sales"), {})).resolves.toBeTruthy();
    const [a] = await getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.id), eq(auditLogs.action, "member.add")));
    expect(a).toMatchObject({ actor: `human:${user.id}`, changes: { email: "asha@example.com", role: "sales", accountCreated: true } });
    await expect(inviteMember(ctx, { email: "asha@example.com", role: "viewer" }, { accounts })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a removed member loses access, and adding them again restores it with the new role", async () => {
    const { org, ctx } = await setupOrgWithUser("owner");
    const { member } = await inviteMember(ctx, { email: "ravi@example.com", role: "sales" }, { accounts });
    await removeMember(ctx, { memberId: member.id });
    expect(await withSystemTx((tx) => membershipsForUserInternal(tx, member.userId))).toEqual([]);
    expect((await listMembers(ctx, {})).map((m) => m.email)).not.toContain("ravi@example.com");
    const again = await inviteMember(ctx, { email: "ravi@example.com", role: "viewer" }, { accounts });
    expect(again.member).toMatchObject({ id: member.id, role: "viewer" });
    expect(await withSystemTx((tx) => membershipsForUserInternal(tx, member.userId))).toMatchObject([{ orgId: org.id, role: "viewer" }]);
  });

  it("admins manage sales and viewers, but only an owner touches owners and admins; sales and viewers manage nobody", async () => {
    const { org, ctx: owner } = await setupOrgWithUser("owner");
    const a = await createUser("admin@example.com");
    await addMember(org.id, a, "admin");
    const admin = human(org.id, a, "admin");
    const { member: sales } = await inviteMember(admin, { email: "sales@example.com", role: "sales" }, { accounts });
    await changeMemberRole(admin, { memberId: sales.id, role: "viewer" });
    await expect(inviteMember(admin, { email: "boss@example.com", role: "owner" }, { accounts })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeMemberRole(admin, { memberId: sales.id, role: "admin" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ownerRow = (await listMembers(owner, {})).find((m) => m.role === "owner")!;
    await expect(removeMember(admin, { memberId: ownerRow.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await changeMemberRole(owner, { memberId: sales.id, role: "admin" }); // an owner can

    for (const role of ["sales", "viewer"] as const) {
      const u = await createUser();
      await addMember(org.id, u, role);
      const c = human(org.id, u, role);
      await expect(inviteMember(c, { email: "x@example.com", role: "viewer" }, { accounts })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(removeMember(c, { memberId: sales.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(inviteMember(mcpCtx(org.id), { email: "x@example.com", role: "viewer" }, { accounts })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("nobody can lock the company out: no changing your own role, no removing yourself, always one owner", async () => {
    const { ctx: owner } = await setupOrgWithUser("owner");
    const me = (await listMembers(owner, {}))[0]!;
    await expect(changeMemberRole(owner, { memberId: me.id, role: "admin" })).rejects.toThrow(/yourself/);
    await expect(removeMember(owner, { memberId: me.id })).rejects.toThrow(/yourself/);
    // A system job (no "self") still cannot remove or demote the last owner.
    const sys: Ctx = { orgId: owner.orgId, actor: { kind: "system", job: "test" } };
    await expect(removeMember(sys, { memberId: me.id })).rejects.toThrow(/at least one owner/);
    await expect(changeMemberRole(sys, { memberId: me.id, role: "viewer" })).rejects.toThrow(/at least one owner/);
    // With a second owner, one owner can remove the other.
    const { member: second } = await inviteMember(owner, { email: "partner@example.com", role: "owner" }, { accounts });
    await removeMember(owner, { memberId: second.id });
  });

  it("another company's member is not found; without a sign-in directory adding is refused with the reason", async () => {
    const { ctx: a } = await setupOrgWithUser("owner");
    const { ctx: b } = await setupOrgWithUser("owner");
    const bMember = (await listMembers(b, {}))[0]!;
    await expect(removeMember(a, { memberId: bMember.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(inviteMember(a, { email: "z@example.com", role: "sales" }, { accounts: null })).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("Supabase sign-in accounts", () => {
  it("finds an existing user by email, otherwise creates a confirmed user without a password", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const users = [{ id: "u-1", email: "Existing@Example.com" }];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer service-key");
      if (url.includes("/auth/v1/admin/users?page=")) return new Response(JSON.stringify({ users }), { status: 200 });
      if (url.endsWith("/auth/v1/admin/users") && init?.method === "POST") return new Response(JSON.stringify({ id: "u-new" }), { status: 200 });
      throw new Error(`unexpected call ${url}`);
    }) as typeof fetch;
    const cfg = { url: "https://proj.supabase.example/", serviceKey: "service-key" };
    expect(await findOrCreateSupabaseUser(cfg, "existing@example.com", f)).toEqual({ id: "u-1", created: false });
    expect(await findOrCreateSupabaseUser(cfg, "new@example.com", f)).toEqual({ id: "u-new", created: true });
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ email: "new@example.com", email_confirm: true }); // no password is ever set
  });
});
