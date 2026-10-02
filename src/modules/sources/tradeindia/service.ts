import { z } from "zod";
import { withSystemTx } from "@/db/client";
import { AppError, publicMessage } from "@/lib/errors";
import { emit } from "@/modules/core/audit";
import { defineExternalService, defineService } from "@/modules/core/service-kit";
import type { Ctx } from "@/modules/core/types";
import {
  enqueueJobInternal, finishSyncRunInternal, getIntegrationInternal, readSecretsInternal, recordIntegrationFailure,
  recordIntegrationSuccess, startSyncRunInternal, updateIntegrationInternal, writeSecretsInternal,
} from "@/modules/core/service";
import { upsertLeadInternal } from "@/modules/leads/service";
import { emptyStats, type SyncStats } from "../types";
import { TradeIndiaAuthError, TradeIndiaClient, TradeIndiaRateLimited, type TradeIndiaCredentials } from "./client";
import { normalizeTradeIndia } from "./normalize";

const BACKFILL_DAYS = 30;
const OVERLAP_MS = 2 * 86400_000; // re-read the last 2 days each run; upserts are idempotent

export const saveTradeIndiaCredentials = defineService({
  name: "tradeindia.saveCredentials",
  input: z.object({ userId: z.string().trim().min(1).max(40), profileId: z.string().trim().min(1).max(40), key: z.string().trim().min(8).max(200) }),
  permission: "integrations.manage",
  runAs: "system", // writes integration_secrets
  handler: async (ctx, input, tx) => {
    const integ = await getIntegrationInternal(tx, ctx.orgId, "tradeindia");
    await writeSecretsInternal(tx, ctx, integ, { userId: input.userId, profileId: input.profileId, key: input.key });
    await updateIntegrationInternal(tx, ctx, integ.id, {
      status: "configured", config: { ...integ.config, userId: input.userId, profileId: input.profileId }, lastError: null, consecutiveFailures: 0, backoffUntil: null,
    }, "integration.configure");
    return { ok: true };
  },
});

async function credsFor(ctx: Ctx) {
  return withSystemTx(async (tx) => {
    const integ = await getIntegrationInternal(tx, ctx.orgId, "tradeindia");
    const s = await readSecretsInternal<TradeIndiaCredentials>(tx, integ.id);
    return { integ, creds: s && s.userId && s.profileId && s.key ? s : null };
  });
}

/** "Test connection": fetch yesterday→today, page 1 only. Marks the integration connected on success. */
export const testTradeIndiaConnection = defineExternalService({
  name: "tradeindia.test",
  input: z.object({}).default({}),
  permission: "integrations.manage",
  handler: (ctx) => testConnectionInternal(ctx),
});

export async function testConnectionInternal(ctx: Ctx, f: typeof fetch = fetch) {
  const { integ, creds } = await credsFor(ctx);
  if (!creds) throw new AppError("VALIDATION", "Enter your TradeIndia User ID, Profile ID and Key first.");
  const client = new TradeIndiaClient(creds, f);
  try {
    const rows = await client.page(new Date(Date.now() - 86400_000), new Date(), 1);
    const firstConnect = integ.status !== "connected";
    await withSystemTx(async (tx) => {
      await updateIntegrationInternal(tx, ctx, integ.id, { status: "connected", lastError: null, consecutiveFailures: 0, backoffUntil: null }, "integration.test_ok");
      if (firstConnect) {
        await emit(tx, ctx, { type: "integration.connected", entityType: "integration", entityId: integ.id, payload: { provider: "tradeindia" } });
        await enqueueJobInternal(tx, ctx, { type: "tradeindia.sync", payload: { backfill: true }, dedupeKey: "tradeindia.sync" });
      }
    });
    return { ok: true, sample: rows.length };
  } catch (e) {
    await withSystemTx((tx) => recordIntegrationFailure(tx, ctx, integ, publicMessage(e).message, { reauth: e instanceof TradeIndiaAuthError }));
    throw e;
  }
}

/**
 * Incremental + idempotent sync. First run backfills 30 days; later runs read from
 * (last success - 2 days) to now. Dedupe is by rfi_id (unique source_ref).
 */
export async function syncTradeIndia(ctx: Ctx, opts: { fetchImpl?: typeof fetch; delayMs?: number; now?: Date } = {}): Promise<SyncStats & { skipped?: string }> {
  const now = opts.now ?? new Date();
  const { integ, creds } = await credsFor(ctx);
  if (!creds || !integ.enabled) return { ...emptyStats(), skipped: "not configured" };
  if (integ.backoffUntil && integ.backoffUntil > now) return { ...emptyStats(), skipped: `backing off until ${integ.backoffUntil.toISOString()}` };
  if (integ.status === "reauth_required") return { ...emptyStats(), skipped: "credentials rejected; fix in Settings" };

  const lastOk = (integ.cursor as { lastSuccessTo?: string }).lastSuccessTo;
  const kind = lastOk ? "incremental" : "backfill";
  const from = lastOk ? new Date(new Date(lastOk).getTime() - OVERLAP_MS) : new Date(now.getTime() - BACKFILL_DAYS * 86400_000);
  const run = await withSystemTx((tx) => startSyncRunInternal(tx, ctx, "tradeindia", kind));
  const stats = emptyStats();
  const client = new TradeIndiaClient(creds, opts.fetchImpl ?? fetch);
  try {
    for await (const page of client.inquiries(from, now, { delayMs: opts.delayMs })) {
      stats.fetched += page.length;
      for (const raw of page) {
        const lead = normalizeTradeIndia(raw);
        if (!lead) {
          stats.errors++;
          stats.errorMessages.push("Inquiry without id skipped");
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
    }
    await withSystemTx(async (tx) => {
      await finishSyncRunInternal(tx, run.id, { status: stats.errors ? "partial" : "ok", fetched: stats.fetched, created: stats.created, duplicates: stats.duplicates, errors: stats.errors, errorMessage: stats.errorMessages.slice(0, 5).join("; ") || null, meta: { from: from.toISOString(), to: now.toISOString() } });
      await recordIntegrationSuccess(tx, ctx, integ, { status: "connected", cursor: { ...integ.cursor, lastSuccessTo: now.toISOString() }, lastError: stats.errors ? stats.errorMessages[0] ?? null : null });
      await emit(tx, ctx, { type: "sync.completed", entityType: "integration", entityId: integ.id, payload: { provider: "tradeindia", ...stats, errorMessages: undefined } });
    });
    return stats;
  } catch (e) {
    const msg = e instanceof TradeIndiaRateLimited ? e.message : publicMessage(e).message === "Something went wrong. Please try again." ? String((e as Error).message).slice(0, 300) : publicMessage(e).message;
    await withSystemTx(async (tx) => {
      await finishSyncRunInternal(tx, run.id, { status: "error", fetched: stats.fetched, created: stats.created, duplicates: stats.duplicates, errors: stats.errors + 1, errorMessage: msg });
      await recordIntegrationFailure(tx, ctx, integ, msg, { reauth: e instanceof TradeIndiaAuthError });
    });
    return { ...stats, errors: stats.errors + 1, errorMessages: [...stats.errorMessages, msg] };
  }
}
