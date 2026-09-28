"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { updateOrgSettings } from "@/modules/core/service";
import { saveTradeIndiaCredentials, syncTradeIndia, testTradeIndiaConnection } from "@/modules/sources/tradeindia/service";
import { disconnectGmail, saveGmailClient, startGmailConnect, syncGmail } from "@/modules/sources/gmail/service";
import { createMcpToken, revokeMcpToken } from "@/modules/mcp/service";
import { createClassificationRule, updateClassificationRule } from "@/modules/email/service";
import { updateBuyleadRules } from "@/modules/buyleads/service";
import { authorize } from "@/modules/core/permissions";

const done = <T,>(r: Awaited<ReturnType<typeof runAction<T>>>) => { revalidatePath("/settings"); revalidatePath("/", "layout"); return r; };

export async function saveTradeIndiaAction(input: { userId: string; profileId: string; key: string }) {
  const s = await requireSession("integrations.manage");
  return done(await runAction(() => saveTradeIndiaCredentials(s.ctx, input)));
}
export async function testTradeIndiaAction() {
  const s = await requireSession("integrations.manage");
  return done(await runAction(() => testTradeIndiaConnection(s.ctx, {})));
}
export async function syncNowAction(provider: "gmail" | "tradeindia") {
  const s = await requireSession("sync.run");
  return done(await runAction(async () => {
    authorize(s.ctx, "sync.run");
    const sys = { orgId: s.ctx.orgId, actor: { kind: "system" as const, job: `manual:${provider}` } };
    return provider === "gmail" ? syncGmail(sys) : syncTradeIndia(sys);
  }));
}
export async function saveGmailClientAction(input: { clientId: string; clientSecret: string }) {
  const s = await requireSession("integrations.manage");
  return done(await runAction(() => saveGmailClient(s.ctx, input)));
}
export async function connectGmailAction() {
  const s = await requireSession("integrations.manage");
  return runAction(() => startGmailConnect(s.ctx, {}));
}
export async function disconnectGmailAction() {
  const s = await requireSession("integrations.manage");
  return done(await runAction(() => disconnectGmail(s.ctx, {})));
}
export async function createTokenAction(name: string, expiresInDays: number | null) {
  const s = await requireSession("mcp_tokens.manage");
  return done(await runAction(() => createMcpToken(s.ctx, { name, expiresInDays })));
}
export async function revokeTokenAction(id: string) {
  const s = await requireSession("mcp_tokens.manage");
  return done(await runAction(() => revokeMcpToken(s.ctx, { id })));
}
export async function createRuleAction(input: { name: string; matchType: "sender_email" | "sender_domain" | "subject_contains" | "body_contains"; pattern: string; action: "ignore" | "needs_review" | "international" | "inquiry"; priority: number }) {
  const s = await requireSession("rules.write");
  return done(await runAction(() => createClassificationRule(s.ctx, { ...input, enabled: true, applyToReviewQueue: input.action === "ignore" })));
}
export async function updateRuleAction(id: string, patch: { enabled?: boolean; deleted?: boolean }) {
  const s = await requireSession("rules.write");
  return done(await runAction(() => updateClassificationRule(s.ctx, { id, ...patch })));
}
export async function saveBuyleadRulesAction(input: Parameters<typeof updateBuyleadRules>[1]) {
  const s = await requireSession("buylead.rules.write");
  return done(await runAction(() => updateBuyleadRules(s.ctx, input)));
}
export async function saveOrgAction(input: { quoteValidityDays: number; defaultPriceBasis: string }) {
  const s = await requireSession("settings.write");
  return done(await runAction(() => updateOrgSettings(s.ctx, input)));
}
