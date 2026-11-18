/**
 * Local sign-in (AUTH_MODE=local, GOAL G-PLT-5): passwords, signed sessions, the first-run owner screen
 * and one-time sign-in links. The first-run screen is the only way to get an account without a link, so
 * it must close for good once anyone is a member, and never open outside local sign-in.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { resetEnvCache } from "@/lib/env";
import { auditLogs, memberships } from "@/modules/core/schema";
import { claimFirstOwner, createSignInLink, inviteMember, isFirstRun, listMembers } from "@/modules/core/members";
import { createSetupLink, findLocalUserByEmail, hashPassword, redeemSetupLink, setLocalPassword, signSession, verifyPassword, verifySession } from "@/lib/local-auth";
import { accountDirectory } from "@/lib/accounts";
import { addMember, createOrg, createUser, resetDb, setupOrgWithUser } from "./helpers/db";
import type { Ctx } from "@/modules/core/types";

function mode(vars: Record<string, string>) {
  vi.unstubAllEnvs();
  vi.stubEnv("VERCEL", "");
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  resetEnvCache();
}
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("passwords and sessions", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("hashes with scrypt, checks in constant time, and refuses short passwords", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("correct horse batterY", h)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "md5$abc")).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow(/at least 10/);
  });

  it("a session is valid only as signed, until it expires, and until the password changes", async () => {
    const u = await createUser("pat@example.com");
    const hash = await setLocalPassword(u.id, "first password 1");
    const now = Date.now();
    const s = signSession(u.id, hash, now);
    expect(await verifySession(s.value, now)).toEqual({ id: u.id, email: "pat@example.com" });
    const [id, exp] = s.value.split(".");
    expect(await verifySession(`${id}.${Number(exp) + 1}.${s.value.split(".")[2]}`, now)).toBeNull(); // longer expiry, same signature
    expect(await verifySession(`${id}.${exp}.AAAA`, now)).toBeNull();
    expect(await verifySession(s.value, Number(exp) * 1000 + 1)).toBeNull(); // expired
    await setLocalPassword(u.id, "second password 2");
    expect(await verifySession(s.value, now)).toBeNull(); // every old session ends with the old password
  });
});

describe("first run of a local install", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lets the first person create the owner account once, then never again", async () => {
    mode({ AUTH_MODE: "local", NODE_ENV: "production" });
    const org = await createOrg("Example Ingredients");
    expect(await isFirstRun()).toBe(true);
    const owner = await claimFirstOwner({ email: "Owner@Example.com", password: "a long password" });
    expect(owner.email).toBe("owner@example.com");
    const [m] = await getDb().select().from(memberships).where(eq(memberships.orgId, org.id));
    expect(m).toMatchObject({ role: "owner", userId: owner.userId });
    expect(await verifyPassword("a long password", (await findLocalUserByEmail("owner@example.com"))!.passwordHash)).toBe(true);
    const [a] = await getDb().select().from(auditLogs).where(eq(auditLogs.action, "member.first_owner"));
    expect(a!.actor).toBe(`human:${owner.userId}`);

    expect(await isFirstRun()).toBe(false);
    await expect(claimFirstOwner({ email: "intruder@example.com", password: "another long one" })).rejects.toThrow(/already has an owner/);
    expect(await getDb().select().from(memberships)).toHaveLength(1);
  });

  it("is closed outside local sign-in, with no company, or with a short password", async () => {
    await createOrg("Example Ingredients");
    const others: Record<string, string>[] = [{ AUTH_MODE: "dev", NODE_ENV: "development" }, { NODE_ENV: "production" }, { AUTH_MODE: "supabase", NODE_ENV: "production" }];
    for (const vars of others) {
      mode(vars);
      expect(await isFirstRun(), JSON.stringify(vars)).toBe(false);
      await expect(claimFirstOwner({ email: "x@example.com", password: "a long password" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    mode({ AUTH_MODE: "local", NODE_ENV: "production" });
    await expect(claimFirstOwner({ email: "x@example.com", password: "short" })).rejects.toThrow(/at least 10/);
    await resetDb();
    expect(await isFirstRun()).toBe(false); // no company at all
  });

  it("two browsers at the same moment: exactly one becomes owner", async () => {
    mode({ AUTH_MODE: "local", NODE_ENV: "production" });
    await createOrg("Example Ingredients");
    const results = await Promise.allSettled([
      claimFirstOwner({ email: "a@example.com", password: "a long password" }),
      claimFirstOwner({ email: "b@example.com", password: "a long password" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getDb().select().from(memberships)).toHaveLength(1);
  });
});

describe("one-time sign-in links", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a new member gets a link, sets a password with it once, and can sign in; old links stop working", async () => {
    mode({ AUTH_MODE: "local", NODE_ENV: "production", APP_URL: "http://localhost:3000" });
    const { org, ctx } = await setupOrgWithUser("owner");
    const r = await inviteMember(ctx, { email: "asha@example.com", role: "sales" }, { accounts: accountDirectory() });
    expect(r.accountKind).toBe("local");
    expect(r.setupLink).toMatch(/^http:\/\/localhost:3000\/login\/set-password\?token=[A-Za-z0-9_-]{43}$/);
    const token = new URL(r.setupLink!).searchParams.get("token")!;
    const user = await redeemSetupLink(token, "asha's long password");
    expect(user).toMatchObject({ email: "asha@example.com" });
    expect(await redeemSetupLink(token, "again a password")).toBeNull(); // once only
    expect(await verifyPassword("asha's long password", (await findLocalUserByEmail("asha@example.com"))!.passwordHash)).toBe(true);

    // A fresh link from Settings → Members replaces the earlier one.
    const member = (await listMembers(ctx, {})).find((m) => m.email === "asha@example.com")!;
    const first = await createSignInLink(ctx, { memberId: member.id });
    const second = await createSignInLink(ctx, { memberId: member.id });
    expect(await redeemSetupLink(new URL(first.url).searchParams.get("token")!, "a new long password")).toBeNull();
    expect(await redeemSetupLink(new URL(second.url).searchParams.get("token")!, "a new long password")).toMatchObject({ email: "asha@example.com" });
    const [a] = await getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.id), eq(auditLogs.action, "member.sign_in_link")));
    expect(a).toBeTruthy();
  });

  it("a link expires after 7 days; malformed tokens are refused", async () => {
    const u = await createUser("late@example.com");
    const link = await createSetupLink(u.id, "http://localhost:3000", Date.now() - 8 * 86400_000);
    expect(await redeemSetupLink(new URL(link.url).searchParams.get("token")!, "a long password!")).toBeNull();
    expect(await redeemSetupLink("../../etc", "a long password!")).toBeNull();
    const [row] = await getDb().execute<{ p: string | null }>(sql`select encrypted_password as p from auth.users where id = ${u.id}`);
    expect(row!.p).toBeNull();
  });

  it("links follow the member rules and exist only with local sign-in", async () => {
    mode({ AUTH_MODE: "local", NODE_ENV: "production" });
    const { org, ctx: owner } = await setupOrgWithUser("owner");
    const a = await createUser("admin@example.com");
    await addMember(org.id, a, "admin");
    const admin: Ctx = { orgId: org.id, actor: { kind: "human", userId: a.id, email: a.email, role: "admin" } };
    const ownerRow = (await listMembers(owner, {})).find((m) => m.role === "owner")!;
    await expect(createSignInLink(admin, { memberId: ownerRow.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createSignInLink(owner, { memberId: ownerRow.id })).rejects.toThrow(/yourself/);
    mode({ NODE_ENV: "production" });
    const adminRow = (await listMembers(owner, {})).find((m) => m.role === "admin")!;
    await expect(createSignInLink(owner, { memberId: adminRow.id })).rejects.toThrow(/Forgot password/);
  });
});
