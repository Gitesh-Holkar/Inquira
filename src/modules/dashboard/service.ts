import { z } from "zod";
import { startOfTodayIST } from "@/lib/format";
import { defineService } from "@/modules/core/service-kit";
import { getIntegrationInternal } from "@/modules/core/service";
import { countLeadsByChannelSinceInternal, leadStatsInternal } from "@/modules/leads/service";
import { reconciliationInternal } from "@/modules/email/service";
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
    const arrived = await countLeadsByChannelSinceInternal(tx, ctx.orgId, "indiamart_buylead", today);
    const health = (i: typeof gmail) => ({ provider: i.provider, status: i.status, lastSyncAt: i.lastSyncAt, lastSuccessAt: i.lastSuccessAt, lastError: i.lastError, lastErrorAt: i.lastErrorAt, account: i.accountEmail });
    return {
      newToday: Object.fromEntries(stats.bySource.map((s) => [s.source, s.n])) as Record<string, number>,
      newTodayTotal: stats.bySource.reduce((a, b) => a + b.n, 0),
      needingAction: stats.needingAction,
      international: stats.international,
      reconciliation: rec,
      integrations: [health(gmail), health(ti)],
      indiamart: { ...dc, arrivedByEmail: arrived, dailyCap: rules.dailyCap, testMode: rules.testMode },
    };
  },
});
