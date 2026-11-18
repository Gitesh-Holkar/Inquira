/**
 * Members (GOAL G-PLT-2): who belongs to the company and with which role. Adding a person needs no SQL:
 * the sign-in account is found or created through `src/lib/accounts.ts`, then a membership is added.
 *
 * Rules, enforced here (row-level security checks only that the person may manage members):
 * - Owners and admins manage members; only an owner adds, changes or removes an owner or an admin.
 * - Access: on top of the role, an owner or admin switches single abilities on or off for a member
 *   (`setMemberAccess`), but only abilities they have themselves. Owners always have full access.
 *   Changing someone's role resets their custom access to the new role's defaults.
 * - Nobody changes their own role or removes themselves (ask another owner), so a company always keeps
 *   an owner who can sign in. The last owner can never be demoted or removed.
 * - Removing is a soft delete: the person loses access at their next request; history keeps their name.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { accountDirectory, type AccountDirectory } from "@/lib/accounts";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { audit, emit } from "./audit";
import { ABILITIES, ABILITY_IDS, abilitiesFor, can, overridesFor, withRequirements, authorize, type AbilityId } from "./permissions";
import { memberships } from "./schema";
import { defineService, parseInput, runTx } from "./service-kit";
import { actorString, type Ctx, type Role } from "./types";

export const ROLES = ["owner", "admin", "sales", "qa", "accounts", "viewer"] as const satisfies readonly Role[];
const roleSchema = z.enum(ROLES);
const privileged = (r: Role) => r === "owner" || r === "admin";

function actorRole(ctx: Ctx): Role {
  return ctx.actor.kind === "human" ? ctx.actor.role : "owner"; // system jobs (seed, tests) act as the company
}
function assertMayManage(ctx: Ctx, ...roles: Role[]) {
  if (actorRole(ctx) !== "owner" && roles.some(privileged)) throw forbidden("Only an owner can add, change or remove owners and admins.");
}
function assertNotSelf(ctx: Ctx, userId: string, what: string) {
  if (ctx.actor.kind === "human" && ctx.actor.userId === userId) throw new AppError("VALIDATION", `You can't ${what} yourself. Ask another owner.`);
}
async function activeMember(tx: Tx, orgId: string, memberId: string) {
  const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.id, memberId), isNull(memberships.deletedAt)));
  if (!m) throw notFound("Member");
  return m;
}
async function assertAnotherOwner(tx: Tx, orgId: string) {
  const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner"), isNull(memberships.deletedAt)));
  if (n <= 1) throw new AppError("VALIDATION", "A company needs at least one owner. Make someone else an owner first.");
}

export const listMembers = defineService({
  name: "core.listMembers",
  input: z.object({}).default({}),
  permission: "settings.read",
  handler: (ctx, _i, tx) =>
    tx.select({ id: memberships.id, userId: memberships.userId, email: memberships.email, displayName: memberships.displayName, role: memberships.role, granted: memberships.granted, revoked: memberships.revoked, createdAt: memberships.createdAt })
      .from(memberships).where(and(eq(memberships.orgId, ctx.orgId), isNull(memberships.deletedAt))).orderBy(asc(memberships.createdAt)),
});

const inviteInput = z.object({ email: z.string().trim().toLowerCase().email().max(254), role: roleSchema });

/**
 * Adds a person by email. Their sign-in account is found or created first (a network call, outside any
 * transaction); a person removed earlier gets their membership back with the new role.
 */
export async function inviteMember(ctx: Ctx, raw: z.input<typeof inviteInput>, deps: { accounts?: AccountDirectory | null } = {}) {
  const input = parseInput(inviteInput, raw);
  authorize(ctx, "members.manage");
  assertMayManage(ctx, input.role);
  const dir = deps.accounts === undefined ? accountDirectory() : deps.accounts;
  if (!dir) throw new AppError("INTEGRATION", "Adding people needs SUPABASE_SERVICE_ROLE_KEY in the hosting settings (docs/SETUP.md section 2).");
  const account = await dir.findOrCreate(input.email);
  return runTx(ctx, async (tx) => {
    const [existing] = await tx.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, account.id)));
    if (existing && !existing.deletedAt) throw new AppError("CONFLICT", `${input.email} is already a member.`);
    const [row] = existing
      ? await tx.update(memberships).set({ deletedAt: null, role: input.role, email: input.email, granted: [], revoked: [] }).where(eq(memberships.id, existing.id)).returning()
      : await tx.insert(memberships).values({ orgId: ctx.orgId, userId: account.id, email: input.email, role: input.role, createdBy: actorString(ctx.actor) }).returning();
    await audit(tx, ctx, { action: "member.add", entityType: "membership", entityId: row!.id, changes: { email: input.email, role: input.role, accountCreated: account.created, rejoined: !!existing } });
    await emit(tx, ctx, { type: "member.added", entityType: "membership", entityId: row!.id, payload: { role: input.role } });
    return { member: row!, accountKind: dir.kind, accountCreated: account.created };
  });
}

export const changeMemberRole = defineService({
  name: "core.changeMemberRole",
  input: z.object({ memberId: z.string().uuid(), role: roleSchema }),
  permission: "members.manage",
  handler: async (ctx, input, tx) => {
    const m = await activeMember(tx, ctx.orgId, input.memberId);
    assertNotSelf(ctx, m.userId, "change the role of");
    assertMayManage(ctx, m.role, input.role);
    if (m.role === input.role) return m;
    if (m.role === "owner") await assertAnotherOwner(tx, ctx.orgId);
    const hadCustom = m.granted.length + m.revoked.length > 0;
    const [row] = await tx.update(memberships).set({ role: input.role, granted: [], revoked: [] }).where(eq(memberships.id, m.id)).returning();
    await audit(tx, ctx, { action: "member.role", entityType: "membership", entityId: m.id, changes: { email: m.email, role: [m.role, input.role], customAccessReset: hadCustom } });
    await emit(tx, ctx, { type: "member.updated", entityType: "membership", entityId: m.id, payload: { role: input.role } });
    return row!;
  },
});

export const removeMember = defineService({
  name: "core.removeMember",
  input: z.object({ memberId: z.string().uuid() }),
  permission: "members.manage",
  handler: async (ctx, input, tx) => {
    const m = await activeMember(tx, ctx.orgId, input.memberId);
    assertNotSelf(ctx, m.userId, "remove");
    assertMayManage(ctx, m.role);
    if (m.role === "owner") await assertAnotherOwner(tx, ctx.orgId);
    await tx.update(memberships).set({ deletedAt: new Date() }).where(eq(memberships.id, m.id));
    await audit(tx, ctx, { action: "member.remove", entityType: "membership", entityId: m.id, changes: { email: m.email, role: m.role } });
    await emit(tx, ctx, { type: "member.removed", entityType: "membership", entityId: m.id, payload: { role: m.role } });
    return { ok: true };
  },
});

/**
 * Sets which abilities a member has (the full list of abilities that should be on). Abilities a switched-on
 * ability needs are added (for example "See settings"). Only abilities the editor has can be given or taken.
 */
export const setMemberAccess = defineService({
  name: "core.setMemberAccess",
  input: z.object({ memberId: z.string().uuid(), abilities: z.array(z.enum(ABILITY_IDS)).max(ABILITY_IDS.length) }),
  permission: "members.manage",
  handler: async (ctx, input, tx) => {
    const m = await activeMember(tx, ctx.orgId, input.memberId);
    assertNotSelf(ctx, m.userId, "change the access of");
    assertMayManage(ctx, m.role);
    if (m.role === "owner") throw new AppError("VALIDATION", "Owners always have full access.");
    const before = abilitiesFor(m.role, m.granted, m.revoked);
    const after = withRequirements(input.abilities as AbilityId[]);
    const on = ABILITIES.filter((a) => after.has(a.id) && !before.has(a.id));
    const off = ABILITIES.filter((a) => before.has(a.id) && !after.has(a.id));
    const notMine = [...on, ...off].filter((a) => !a.perms.every((p) => can(ctx, p)));
    if (notMine.length) throw forbidden(`You can only give or take away access you have yourself: ${notMine.map((a) => a.label).join("; ")}.`);
    const { granted, revoked } = overridesFor(m.role, after);
    const [row] = await tx.update(memberships).set({ granted, revoked }).where(eq(memberships.id, m.id)).returning();
    await audit(tx, ctx, { action: "member.access", entityType: "membership", entityId: m.id, changes: { email: m.email, role: m.role, on: on.map((a) => a.id), off: off.map((a) => a.id) } });
    await emit(tx, ctx, { type: "member.updated", entityType: "membership", entityId: m.id, payload: { access: true } });
    return row!;
  },
});

