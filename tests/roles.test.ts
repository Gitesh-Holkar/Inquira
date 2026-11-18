/**
 * Roles QA and Accounts and per-member access (GOAL G-PLT-2). Checks that the database's own access rules
 * (drizzle/0008) agree with src/modules/core/permissions.ts, and that switching an ability on or off for a
 * member changes what they can do, both in the app and under row-level security.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb, withSystemTx, withUserTx } from "@/db/client";
import { auditLogs, memberships } from "@/modules/core/schema";
import { priceEntries } from "@/modules/catalog/schema";
import { ABILITIES, BASE_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS, abilitiesFor, can, overridesFor, permissionsFor, withRequirements } from "@/modules/core/permissions";
import { changeMemberRole, listMembers, setMemberAccess } from "@/modules/core/members";
import { getIntegrationInternal, getOrgSettings, listIntegrations, membershipsForUserInternal } from "@/modules/core/service";
import { createProduct, getCurrentRates, updateRates } from "@/modules/catalog/service";
import { uploadDocument } from "@/modules/documents/service";
import { getRulesInternal } from "@/modules/buyleads/service";
import { diskStore } from "@/modules/documents/storage";
import { getDashboard } from "@/modules/dashboard/service";
import { listLeads } from "@/modules/leads/service";
import { addMember, createUser, resetDb, setupOrgWithUser } from "./helpers/db";
import type { Ctx, Role } from "@/modules/core/types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROLES: Role[] = ["owner", "admin", "sales", "qa", "accounts", "viewer"];

/** A member's context the way sign-in builds it: role plus their saved custom access. */
async function memberCtx(orgId: string, userId: string): Promise<Ctx> {
  const [m] = await withSystemTx((tx) => membershipsForUserInternal(tx, userId));
  return { orgId, actor: { kind: "human", userId, email: m!.email, role: m!.role, granted: m!.granted, revoked: m!.revoked } };
}
async function member(orgId: string, role: Role, email?: string) {
  const u = await createUser(email);
  await addMember(orgId, u, role);
  const [row] = await getDb().select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, u.id)));
  return { user: u, memberId: row!.id };
}

describe("role definitions", () => {
  it("every permission is either always on or part of exactly one switchable ability", () => {
    const inAbilities = ABILITIES.flatMap((a) => a.perms as readonly string[]);
    expect(new Set(inAbilities).size).toBe(inAbilities.length);
    expect(inAbilities.filter((p) => BASE_PERMISSIONS.includes(p as never))).toEqual([]);
    expect([...BASE_PERMISSIONS, ...inAbilities].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("each role is the always-on permissions plus whole abilities; owners and admins have everything", () => {
    for (const role of ROLES) {
      const perms = ROLE_PERMISSIONS[role];
      for (const p of BASE_PERMISSIONS) expect(perms.has(p), `${role} ${p}`).toBe(true);
      for (const a of ABILITIES) expect(new Set(a.perms.map((p) => perms.has(p))).size, `${role} ${a.id}`).toBe(1);
    }
    expect(ROLE_PERMISSIONS.owner.size).toBe(PERMISSIONS.length);
    expect(ROLE_PERMISSIONS.admin.size).toBe(PERMISSIONS.length);
    expect([...abilitiesFor("qa")]).toEqual(["manage_documents", "see_settings"]);
    expect([...abilitiesFor("accounts")]).toEqual([]);
  });

  it("custom access round-trips, adds what an ability needs, and never applies to owners", () => {
    const o = overridesFor("qa", ["change_prices"]); // QA without "See settings" and documents, plus prices
    expect(o).toEqual({ granted: ["rates.write"], revoked: ["settings.read", "integrations.read", "documents.write"] });
    expect([...abilitiesFor("qa", o.granted, o.revoked)]).toEqual(["change_prices"]);
    expect([...withRequirements(["manage_claude"])].sort()).toEqual(["manage_claude", "see_settings"]);
    expect(overridesFor("owner", [])).toEqual({ granted: [], revoked: [] });
    expect(permissionsFor("owner", [], ["rates.write"]).has("rates.write")).toBe(true);
  });

  it("the database's role defaults are exactly the app's (drizzle/0008 app.role_default)", async () => {
    const rows = await getDb().execute<{ role: string; perm: string; ok: boolean }>(sql`
      select r.role, p.perm, app.role_default(r.role, p.perm) as ok
      from unnest(string_to_array(${ROLES.join(",")}, ',')) as r(role), unnest(string_to_array(${PERMISSIONS.join(",")}, ',')) as p(perm)`);
    expect(rows).toHaveLength(ROLES.length * PERMISSIONS.length);
    for (const r of rows) expect(r.ok, `${r.role} ${r.perm}`).toBe(ROLE_PERMISSIONS[r.role as Role].has(r.perm as never));
  });
});

describe("custom access per member", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  const store = diskStore(mkdtempSync(path.join(tmpdir(), "inquira-roles-")));
  const pdf = new TextEncoder().encode("%PDF-1.4\ntest\n");

  it("QA adds documents but cannot change prices until an owner allows it; taking it away blocks it again", async () => {
    const { org, ctx: owner } = await setupOrgWithUser("owner");
    const { grades } = await createProduct(owner, { name: "Sample Starch", grades: ["Standard"] });
    const rate = (price: string) => ({ items: [{ gradeId: grades[0]!.id, pricePerKgInr: price, gstPercent: "5", priceBasis: "Ex-factory", packSize: "25 Kg" }] });
    await updateRates(owner, rate("60"));
    const qa = await member(org.id, "qa");

    let ctx = await memberCtx(org.id, qa.user.id);
    await expect(uploadDocument(ctx, { type: "coa", file: { name: "coa.pdf", bytes: pdf } }, { store })).resolves.toBeTruthy();
    await expect(updateRates(ctx, rate("61"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Row-level security refuses the same write even if the app check were skipped.
    await expect(withUserTx(qa.user.id, (tx) => tx.insert(priceEntries).values({ orgId: org.id, gradeId: grades[0]!.id, pricePerKgInr: "1", gstPercent: "5", priceBasis: "x", validFrom: "2026-11-18", createdBy: "test" })))
      .rejects.toThrow();

    await setMemberAccess(owner, { memberId: qa.memberId, abilities: ["manage_documents", "see_settings", "change_prices"] });
    ctx = await memberCtx(org.id, qa.user.id);
    expect(can(ctx, "rates.write")).toBe(true);
    await updateRates(ctx, rate("62"));
    expect((await getCurrentRates(ctx, {}))[0]!.pricePerKgInr).toBe("62.00");

    await setMemberAccess(owner, { memberId: qa.memberId, abilities: ["see_settings"] }); // prices and documents taken away
    ctx = await memberCtx(org.id, qa.user.id);
    await expect(updateRates(ctx, rate("63"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadDocument(ctx, { type: "coa", file: { name: "coa2.pdf", bytes: pdf } }, { store })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(withUserTx(qa.user.id, (tx) => tx.insert(priceEntries).values({ orgId: org.id, gradeId: grades[0]!.id, pricePerKgInr: "1", gstPercent: "5", priceBasis: "x", validFrom: "2026-11-18", createdBy: "test" })))
      .rejects.toThrow();
    const [a] = (await getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.id), eq(auditLogs.action, "member.access")))).slice(-1);
    expect(a!.changes).toMatchObject({ off: ["change_prices", "manage_documents"], on: [] });
  });

  it("Accounts sees leads, rates and company terms but no settings, unless allowed", async () => {
    const { org, ctx: owner } = await setupOrgWithUser("owner");
    const acc = await member(org.id, "accounts");
    await withSystemTx(async (tx) => { // the seed creates these rows; reading never creates them
      await getIntegrationInternal(tx, org.id, "gmail");
      await getIntegrationInternal(tx, org.id, "tradeindia");
      await getRulesInternal(tx, { orgId: org.id, actor: { kind: "system", job: "test" } });
    });
    let ctx = await memberCtx(org.id, acc.user.id);
    await expect(Promise.all([listLeads(ctx, {}), getCurrentRates(ctx, {}), getOrgSettings(ctx, {}), getDashboard(ctx, {})])).resolves.toBeTruthy();
    await expect(listIntegrations(ctx, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setMemberAccess(owner, { memberId: acc.memberId, abilities: ["see_settings"] });
    ctx = await memberCtx(org.id, acc.user.id);
    await expect(listIntegrations(ctx, {})).resolves.toBeTruthy();
  });

  it("nobody gives access they do not have, edits their own access, or changes an owner's; admins leave admins alone", async () => {
    const { org, ctx: owner } = await setupOrgWithUser("owner");
    const admin = await member(org.id, "admin", "admin@example.com");
    const qa = await member(org.id, "qa");
    const ownerRow = (await listMembers(owner, {})).find((m) => m.role === "owner")!;

    await setMemberAccess(owner, { memberId: admin.memberId, abilities: ABILITIES.map((a) => a.id).filter((id) => id !== "change_prices") });
    const adminCtx = await memberCtx(org.id, admin.user.id);
    expect(can(adminCtx, "rates.write")).toBe(false);
    await expect(setMemberAccess(adminCtx, { memberId: qa.memberId, abilities: ["manage_documents", "see_settings", "change_prices"] })).rejects.toThrow(/access you have yourself: Change prices/);
    await setMemberAccess(adminCtx, { memberId: qa.memberId, abilities: ["manage_documents", "see_settings", "create_quotes"] }); // within the admin's own access

    await expect(setMemberAccess(adminCtx, { memberId: admin.memberId, abilities: [] })).rejects.toThrow(/yourself/);
    await expect(setMemberAccess(owner, { memberId: ownerRow.id, abilities: [] })).rejects.toThrow(/yourself/);
    const other = await member(org.id, "admin");
    await expect(setMemberAccess(adminCtx, { memberId: other.memberId, abilities: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const second = await member(org.id, "owner");
    await expect(setMemberAccess(owner, { memberId: second.memberId, abilities: [] })).rejects.toThrow(/Owners always have full access/);
  });

  it("changing a member's role resets their custom access to the new role's defaults", async () => {
    const { org, ctx: owner } = await setupOrgWithUser("owner");
    const qa = await member(org.id, "qa");
    await setMemberAccess(owner, { memberId: qa.memberId, abilities: ["change_prices"] });
    await changeMemberRole(owner, { memberId: qa.memberId, role: "accounts" });
    const [m] = await getDb().select().from(memberships).where(eq(memberships.id, qa.memberId));
    expect(m).toMatchObject({ role: "accounts", granted: [], revoked: [] });
  });
});
