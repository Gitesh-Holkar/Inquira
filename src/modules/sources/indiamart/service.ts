/**
 * IndiaMART Lead Manager APIs (GOAL G-SRC-1, G-SRC-2, G-SRC-8).
 *
 * Push: IndiaMART POSTs each new lead to our HTTPS address the moment it arrives. The address ends with a
 * random secret (IndiaMART offers no other way to authenticate a push); only its SHA-256 hash is stored, in
 * the integration's config. The endpoint answers 200 once the lead is stored, so IndiaMART retries otherwise.
 *
 * Pull: a safety net and history. At most one call per 5 minutes (IndiaMART's rule), 7 days per call, a
 * 5-minute overlap with the previous call (as IndiaMART advises); the first run loads the last 30 days one
 * week at a time, one call per run. Leads are de-duplicated by UNIQUE_QUERY_ID, and merged with the same
 * enquiry's notification email (same buyer and product within 48 hours).
 *
 * Buy Leads arrive here only after a person bought them on IndiaMART; nothing here selects or buys (ADR-020).
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { withSystemTx } from "@/db/client";
import { AppError, publicMessage } from "@/lib/errors";
import { appUrl } from "@/lib/env";
import { audit, emit } from "@/modules/core/audit";
import { defineExternalService, defineService } from "@/modules/core/service-kit";
import type { Ctx } from "@/modules/core/types";
import {
  enqueueJobInternal, finishSyncRunInternal, getIntegrationInternal, integrationByPushSecretHashInternal, readSecretsInternal,
  recordIntegrationFailure, recordIntegrationSuccess, startSyncRunInternal, updateIntegrationInternal, writeSecretsInternal,
} from "@/modules/core/service";
import { upsertLeadInternal } from "@/modules/leads/service";
import { emptyStats, type SyncStats } from "../types";
import { IndiaMartAuthError, IndiaMartClient, IndiaMartRateLimited, MAX_WINDOW_MS, MIN_CALL_INTERVAL_MS, type IndiaMartLead } from "./client";
import { normalizeIndiaMart } from "./normalize";

export const BACKFILL_DAYS = 30;
const OVERLAP_MS = 5 * 60_000;
const MAX_WINDOW_ATTEMPTS = 3;

/** `lastSuccessTo`: read up to here. `windowStart`: the first load is not finished; continue here. `lastCallAt`: IndiaMART's 5-minute rule. */
export type IndiaMartCursor = { lastSuccessTo?: string; windowStart?: string; attempts?: number; lastCallAt?: string };

const hashSecret = (s: string) => createHash("sha256").update(s).digest("hex");
export const pushUrlFor = (secret: string) => `${appUrl()}/api/webhooks/indiamart/${secret}`;

export const saveIndiaMartKey = defineService({
  name: "indiamart.saveKey",
  input: z.object({ key: z.string().trim().min(10).max(300) }),
  permission: "integrations.manage",
  runAs: "system", // writes integration_secrets
  handler: async (ctx, input, tx) => {
    const integ = await getIntegrationInternal(tx, ctx.orgId, "indiamart");
    await writeSecretsInternal(tx, ctx, integ, { key: input.key });
    await updateIntegrationInternal(tx, ctx, integ.id, { status: "configured", lastError: null, consecutiveFailures: 0, backoffUntil: null }, "integration.configure");
    return { ok: true };
  },
});

/**
 * A new push address (the old one stops working). The secret is shown once, here, for pasting into
 * IndiaMART's Lead Manager → Push API; only its hash is kept.
 */
export const createIndiaMartPushAddress = defineService({
  name: "indiamart.createPushAddress",
  input: z.object({}).default({}),
  permission: "integrations.manage",
  handler: async (ctx, _i, tx) => {
    if (!appUrl().startsWith("https://")) throw new AppError("VALIDATION", "IndiaMART only sends to an https:// address on the internet. Set APP_URL to your public https address first.");
    const integ = await getIntegrationInternal(tx, ctx.orgId, "indiamart");
    const secret = randomBytes(24).toString("base64url");
    await updateIntegrationInternal(tx, ctx, integ.id, { config: { ...integ.config, pushSecretHash: hashSecret(secret), pushAddressCreatedAt: new Date().toISOString() } });
    await audit(tx, ctx, { action: "indiamart.push_address", entityType: "integration", entityId: integ.id, changes: { rotated: !!integ.config.pushSecretHash } });
    return { url: pushUrlFor(secret) };
  },
});

/**
 * Stores one pushed lead. Returns null when the secret is unknown (the route answers 404). Throws when the
 * lead cannot be stored, so the route answers with an error and IndiaMART sends it again later.
 */
export async function receiveIndiaMartPush(secret: string, body: unknown): Promise<{ leadId: string; created: boolean } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return null;
  const integ = await withSystemTx((tx) => integrationByPushSecretHashInternal(tx, hashSecret(secret)));
  if (!integ || !integ.enabled) return null;
  const ctx: Ctx = { orgId: integ.orgId, actor: { kind: "system", job: "indiamart-push" } };
  const b = body as { RESPONSE?: unknown; body?: { RESPONSE?: unknown } } | null;
  const raw = (b?.RESPONSE ?? b?.body?.RESPONSE) as IndiaMartLead | undefined;
  const lead = raw && typeof raw === "object" && !Array.isArray(raw) ? normalizeIndiaMart(raw) : null;
  if (!lead) {
    await withSystemTx(async (tx) => {
      const run = await startSyncRunInternal(tx, ctx, "indiamart", "push");
      await finishSyncRunInternal(tx, run.id, { status: "error", fetched: 1, created: 0, duplicates: 0, errors: 1, errorMessage: "Push without a readable lead (no UNIQUE_QUERY_ID)" });
    });
    throw new AppError("VALIDATION", "No lead in the request");
  }
  return withSystemTx(async (tx) => {
    const r = await upsertLeadInternal(tx, ctx, lead);
    const run = await startSyncRunInternal(tx, ctx, "indiamart", "push");
    await finishSyncRunInternal(tx, run.id, { status: "ok", fetched: 1, created: r.created ? 1 : 0, duplicates: r.created ? 0 : 1, errors: 0, errorMessage: null, meta: { type: lead.channel } });
    await updateIntegrationInternal(tx, ctx, integ.id, { config: { ...integ.config, lastPushAt: new Date().toISOString() } });
    return { leadId: r.leadId, created: r.created };
  });
}

async function keyFor(ctx: Ctx) {
  return withSystemTx(async (tx) => {
    const integ = await getIntegrationInternal(tx, ctx.orgId, "indiamart");
    const s = await readSecretsInternal<{ key?: string }>(tx, integ.id);
    return { integ, key: s?.key ?? null };
  });
}

/** "Test connection": reads the last hour. Counts as IndiaMART's one call per 5 minutes. */
export const testIndiaMartConnection = defineExternalService({
  name: "indiamart.test",
  input: z.object({}).default({}),
  permission: "integrations.manage",
  handler: (ctx) => testIndiaMartInternal(ctx),
});

export async function testIndiaMartInternal(ctx: Ctx, f: typeof fetch = fetch, now = new Date()) {
  const { integ, key } = await keyFor(ctx);
  if (!key) throw new AppError("VALIDATION", "Paste your IndiaMART Pull API key first.");
  const cursor = (integ.cursor ?? {}) as IndiaMartCursor;
  if (cursor.lastCallAt && now.getTime() - new Date(cursor.lastCallAt).getTime() < MIN_CALL_INTERVAL_MS) {
    throw new AppError("RATE_LIMITED", "IndiaMART allows one call every 5 minutes. Try again in a few minutes.");
  }
  await withSystemTx((tx) => updateIntegrationInternal(tx, ctx, integ.id, { cursor: { ...cursor, lastCallAt: now.toISOString() } }));
  try {
    const rows = await new IndiaMartClient(key, f).list(new Date(now.getTime() - 3600_000), now);
    const first = integ.status !== "connected";
    await withSystemTx(async (tx) => {
      await updateIntegrationInternal(tx, ctx, integ.id, { status: "connected", lastError: null, consecutiveFailures: 0, backoffUntil: null }, "integration.test_ok");
      if (first) {
        await emit(tx, ctx, { type: "integration.connected", entityType: "integration", entityId: integ.id, payload: { provider: "indiamart" } });
        await enqueueJobInternal(tx, ctx, { type: "indiamart.sync", dedupeKey: "indiamart.sync", runAfter: new Date(now.getTime() + MIN_CALL_INTERVAL_MS) });
      }
    });
    return { ok: true, sample: rows.length };
  } catch (e) {
    await withSystemTx((tx) => recordIntegrationFailure(tx, ctx, integ, publicMessage(e).message, { reauth: e instanceof IndiaMartAuthError }));
    throw e;
  }
}

/**
 * One Pull API call per run (IndiaMART's limit), resumable: the position is saved before and after the call.
 * A window in which a lead failed to save is read again on the next runs and skipped after three tries.
 */
export async function syncIndiaMart(ctx: Ctx, opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<SyncStats & { skipped?: string }> {
  const now = opts.now ?? new Date();
  const { integ, key } = await keyFor(ctx);
  if (!key || !integ.enabled) return { ...emptyStats(), skipped: "not configured" };
  if (integ.status === "reauth_required") return { ...emptyStats(), skipped: "key rejected; paste a new key in Settings" };
  if (integ.backoffUntil && integ.backoffUntil > now) return { ...emptyStats(), skipped: `backing off until ${integ.backoffUntil.toISOString()}` };
  const cursor = (integ.cursor ?? {}) as IndiaMartCursor;
  if (cursor.lastCallAt && now.getTime() - new Date(cursor.lastCallAt).getTime() < MIN_CALL_INTERVAL_MS) return { ...emptyStats(), skipped: "IndiaMART allows one call every 5 minutes" };

  const from = cursor.windowStart ? new Date(cursor.windowStart)
    : cursor.lastSuccessTo ? new Date(new Date(cursor.lastSuccessTo).getTime() - OVERLAP_MS)
    : new Date(now.getTime() - BACKFILL_DAYS * 86400_000);
  const to = new Date(Math.min(now.getTime(), from.getTime() + MAX_WINDOW_MS));
  const kind = cursor.windowStart || !cursor.lastSuccessTo ? "backfill" : "incremental";
  const stats = emptyStats();
  await withSystemTx((tx) => updateIntegrationInternal(tx, ctx, integ.id, { cursor: { ...cursor, lastCallAt: now.toISOString() } }));
  const run = await withSystemTx((tx) => startSyncRunInternal(tx, ctx, "indiamart", kind));
  try {
    const rows = await new IndiaMartClient(key, opts.fetchImpl ?? fetch).list(from, to);
    stats.fetched = rows.length;
    for (const raw of rows) {
      const lead = normalizeIndiaMart(raw);
      if (!lead) {
        stats.errors++;
        stats.errorMessages.push("Lead without UNIQUE_QUERY_ID skipped");
        continue;
      }
      try {
        const r = await withSystemTx((tx) => upsertLeadInternal(tx, ctx, lead));
        if (r.created) stats.created++;
        else stats.duplicates++;
      } catch (e) {
        stats.errors++;
        stats.errorMessages.push(`${lead.sourceRef}: ${publicMessage(e).message}`);
      }
    }
    const saveFailed = stats.errorMessages.some((m) => !m.startsWith("Lead without"));
    const attempts = (cursor.attempts ?? 0) + 1;
    const retry = saveFailed && attempts < MAX_WINDOW_ATTEMPTS;
    if (saveFailed && !retry) stats.errorMessages.push(`Window from ${from.toISOString()} skipped after ${attempts} attempts`);
    const done = to.getTime() >= now.getTime();
    const next: IndiaMartCursor = retry
      ? { ...cursor, windowStart: from.toISOString(), attempts, lastCallAt: now.toISOString() }
      : done
        ? { lastSuccessTo: to.toISOString(), lastCallAt: now.toISOString() }
        : { lastSuccessTo: cursor.lastSuccessTo, windowStart: to.toISOString(), lastCallAt: now.toISOString() };
    await withSystemTx(async (tx) => {
      await finishSyncRunInternal(tx, run.id, {
        status: stats.errors || retry ? "partial" : "ok", fetched: stats.fetched, created: stats.created, duplicates: stats.duplicates, errors: stats.errors,
        errorMessage: stats.errorMessages.slice(0, 5).join("; ") || null, meta: { from: from.toISOString(), to: to.toISOString(), more: !done || retry },
      });
      await recordIntegrationSuccess(tx, ctx, integ, { status: "connected", cursor: next, lastError: stats.errors ? stats.errorMessages[0] ?? null : null });
      await emit(tx, ctx, { type: "sync.completed", entityType: "integration", entityId: integ.id, payload: { provider: "indiamart", ...stats, errorMessages: undefined } });
    });
    return stats;
  } catch (e) {
    const msg = publicMessage(e).message;
    await withSystemTx(async (tx) => {
      await finishSyncRunInternal(tx, run.id, { status: "error", fetched: stats.fetched, created: stats.created, duplicates: stats.duplicates, errors: stats.errors + 1, errorMessage: msg });
      // A rate-limit answer is not a broken connection: wait for the next run without marking an error streak.
      if (e instanceof IndiaMartRateLimited) await updateIntegrationInternal(tx, ctx, integ.id, { lastError: msg, lastErrorAt: new Date(), backoffUntil: new Date(now.getTime() + 15 * 60_000) });
      else await recordIntegrationFailure(tx, ctx, integ, msg, { reauth: e instanceof IndiaMartAuthError });
    });
    return { ...stats, errors: stats.errors + 1, errorMessages: [...stats.errorMessages, msg] };
  }
}
