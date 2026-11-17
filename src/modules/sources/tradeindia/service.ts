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
import { inquiryWindows, TradeIndiaAuthError, TradeIndiaClient, TradeIndiaRateLimited, tradeIndiaDay, type TradeIndiaCredentials } from "./client";
import { normalizeTradeIndia } from "./normalize";

const BACKFILL_DAYS = 30;
const OVERLAP_MS = 2 * 86400_000; // re-read the last 2 days each run; upserts are idempotent
/** Stop starting new page fetches after this long, so a run always ends inside the 60 s function limit. */
const TIME_BUDGET_MS = 35_000;
const PAGE_DELAY_MS = 1500;
/** A window whose leads keep failing is retried this many runs, then skipped with the error recorded. */
const MAX_WINDOW_ATTEMPTS = 3;

/**
 * Where the sync is. `lastSuccessTo`: everything up to this instant was read by a completed range.
 * `resume`: a range that is not finished yet; the next run continues at `windowStart`, `page`.
 */
export type TradeIndiaCursor = {
  lastSuccessTo?: string;
  resume?: { to: string; windowStart: string; page: number; attempts: number };
};

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
 * Idempotent, resumable sync (GOAL G-SRC-3). The first range is the last 30 days; later ranges start two
 * days before the last completed range. A range is read in 7-day windows:
 *  - after each window the position is saved, so a run killed by the host resumes there;
 *  - past the time budget the run stops and the next tick continues (`more: true`);
 *  - a window in which a lead failed to save is not passed: it is retried on the next runs, and only
 *    after MAX_WINDOW_ATTEMPTS is it skipped, with the error kept in the sync run.
 * Leads are de-duplicated by rfi_id (unique source_ref), so re-reading is harmless.
 */
export async function syncTradeIndia(
  ctx: Ctx,
  opts: { fetchImpl?: typeof fetch; delayMs?: number; now?: Date; timeBudgetMs?: number; clock?: () => number } = {},
): Promise<SyncStats & { skipped?: string; more?: boolean }> {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  const deadline = clock() + (opts.timeBudgetMs ?? TIME_BUDGET_MS);
  const delay = opts.delayMs ?? PAGE_DELAY_MS;
  const pause = () => (delay ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve());
  const { integ, creds } = await credsFor(ctx);
  if (!creds || !integ.enabled) return { ...emptyStats(), skipped: "not configured" };
  if (integ.backoffUntil && integ.backoffUntil > now) return { ...emptyStats(), skipped: `backing off until ${integ.backoffUntil.toISOString()}` };
  if (integ.status === "reauth_required") return { ...emptyStats(), skipped: "credentials rejected; fix in Settings" };

  const cursor = (integ.cursor ?? {}) as TradeIndiaCursor;
  const resume = cursor.resume;
  const to = resume ? new Date(resume.to) : now;
  const from = resume
    ? new Date(resume.windowStart)
    : cursor.lastSuccessTo ? new Date(new Date(cursor.lastSuccessTo).getTime() - OVERLAP_MS) : new Date(now.getTime() - BACKFILL_DAYS * 86400_000);
  const kind = resume ? "resume" : cursor.lastSuccessTo ? "incremental" : "backfill";
  const run = await withSystemTx((tx) => startSyncRunInternal(tx, ctx, "tradeindia", kind));
  const stats = emptyStats();
  const client = new TradeIndiaClient(creds, opts.fetchImpl ?? fetch);
  const savePosition = (next: TradeIndiaCursor) => withSystemTx((tx) => updateIntegrationInternal(tx, ctx, integ.id, { cursor: next }));
  const windows = inquiryWindows(from, to);
  let stop: TradeIndiaCursor["resume"] | null = null;
  let stopReason: "time budget" | "lead errors" | null = null;

  try {
    for (const [n, w] of windows.entries()) {
      const firstPage = n === 0 && resume ? resume.page : 1;
      let windowErrors = 0;
      for (let page = firstPage; ; page++) {
        if (clock() > deadline) {
          // Out of time. A window with failed leads is read again from its first page.
          stop = { to: to.toISOString(), windowStart: w.start.toISOString(), page: windowErrors ? 1 : page, attempts: n === 0 && resume ? resume.attempts : 0 };
          stopReason = "time budget";
          break;
        }
        const rows = await client.page(w.start, w.end, page);
        stats.fetched += rows.length;
        for (const raw of rows) {
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
            windowErrors++;
            stats.errors++;
            stats.errorMessages.push(`${lead.sourceRef}: ${publicMessage(e).message}`);
          }
        }
        if (rows.length < client.pageSize) break;
        await pause();
      }
      if (stop) break;
      if (windowErrors) {
        const attempts = (n === 0 && resume ? resume.attempts : 0) + 1;
        if (attempts < MAX_WINDOW_ATTEMPTS) {
          stop = { to: to.toISOString(), windowStart: w.start.toISOString(), page: 1, attempts };
          stopReason = "lead errors";
          break;
        }
        stats.errorMessages.push(`Window ${tradeIndiaDay(w.start)} to ${tradeIndiaDay(w.end)} skipped after ${attempts} attempts`);
      }
      const next = windows[n + 1];
      if (next) {
        await savePosition({ ...cursor, resume: { to: to.toISOString(), windowStart: next.start.toISOString(), page: 1, attempts: 0 } });
        await pause();
      }
    }

    const nextCursor: TradeIndiaCursor = stop ? { lastSuccessTo: cursor.lastSuccessTo, resume: stop } : { lastSuccessTo: to.toISOString() };
    await withSystemTx(async (tx) => {
      await finishSyncRunInternal(tx, run.id, {
        status: stats.errors || stop ? "partial" : "ok", fetched: stats.fetched, created: stats.created, duplicates: stats.duplicates, errors: stats.errors,
        errorMessage: stats.errorMessages.slice(0, 5).join("; ") || null,
        meta: { from: from.toISOString(), to: to.toISOString(), ...(stop ? { stopped: stopReason, resumeFrom: stop.windowStart, page: stop.page } : {}) },
      });
      await recordIntegrationSuccess(tx, ctx, integ, { status: "connected", cursor: nextCursor, lastError: stats.errors ? stats.errorMessages[0] ?? null : null });
      await emit(tx, ctx, { type: "sync.completed", entityType: "integration", entityId: integ.id, payload: { provider: "tradeindia", ...stats, errorMessages: undefined, more: !!stop } });
    });
    return stop ? { ...stats, more: true } : stats;
  } catch (e) {
    // The position saved after the last finished window stays; the next run resumes there.
    const msg = e instanceof TradeIndiaRateLimited ? e.message : publicMessage(e).message === "Something went wrong. Please try again." ? String((e as Error).message).slice(0, 300) : publicMessage(e).message;
    await withSystemTx(async (tx) => {
      await finishSyncRunInternal(tx, run.id, { status: "error", fetched: stats.fetched, created: stats.created, duplicates: stats.duplicates, errors: stats.errors + 1, errorMessage: msg });
      await recordIntegrationFailure(tx, ctx, integ, msg, { reauth: e instanceof TradeIndiaAuthError });
    });
    return { ...stats, errors: stats.errors + 1, errorMessages: [...stats.errorMessages, msg] };
  }
}
