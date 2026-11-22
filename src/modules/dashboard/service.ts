import { z } from "zod";
import { withSystemTx, type Tx } from "@/db/client";
import { formatDate, startOfTodayIST, todayIST } from "@/lib/format";
import type { Ctx } from "@/modules/core/types";
import { defineService } from "@/modules/core/service-kit";
import { findIntegrationInternal, getIntegrationInternal, getOrgSettingsInternal, ownerEmailsInternal } from "@/modules/core/service";
import { arrivalRoutesInternal, countBoughtBuyLeadsSinceInternal, countLeadsNeedingDetailsInternal, leadFunnelInternal, leadStatsInternal, receivedAtByIdsInternal } from "@/modules/leads/service";
import { dailySummaryDoneInternal, outboundSettingsInternal, outboundStatsInternal, sendDailySummaryInternal } from "@/modules/outbound/service";
import type { SendDeps } from "@/modules/outbound/send";
import { aiAccuracyInternal } from "@/modules/ai/service";
import { ignoredSinceInternal, reconciliationInternal } from "@/modules/email/service";
import { getRulesInternal, todayDecisionCountsInternal } from "@/modules/buyleads/service";

/** Everything the dashboard shows, in one round trip (brief §7.7). */
export const getDashboard = defineService({
  name: "dashboard.get",
  input: z.object({}).default({}),
  permission: "dashboard.read",
  handler: async (ctx, _i, tx) => {
    const today = startOfTodayIST();
    const stats = await leadStatsInternal(tx, ctx.orgId, today);
    const rec = await reconciliationInternal(tx, ctx.orgId, today);
    const gmail = await getIntegrationInternal(tx, ctx.orgId, "gmail");
    const ti = await getIntegrationInternal(tx, ctx.orgId, "tradeindia");
    const rules = await getRulesInternal(tx, ctx);
    const dc = await todayDecisionCountsInternal(tx, ctx.orgId);
    const im = await findIntegrationInternal(tx, ctx.orgId, "indiamart");
    const arrived = await countBoughtBuyLeadsSinceInternal(tx, ctx.orgId, today);
    const routes = await arrivalRoutesInternal(tx, ctx.orgId, today);
    const apiOn = { indiamart: im?.status === "connected" || !!im?.config.lastPushAt, tradeindia: ti.status === "connected" };
    const health = (i: typeof gmail) => ({ provider: i.provider, status: i.status, lastSyncAt: i.lastSyncAt, lastSuccessAt: i.lastSuccessAt, lastError: i.lastError, lastErrorAt: i.lastErrorAt, account: i.accountEmail });
    return {
      newToday: Object.fromEntries(stats.bySource.map((s) => [s.source, s.n])) as Record<string, number>,
      newTodayTotal: stats.bySource.reduce((a, b) => a + b.n, 0),
      needingAction: stats.needingAction,
      international: stats.international,
      reconciliation: rec,
      integrations: [health(gmail), health(ti), ...(im ? [health(im)] : [])],
      indiamart: { ...dc, arrivedByEmail: arrived, dailyCap: rules.dailyCap },
      routes: routes.map((r) => ({ ...r, apiConnected: apiOn[r.portal] })),
      // G-AI-9: how often a person had to correct what each AI tier filled, last 30 days.
      ai: await aiAccuracyInternal(tx, ctx.orgId, 30),
      needsDetails: await countLeadsNeedingDetailsInternal(tx, ctx.orgId),
      // G-RPT-1: the last 7 days.
      week: await reportInternal(tx, ctx.orgId, new Date(today.getTime() - 6 * 86400_000)),
    };
  },
});

/**
 * The numbers of GOAL G-RPT-1 since a time: leads received and matched, replies sent automatically and by
 * people, messages held and ready now, emails set aside, and the median time from arrival to the first reply
 * sent through Inquira (Gmail drafts sent by hand are not seen, so they do not count).
 */
export async function reportInternal(tx: Tx, orgId: string, since: Date) {
  const funnel = await leadFunnelInternal(tx, orgId, since);
  const out = await outboundStatsInternal(tx, orgId, since);
  const arrived = await receivedAtByIdsInternal(tx, orgId, out.firstSent.map((f) => f.leadId));
  const minutes = out.firstSent.map((f) => (arrived.get(f.leadId) ? (f.at.getTime() - arrived.get(f.leadId)!.getTime()) / 60_000 : null))
    .filter((m): m is number => m !== null && m >= 0).sort((a, b) => a - b);
  const median = minutes.length ? (minutes.length % 2 ? minutes[(minutes.length - 1) / 2]! : (minutes[minutes.length / 2 - 1]! + minutes[minutes.length / 2]!) / 2) : null;
  return {
    received: funnel.received, matched: funnel.matched, autoSent: out.autoSent, sentByPeople: out.sentByPeople, heldNow: out.heldNow, readyNow: out.readyNow,
    ignored: await ignoredSinceInternal(tx, orgId, since), firstReplyMedianMinutes: median === null ? null : Math.round(median), firstReplies: minutes.length,
  };
}

export function formatMinutes(m: number | null): string {
  if (m === null) return "—";
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 6) / 10} h`;
  return `${Math.round(m / 144) / 10} days`;
}

/**
 * Job `report.daily` (GOAL G-RPT-2): after 19:30 IST, once a day, when the owner turned it on in Settings →
 * Sending, emails today's numbers from the company's Gmail to the owners (or the addresses given).
 */
export async function runDailySummary(ctx: Ctx, deps: SendDeps & { now?: Date } = {}) {
  const now = deps.now ?? new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  if (ist.getUTCHours() * 60 + ist.getUTCMinutes() < 19 * 60 + 30) return { skipped: "Waits until 19:30 IST" };
  const today = startOfTodayIST(now);
  const prep = await withSystemTx(async (tx) => {
    const settings = await outboundSettingsInternal(tx, ctx.orgId);
    if (!settings.dailySummary.enabled) return null;
    if (await dailySummaryDoneInternal(tx, ctx.orgId, today)) return null;
    const gmail = await findIntegrationInternal(tx, ctx.orgId, "gmail");
    if (gmail?.status !== "connected") return null;
    const org = await getOrgSettingsInternal(tx, ctx.orgId);
    const to = settings.dailySummary.to.length ? settings.dailySummary.to : await ownerEmailsInternal(tx, ctx.orgId);
    const r = await reportInternal(tx, ctx.orgId, today);
    const details = await countLeadsNeedingDetailsInternal(tx, ctx.orgId);
    return { to, org, r, details };
  });
  if (!prep || !prep.to.length) return { skipped: "Off, already sent, or Gmail not connected" };
  const { r } = prep;
  const body = [
    `Today at ${prep.org.orgName} (${formatDate(todayIST(now))}):`,
    "",
    `- New leads: ${r.received} (${r.matched} matched to a product)`,
    `- Replies sent: ${r.sentByPeople} by the team, ${r.autoSent} automatically`,
    `- Waiting in the Outbox: ${r.heldNow} held, ${r.readyNow} ready to send`,
    `- Leads that need a product or request type: ${prep.details}`,
    `- Emails set aside (not buyers): ${r.ignored}`,
    `- Time to first reply (median): ${formatMinutes(r.firstReplyMedianMinutes)}`,
    "",
    "Open Inquira to work the Outbox and the leads.",
  ].join("\n");
  return sendDailySummaryInternal(ctx, { to: prep.to, subject: `Inquira today: ${r.received} new lead${r.received === 1 ? "" : "s"}, ${r.heldNow} held`, body }, deps);
}

