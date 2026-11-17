import { withSystemTx } from "@/db/client";
import { publicMessage } from "@/lib/errors";
import { claimJobsInternal, completeJobInternal, enqueueJobInternal, failJobInternal, listOrgIdsInternal } from "@/modules/core/service";
import type { Ctx } from "@/modules/core/types";
import { syncGmail } from "./gmail/service";
import { syncTradeIndia } from "./tradeindia/service";

/** A handler may return `{ more: true }` when it stopped early (time budget, backlog); a follow-up is then queued. */
type Handler = (ctx: Ctx, payload: Record<string, unknown>) => Promise<unknown>;

/** Follow-ups wait a minute, so they run on the next tick and never twice in the same one. */
const FOLLOW_UP_DELAY_MS = 60_000;

/** Job type → handler. Register new background work here (see docs/ARCHITECTURE.md). */
export const JOB_HANDLERS: Record<string, Handler> = {
  "gmail.sync": (ctx) => syncGmail(ctx),
  "tradeindia.sync": (ctx) => syncTradeIndia(ctx),
};

/** Don't start another job after this long; the route's maxDuration is 60 s and one Gmail run may take ~35 s. */
const START_BUDGET_MS = 20_000;

/** Called by /api/cron/tick every 10 minutes: schedule syncs for every org, then drain due jobs. */
export async function tick(opts: { maxJobs?: number; schedule?: boolean; startBudgetMs?: number } = {}) {
  const startedAt = Date.now();
  const scheduled: string[] = [];
  if (opts.schedule !== false) {
    const orgIds = await withSystemTx((tx) => listOrgIdsInternal(tx));
    for (const orgId of orgIds) {
      const ctx: Ctx = { orgId, actor: { kind: "system", job: "cron" } };
      await withSystemTx(async (tx) => {
        for (const type of ["gmail.sync", "tradeindia.sync"]) {
          const j = await enqueueJobInternal(tx, ctx, { type, dedupeKey: type });
          if (j) scheduled.push(`${orgId}:${type}`);
        }
      });
    }
  }
  const results: { id: string; type: string; ok: boolean; result?: unknown; error?: string }[] = [];
  const budget = opts.startBudgetMs ?? START_BUDGET_MS;
  // Claim one job at a time, so jobs not reached in this run stay queued (not locked) for the next tick.
  for (let n = 0; n < (opts.maxJobs ?? 10) && Date.now() - startedAt < budget; n++) {
    const [job] = await withSystemTx((tx) => claimJobsInternal(tx, 1));
    if (!job) break;
    const handler = JOB_HANDLERS[job.type];
    const ctx: Ctx = { orgId: job.orgId, actor: { kind: "system", job: job.type } };
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      const result = await handler(ctx, job.payload);
      await withSystemTx(async (tx) => {
        await completeJobInternal(tx, job.id);
        // Queue the follow-up only now: while the job was running it still held its de-duplication key,
        // so an enqueue from inside the handler would have been dropped.
        if ((result as { more?: boolean } | null)?.more) {
          await enqueueJobInternal(tx, ctx, { type: job.type, payload: job.payload, dedupeKey: job.type, runAfter: new Date(Date.now() + FOLLOW_UP_DELAY_MS) });
        }
      });
      results.push({ id: job.id, type: job.type, ok: true, result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : publicMessage(e).message;
      await withSystemTx((tx) => failJobInternal(tx, job, msg));
      results.push({ id: job.id, type: job.type, ok: false, error: msg.slice(0, 300) });
    }
  }
  return { scheduled: scheduled.length, processed: results.length, results };
}
