import { and, desc, eq, isNull, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { notFound } from "@/lib/errors";
import { audit, emit } from "./audit";
import { defineService } from "./service-kit";
import { actorString, type Ctx } from "./types";
import { auditLogs, events, integrations, integrationSecrets, jobs, memberships, organizations, orgSettings, syncRuns } from "./schema";

export type Provider = "gmail" | "tradeindia";
export type Integration = typeof integrations.$inferSelect;

// ---------- org + membership lookups (used by auth) ----------

export async function membershipsForUserInternal(tx: Tx, userId: string) {
  return tx
    .select({ orgId: memberships.orgId, role: memberships.role, email: memberships.email, displayName: memberships.displayName, orgName: organizations.name })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.deletedAt), isNull(organizations.deletedAt)))
    .orderBy(organizations.createdAt);
}

export async function getOrgSettingsInternal(tx: Tx, orgId: string) {
  const [s] = await tx.select().from(orgSettings).where(eq(orgSettings.orgId, orgId));
  const [o] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
  if (!s || !o) throw notFound("Organisation");
  return { ...s, orgName: o.name };
}

export const getOrgSettings = defineService({
  name: "core.getOrgSettings",
  input: z.object({}).default({}),
  permission: "settings.read",
  handler: (ctx, _i, tx) => getOrgSettingsInternal(tx, ctx.orgId),
});

export const updateOrgSettings = defineService({
  name: "core.updateOrgSettings",
  input: z.object({
    quoteValidityDays: z.number().int().min(1).max(60).optional(),
    defaultPriceBasis: z.string().trim().min(1).max(80).optional(),
    features: z.record(z.string(), z.boolean()).optional(),
  }),
  permission: "settings.write",
  handler: async (ctx, input, tx) => {
    const before = await getOrgSettingsInternal(tx, ctx.orgId);
    const patch: Partial<typeof orgSettings.$inferInsert> = {};
    if (input.quoteValidityDays !== undefined) patch.quoteValidityDays = input.quoteValidityDays;
    if (input.defaultPriceBasis !== undefined) patch.defaultPriceBasis = input.defaultPriceBasis;
    if (input.features) patch.features = { ...before.features, ...input.features };
    const [after] = await tx.update(orgSettings).set(patch).where(eq(orgSettings.orgId, ctx.orgId)).returning();
    await audit(tx, ctx, { action: "settings.update", entityType: "org_settings", entityId: after!.id, changes: patch });
    return after!;
  },
});

// ---------- integrations (non-secret state + encrypted secrets) ----------

export async function getIntegrationInternal(tx: Tx, orgId: string, provider: Provider): Promise<Integration> {
  const [row] = await tx.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.provider, provider)));
  if (row) return row;
  const [created] = await tx.insert(integrations).values({ orgId, provider, createdBy: "system:bootstrap" }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await tx.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.provider, provider)));
  return again!;
}

/** Secrets are only ever read here, server-side, for system work. Never returned to UI or MCP. */
export async function readSecretsInternal<T extends Record<string, unknown>>(tx: Tx, integrationId: string): Promise<T | null> {
  const [row] = await tx.select().from(integrationSecrets).where(eq(integrationSecrets.integrationId, integrationId));
  return row ? decryptJson<T>(row.ciphertext) : null;
}

export async function writeSecretsInternal(tx: Tx, ctx: Ctx, integration: Integration, patch: Record<string, unknown>) {
  const current = (await readSecretsInternal(tx, integration.id)) ?? {};
  const next = { ...current, ...patch };
  for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined || next[k] === "") delete next[k];
  const ciphertext = encryptJson(next);
  await tx.insert(integrationSecrets)
    .values({ orgId: ctx.orgId, integrationId: integration.id, ciphertext, createdBy: actorString(ctx.actor) })
    .onConflictDoUpdate({ target: integrationSecrets.integrationId, set: { ciphertext, updatedAt: new Date() } });
  // Audit which secret *fields* changed, never their values.
  await audit(tx, ctx, { action: "integration.secrets_update", entityType: "integration", entityId: integration.id, changes: { fields: Object.keys(patch) } });
  return Object.keys(next);
}

export async function updateIntegrationInternal(tx: Tx, ctx: Ctx, integrationId: string, patch: Partial<typeof integrations.$inferInsert>, auditAction?: string) {
  const [row] = await tx.update(integrations).set(patch).where(and(eq(integrations.id, integrationId), eq(integrations.orgId, ctx.orgId))).returning();
  if (auditAction) await audit(tx, ctx, { action: auditAction, entityType: "integration", entityId: integrationId, changes: sanitizeForAudit(patch) });
  return row!;
}

function sanitizeForAudit(patch: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (k !== "cursor") out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

export async function recordIntegrationSuccess(tx: Tx, ctx: Ctx, integration: Integration, extra: Partial<typeof integrations.$inferInsert> = {}) {
  const now = new Date();
  return updateIntegrationInternal(tx, ctx, integration.id, {
    lastSyncAt: now, lastSuccessAt: now, consecutiveFailures: 0, backoffUntil: null,
    status: integration.status === "error" ? "connected" : integration.status, ...extra,
  });
}

/** Exponential backoff: 10m, 20m, 40m … capped at 6h. */
export function backoffDelayMs(failures: number): number {
  return Math.min(6 * 3600_000, 10 * 60_000 * 2 ** Math.max(0, failures - 1));
}

export async function recordIntegrationFailure(tx: Tx, ctx: Ctx, integration: Integration, message: string, opts: { reauth?: boolean } = {}) {
  const failures = integration.consecutiveFailures + 1;
  const row = await updateIntegrationInternal(tx, ctx, integration.id, {
    lastSyncAt: new Date(), lastError: message.slice(0, 1000), lastErrorAt: new Date(), consecutiveFailures: failures,
    backoffUntil: new Date(Date.now() + backoffDelayMs(failures)),
    status: opts.reauth ? "reauth_required" : "error",
  }, "integration.error");
  await emit(tx, ctx, { type: "integration.error", entityType: "integration", entityId: integration.id, payload: { provider: integration.provider, message: message.slice(0, 300), reauth: !!opts.reauth } });
  return row;
}

/** Status for UI banners; never includes secrets. */
export const listIntegrations = defineService({
  name: "core.listIntegrations",
  input: z.object({}).default({}),
  permission: "integrations.read",
  handler: async (ctx, _i, tx) => {
    const g = await getIntegrationInternal(tx, ctx.orgId, "gmail");
    const t = await getIntegrationInternal(tx, ctx.orgId, "tradeindia");
    return [g, t].map((i) => ({
      id: i.id, provider: i.provider, status: i.status, accountEmail: i.accountEmail, lastSyncAt: i.lastSyncAt,
      lastSuccessAt: i.lastSuccessAt, lastError: i.lastError, lastErrorAt: i.lastErrorAt, enabled: i.enabled,
      config: publicConfig(i.config),
    }));
  },
});

function publicConfig(cfg: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) if (!/secret|token|key|password/i.test(k)) out[k] = v;
  return out;
}

// ---------- sync runs ----------

export async function startSyncRunInternal(tx: Tx, ctx: Ctx, provider: Provider, kind: string) {
  const [r] = await tx.insert(syncRuns).values({ orgId: ctx.orgId, provider, kind, createdBy: actorString(ctx.actor) }).returning();
  return r!;
}

export async function finishSyncRunInternal(tx: Tx, runId: string, r: { status: "ok" | "error" | "partial"; fetched: number; created: number; duplicates: number; errors: number; errorMessage?: string | null; meta?: Record<string, unknown> }) {
  await tx.update(syncRuns).set({ ...r, errorMessage: r.errorMessage ?? null, meta: r.meta ?? {}, finishedAt: new Date() }).where(eq(syncRuns.id, runId));
}

export const listSyncRuns = defineService({
  name: "core.listSyncRuns",
  input: z.object({ provider: z.enum(["gmail", "tradeindia"]).optional(), limit: z.number().int().min(1).max(100).default(20) }),
  permission: "integrations.read",
  handler: (ctx, input, tx) =>
    tx.select().from(syncRuns).where(and(eq(syncRuns.orgId, ctx.orgId), input.provider ? eq(syncRuns.provider, input.provider) : undefined))
      .orderBy(desc(syncRuns.startedAt)).limit(input.limit),
});

// ---------- jobs (outbox work queue) ----------

export async function enqueueJobInternal(tx: Tx, ctx: Ctx, job: { type: string; payload?: Record<string, unknown>; runAfter?: Date; dedupeKey?: string }) {
  const [row] = await tx.insert(jobs).values({
    orgId: ctx.orgId, type: job.type, payload: job.payload ?? {}, runAfter: job.runAfter ?? new Date(),
    dedupeKey: job.dedupeKey ?? null, createdBy: actorString(ctx.actor),
  }).onConflictDoNothing().returning();
  return row ?? null;
}

/** Claims up to `limit` due jobs with SKIP LOCKED so concurrent cron invocations don't collide. */
export async function claimJobsInternal(tx: Tx, limit: number) {
  const rows = await tx.execute<{ id: string }>(sql`
    update app.jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from app.jobs
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and locked_at < now() - interval '15 minutes')
      order by run_after limit ${limit} for update skip locked
    ) returning id`);
  if (!rows.length) return [];
  return tx.select().from(jobs).where(sql`${jobs.id} in ${rows.map((r) => r.id)}`);
}

export async function completeJobInternal(tx: Tx, jobId: string) {
  await tx.update(jobs).set({ status: "done", lockedAt: null, dedupeKey: null }).where(eq(jobs.id, jobId));
}

export async function failJobInternal(tx: Tx, job: typeof jobs.$inferSelect, error: string) {
  const final = job.attempts >= job.maxAttempts;
  await tx.update(jobs).set({
    status: final ? "failed" : "queued", lockedAt: null, lastError: error.slice(0, 1000),
    runAfter: new Date(Date.now() + backoffDelayMs(job.attempts)), dedupeKey: final ? null : job.dedupeKey,
  }).where(eq(jobs.id, job.id));
}

// ---------- audit + events reads ----------

export const listAudit = defineService({
  name: "core.listAudit",
  input: z.object({ entityType: z.string().optional(), entityId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(50) }),
  permission: "audit.read",
  handler: (ctx, input, tx) =>
    tx.select().from(auditLogs)
      .where(and(eq(auditLogs.orgId, ctx.orgId), input.entityType ? eq(auditLogs.entityType, input.entityType) : undefined, input.entityId ? eq(auditLogs.entityId, input.entityId) : undefined))
      .orderBy(desc(auditLogs.createdAt)).limit(input.limit),
});

export async function countEventsSinceInternal(tx: Tx, orgId: string, type: string, since: Date) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(events).where(and(eq(events.orgId, orgId), eq(events.type, type), gte(events.createdAt, since)));
  return r?.n ?? 0;
}

export async function listOrgIdsInternal(tx: Tx) {
  return (await tx.select({ id: organizations.id }).from(organizations).where(isNull(organizations.deletedAt))).map((r) => r.id);
}
