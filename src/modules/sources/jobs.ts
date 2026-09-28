import { withSystemTx } from "@/db/client";
import { publicMessage } from "@/lib/errors";
import { claimJobsInternal, completeJobInternal, enqueueJobInternal, failJobInternal, listOrgIdsInternal } from "@/modules/core/service";
import type { Ctx } from "@/modules/core/types";
import { syncGmail } from "./gmail/service";
import { syncTradeIndia } from "./tradeindia/service";

type Handler = (ctx: Ctx, payload: Record<string, unknown>) => Promise<unknown>;

/** Job type → handler. Register new background work here (see docs/ARCHITECTURE.md). */
export const JOB_HANDLERS: Record<string, Handler> = {
  "gmail.sync": (ctx) => syncGmail(ctx),
  "tradeindia.sync": (ctx) => syncTradeIndia(ctx),
};

/** Called by /api/cron/tick every 10 minutes: schedule syncs for every org, then drain due jobs. */
export async function tick(opts: { maxJobs?: number; schedule?: boolean } = {}) {
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
  const jobs = await withSystemTx((tx) => claimJobsInternal(tx, opts.maxJobs ?? 10));
  for (const job of jobs) {
    const handler = JOB_HANDLERS[job.type];
    const ctx: Ctx = { orgId: job.orgId, actor: { kind: "system", job: job.type } };
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      const result = await handler(ctx, job.payload);
      await withSystemTx((tx) => completeJobInternal(tx, job.id));
      results.push({ id: job.id, type: job.type, ok: true, result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : publicMessage(e).message;
      await withSystemTx((tx) => failJobInternal(tx, job, msg));
      results.push({ id: job.id, type: job.type, ok: false, error: msg.slice(0, 300) });
    }
  }
  return { scheduled: scheduled.length, processed: results.length, results };
}
