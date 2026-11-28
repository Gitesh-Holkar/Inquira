/**
 * The outbound pipeline (GOAL G-OUT-1 to G-OUT-10, G-TPL-*, G-CNV-2, G-CNV-3, G-FUP-1; ADR-032).
 *
 * prepare: a message is composed from the company's template for its purpose and channel, today's rates, the
 *          product's terms and documents; or written by AI / Claude (always held).
 * check:   the hold rules (`hold-rules.ts`) list every reason a person must look first.
 * decide:  held → a person; no reason and the channel's mode allows this purpose → approved for automatic
 *          sending; otherwise a draft that a person sends. Default mode is shadow: nothing is automatic.
 * send:    only `send.ts` sends, for a person's approval at once, for automatic ones inside the send window,
 *          under the caps and while not paused; the rules are checked again just before.
 * Every step writes an audit row; every message records rule set, template version, rates and documents.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withSystemTx, type Tx } from "@/db/client";
import { AppError, notFound, publicMessage } from "@/lib/errors";
import { addDays, formatAmount, formatDate, formatNumber, formatPercent, todayIST } from "@/lib/format";
import { whatsappUrl } from "@/lib/phone";
import { audit, emit } from "@/modules/core/audit";
import { authorize } from "@/modules/core/permissions";
import { defineExternalService, defineService, parseInput, runTx } from "@/modules/core/service-kit";
import { getOrgSettingsInternal, notifyOnceInternal, setOutboundSettingsInternal } from "@/modules/core/service";
import { actorString, type Ctx } from "@/modules/core/types";
import { moqByProductInternal, productTermsInternal } from "@/modules/catalog/service";
import { samplePolicySchema } from "@/modules/catalog/types";
import {
  getLeadInternal, isExistingCustomerInternal, leadIdsOfContactInternal, leadsToPlanInternal, markLeadPlannedInternal, markQuotedInternal,
  noteReplySentInternal, syncLeadOutboxInternal, type Lead,
} from "@/modules/leads/service";
import { leadEmailFactsInternal, markReplyPlannedInternal, repliesToPlanInternal, threadTextInternal } from "@/modules/email/service";
import { greetingName, quoteItemsForProductInternal, renderQuote } from "@/modules/quotes/service";
import { ensureDefaultTemplatesInternal, getDefaultTemplateInternal } from "@/modules/templates/service";
import { DEFAULT_ITEM_BLOCK, WHATSAPP_PURPOSES, render, type TemplatePurpose, type TemplateVars } from "@/modules/templates/engine";
import { latestValidDocumentsInternal } from "@/modules/documents/service";
import { DOCUMENT_TYPE_SHORT, type DocumentType } from "@/modules/documents/types";
import { draftReplyInternal } from "@/modules/ai/service";
import { holdReasons, insideWindow, matchingTeamRules, RULE_SET_VERSION, type HoldContext } from "./hold-rules";
import { outboundRules, outgoingMessages, type HoldReason } from "./schema";
import { sendEmailInternal, type SendDeps } from "./send";
import {
  AUTO_PURPOSES, CHANNELS, MESSAGE_PURPOSES, PURPOSE_LABELS, RULE_MATCH_TYPES, outboundSettingsSchema, readOutboundSettings,
  type Channel, type MessagePurpose, type OutboundSettings,
} from "./types";

export type OutgoingMessage = typeof outgoingMessages.$inferSelect;

/** New leads and buyer replies are planned only while fresh, so turning the pipeline on never floods the outbox. */
const PLAN_WINDOW_HOURS = 48;
const ALREADY_SENT_DAYS = 30;
/** Automatic sending stops starting new emails after this long (the tick allows 60 s). */
const SEND_BUDGET_MS = 20_000;
const QUOTES = new Set<MessagePurpose>(["first_quotation", "detailed_quotation"]);
/** Placeholders a message may leave empty without holding it. */
const OPTIONAL_VARS = new Set(["contact_name", "company_name", "city", "quantity", "sample_note", "hsn_code", "lead_time", "grade", "org_name", "items_block"]);
/** Terms every quoted item must have (G-KB-2): an empty one holds the quotation instead of printing a blank. */
const REQUIRED_ITEM_TERMS: [string, string][] = [["price_per_kg", "price"], ["gst_percent", "GST"], ["price_basis", "price basis"], ["pack_size", "pack size"], ["moq", "MOQ"], ["payment_terms", "payment terms"]];
const PRICE_MENTION = /(₹|\brs\.?\s*\d|\binr\s*\d|\d+(?:\.\d+)?\s*(?:\/|per)\s*kg\b)/i;

// ---------- settings (G-OUT-3, G-OUT-4) ----------

export async function outboundSettingsInternal(tx: Tx, orgId: string): Promise<OutboundSettings> {
  return readOutboundSettings((await getOrgSettingsInternal(tx, orgId)).outbound);
}

export const getOutboundSettings = defineService({
  name: "outbound.settings",
  input: z.object({}).default({}),
  permission: "settings.read",
  handler: async (ctx, _i, tx) => ({
    settings: await outboundSettingsInternal(tx, ctx.orgId),
    rules: await tx.select().from(outboundRules).where(and(eq(outboundRules.orgId, ctx.orgId), isNull(outboundRules.deletedAt))).orderBy(desc(outboundRules.createdAt)),
  }),
});

/**
 * Saves the sending settings. Changing a mode is owner-only (G-OUT-3) and audited on its own; the pause switch
 * and the rest need `settings.write`.
 */
export const saveOutboundSettings = defineService({
  name: "outbound.saveSettings",
  input: outboundSettingsSchema,
  permission: "settings.write",
  handler: async (ctx, input, tx) => {
    const before = await outboundSettingsInternal(tx, ctx.orgId);
    if (input.modes.email !== before.modes.email && !(ctx.actor.kind === "human" && ctx.actor.role === "owner") && ctx.actor.kind !== "system") {
      throw new AppError("FORBIDDEN", "Only an owner can change the sending mode.");
    }
    const s = await getOrgSettingsInternal(tx, ctx.orgId);
    await setOutboundSettingsInternal(tx, ctx.orgId, input);
    if (input.modes.email !== before.modes.email) {
      await audit(tx, ctx, { action: "outbound.mode", entityType: "org_settings", entityId: s.id, changes: { email: [before.modes.email, input.modes.email] } });
    }
    await audit(tx, ctx, { action: "outbound.settings", entityType: "org_settings", entityId: s.id, changes: { paused: input.paused, window: input.window, caps: input.caps, followUpDays: input.followUpDays, dailySummary: input.dailySummary } });
    await emit(tx, ctx, { type: "settings.sending_changed", entityType: "org_settings", entityId: s.id, payload: { mode: input.modes.email, paused: input.paused } });
    return input;
  },
});

export const ruleInput = z.object({ matchType: z.enum(RULE_MATCH_TYPES), pattern: z.string().trim().min(1).max(200), note: z.string().trim().max(200).nullish() });

/** A hold rule from a correction (G-OUT-9): every future message that matches is held. */
export const createOutboundRule = defineService({
  name: "outbound.createRule",
  input: ruleInput,
  permission: "quotes.create",
  handler: async (ctx, input, tx) => createRuleInternal(tx, ctx, input),
});

async function createRuleInternal(tx: Tx, ctx: Ctx, input: z.output<typeof ruleInput>) {
  const [r] = await tx.insert(outboundRules).values({ orgId: ctx.orgId, matchType: input.matchType, pattern: input.pattern, note: input.note || null, createdBy: actorString(ctx.actor) }).returning();
  await audit(tx, ctx, { action: "outbound.rule_create", entityType: "outbound_rule", entityId: r!.id, changes: { matchType: input.matchType, pattern: input.pattern } });
  return r!;
}

export const removeOutboundRule = defineService({
  name: "outbound.removeRule",
  input: z.object({ id: z.string().uuid() }),
  permission: "settings.write",
  handler: async (ctx, input, tx) => {
    const [r] = await tx.update(outboundRules).set({ deletedAt: new Date() }).where(and(eq(outboundRules.id, input.id), eq(outboundRules.orgId, ctx.orgId), isNull(outboundRules.deletedAt))).returning();
    if (!r) throw notFound("Rule");
    await audit(tx, ctx, { action: "outbound.rule_remove", entityType: "outbound_rule", entityId: r.id, changes: { pattern: r.pattern } });
    return { ok: true };
  },
});

// ---------- compose ----------

const DOC_WORDS: [RegExp, DocumentType][] = [
  [/\b(coa|certificate of analysis)\b/i, "coa"], [/\b(tds|technical data ?sheet)\b/i, "tds"], [/\b(msds|sds|safety data ?sheet)\b/i, "msds"],
  [/\bspec(?:ification)?s?(?:\s*sheet)?\b/i, "specification"], [/\bbrochure|catalog(?:ue)?\b/i, "brochure"], [/\b(fssai|halal|kosher|iso|organic) (?:certificate|certification)\b/i, "certificate"],
];
export function requestedDocuments(text: string): DocumentType[] {
  return [...new Set(DOC_WORDS.filter(([re]) => re.test(text)).map(([, t]) => t))];
}

type Composed = {
  subject: string | null; body: string; templateId: string | null; templateVersion: number | null;
  items: unknown[]; priceEntryIds: string[]; documentIds: string[]; blankTerms: string[];
  rateProblem: HoldContext["rateProblem"]; missingDocuments: string[]; sample?: HoldContext["sample"];
};

const kindOf = (c: Channel) => (c === "email" ? "quote_email" : "whatsapp") as "quote_email" | "whatsapp";
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Builds the text of one message from the company's template and data. Reads only; never writes. */
async function composeInternal(tx: Tx, ctx: Ctx, lead: Lead, purpose: MessagePurpose, channel: Channel, extra: { written?: string; replyTo?: OutgoingMessage | null; buyerText: string }): Promise<Composed> {
  const empty = { items: [], priceEntryIds: [], documentIds: [], blankTerms: [], rateProblem: null, missingDocuments: [] };
  if (extra.written !== undefined) return { ...empty, subject: null, body: extra.written, templateId: null, templateVersion: null };
  const tplPurpose = purpose as TemplatePurpose;
  let tpl = await getDefaultTemplateInternal(tx, ctx.orgId, kindOf(channel), tplPurpose);
  if (!tpl && ctx.actor.kind !== "human") {
    // The background job may add the starting templates; a person's request may not (it runs under their access).
    await ensureDefaultTemplatesInternal(tx, { orgId: ctx.orgId, actor: { kind: "system", job: "outbound.templates" } });
    tpl = await getDefaultTemplateInternal(tx, ctx.orgId, kindOf(channel), tplPurpose);
  }
  if (!tpl) throw new AppError("VALIDATION", "There is no template for this kind of message. Create one under Templates.");
  const settings = await getOrgSettingsInternal(tx, ctx.orgId);
  const terms = lead.productId ? await productTermsInternal(tx, ctx.orgId, lead.productId) : null;
  const validityDate = addDays(todayIST(), settings.quoteValidityDays);
  const { items, flagged } = lead.productId ? await quoteItemsForProductInternal(tx, ctx.orgId, lead.productId) : { items: [], flagged: false };
  const first = items[0];
  const policy = samplePolicySchema.catch({ freeSampleSize: null, requiredDetails: [], note: null }).parse(settings.samplePolicy ?? {});
  const moq = lead.productId ? (await moqByProductInternal(tx, ctx.orgId, [lead.productId])).get(lead.productId) ?? null : null;

  let documentIds: string[] = [];
  let missingDocuments: string[] = [];
  let documents = "";
  if (purpose === "document_share") {
    const wanted = requestedDocuments(extra.buyerText);
    if (!wanted.length) missingDocuments = ["document (which one the buyer wants is not clear)"];
    else {
      const found = await latestValidDocumentsInternal(tx, ctx.orgId, lead.productId, wanted);
      documentIds = found.map((d) => d.id);
      missingDocuments = wanted.filter((t) => !found.some((d) => d.type === t)).map((t) => DOCUMENT_TYPE_SHORT[t]);
      documents = listJoin(found.map((d) => DOCUMENT_TYPE_SHORT[d.type]));
      if (!found.length) documents = listJoin(wanted.map((t) => DOCUMENT_TYPE_SHORT[t]));
    }
  }

  const vars: TemplateVars = {
    contact_name: greetingName(lead), company_name: lead.companyName ?? "", city: lead.city ?? "", org_name: settings.orgName,
    product: terms?.name ?? lead.productText ?? "your requirement", quantity: lead.quantityText ? ` (${lead.quantityText})` : "",
    validity_date: formatDate(validityDate), payment_terms: terms?.paymentTerms || settings.paymentTerms || "",
    price_per_kg: first ? formatAmount(first.pricePerKgInr) : "", price_basis: first?.priceBasis ?? "", gst_percent: first ? formatPercent(first.gstPercent) : "",
    pack_size: first?.packSize ?? "", grade: first?.gradeName ?? "", hsn_code: terms?.hsnCode ?? "", lead_time: terms?.leadTime ?? "",
    moq: moq !== null ? formatNumber(moq) : "", documents,
    sample_size: policy.freeSampleSize ?? "", sample_details: policy.requiredDetails.map((d) => `- ${d}`).join("\n"), sample_note: policy.note ?? "",
    quote_date: extra.replyTo?.sentAt ? formatDate(extra.replyTo.sentAt.toISOString().slice(0, 10)) : "",
  };

  let subject: string | null;
  let body: string;
  const blank = new Set<string>();
  // The placeholders this template prints (its own, plus the item block's when it uses {{items_block}}).
  const used = new Set([...`${tpl.subject ?? ""}\n${tpl.body}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!));
  if (used.has("items_block")) for (const m of DEFAULT_ITEM_BLOCK.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) used.add(m[1]!);
  if (QUOTES.has(purpose) && items.length) {
    const r = renderQuote(lead, items, tpl, validityDate, { name: settings.orgName, paymentTerms: vars.payment_terms || null });
    subject = r.subject;
    body = r.body;
    // Every quoted item must have the terms the template prints (G-KB-2): blank holds, never prints empty.
    for (const it of items) {
      const v: Record<string, string> = { price_per_kg: it.pricePerKgInr, gst_percent: it.gstPercent, price_basis: it.priceBasis, pack_size: it.packSize ?? "", moq: it.moqKg ?? "", payment_terms: it.paymentTerms || settings.paymentTerms || "" };
      for (const [k, label] of REQUIRED_ITEM_TERMS) if (used.has(k) && !v[k]) blank.add(label);
    }
  } else {
    const withBlock = { ...vars, items_block: first ? render(DEFAULT_ITEM_BLOCK, vars) : "" };
    subject = tpl.subject ? render(tpl.subject, withBlock) : null;
    body = render(tpl.body, withBlock);
    for (const k of used) if (!OPTIONAL_VARS.has(k) && !(vars as Record<string, string | undefined>)[k]) blank.add(k.replace(/_/g, " "));
  }
  if (channel === "whatsapp") subject = null;
  return {
    subject, body, templateId: tpl.id, templateVersion: tpl.version, items, priceEntryIds: items.map((i) => i.priceEntryId), documentIds,
    blankTerms: [...blank], rateProblem: QUOTES.has(purpose) ? (!items.length ? "missing" : flagged ? "flagged" : null) : null, missingDocuments,
    sample: purpose === "sample_request" ? { offered: terms?.sampleAvailable ?? null, policySet: !!policy.freeSampleSize } : undefined,
  };
}

/** Everything the hold rules need, read fresh from the database. */
async function holdContextInternal(tx: Tx, ctx: Ctx, lead: Lead, purpose: MessagePurpose, channel: Channel, c: Composed, extra: { buyerText: string; aiWritten: boolean; excludeId?: string }): Promise<HoldContext> {
  const facts = await leadEmailFactsInternal(tx, ctx.orgId, lead.id);
  const moq = lead.productId ? (await moqByProductInternal(tx, ctx.orgId, [lead.productId])).get(lead.productId) ?? null : null;
  const sameBuyer = await leadIdsOfContactInternal(tx, ctx.orgId, lead.contactId, QUOTES.has(purpose) || purpose === "document_share" ? lead.productId : null);
  const since = new Date(Date.now() - ALREADY_SENT_DAYS * 86400_000);
  const [prior] = sameBuyer.length ? await tx.select({ id: outgoingMessages.id }).from(outgoingMessages).where(and(
    eq(outgoingMessages.orgId, ctx.orgId), inArray(outgoingMessages.leadId, sameBuyer), eq(outgoingMessages.purpose, purpose),
    eq(outgoingMessages.state, "sent"), gte(outgoingMessages.sentAt, since), extra.excludeId ? sql`${outgoingMessages.id} <> ${extra.excludeId}` : undefined,
  )).limit(1) : [];
  const rules = await tx.select().from(outboundRules).where(and(eq(outboundRules.orgId, ctx.orgId), eq(outboundRules.enabled, true), isNull(outboundRules.deletedAt)));
  return {
    purpose, channel, buyerText: extra.buyerText, productMatched: !!lead.productId,
    quantityKg: lead.quantityKg === null ? null : Number(lead.quantityKg),
    belowMoq: lead.quantityKg !== null && moq !== null ? Number(lead.quantityKg) < moq : null,
    international: lead.isInternational, rateProblem: c.rateProblem, blankTerms: c.blankTerms, body: c.body,
    inConversation: facts.inConversation, existingCustomer: await isExistingCustomerInternal(tx, ctx.orgId, lead), buyerAttachment: facts.buyerAttachment,
    alreadySent: !!prior, missingDocuments: c.missingDocuments, sample: c.sample, aiWritten: extra.aiWritten,
    customRules: matchingTeamRules(rules, { email: lead.email, phone: lead.phone, productId: lead.productId, text: `${extra.buyerText}\n${c.body}` }),
  };
}

// ---------- prepare (draft → held / approved / draft) ----------

export type PrepareInput = {
  leadId: string;
  purpose: MessagePurpose;
  channel: Channel;
  /** Written by AI or Claude instead of a template: always held (G-CNV-3). */
  written?: string;
  /** A person asked for it: never sent automatically. */
  byPerson?: boolean;
  replyTo?: OutgoingMessage | null;
  /** Answering a buyer's email: its thread and message id, and its text for the rules. */
  thread?: { gmailThreadId: string; gmailMessageId: string; text: string } | null;
};

/** Prepares one message: compose, check, decide, record, tell the team once when held. */
export async function prepareMessageInternal(tx: Tx, ctx: Ctx, p: PrepareInput): Promise<OutgoingMessage | null> {
  const lead = await getLeadInternal(tx, ctx.orgId, p.leadId);
  if (!lead) throw notFound("Lead");
  const to = p.channel === "email" ? lead.email : lead.phone;
  if (!to) return null; // G-OUT-5: no address on this channel
  if (p.channel === "whatsapp" && p.written === undefined && !WHATSAPP_PURPOSES.includes(p.purpose as TemplatePurpose)) return null;
  const buyerText = [lead.productText, lead.message, p.thread?.text].filter(Boolean).join("\n");
  const c = await composeInternal(tx, ctx, lead, p.purpose, p.channel, { written: p.written, replyTo: p.replyTo, buyerText });
  const aiWritten = p.written !== undefined;
  const reasons: HoldReason[] = holdReasons(await holdContextInternal(tx, ctx, lead, p.purpose, p.channel, c, { buyerText, aiWritten }));
  if (aiWritten && PRICE_MENTION.test(c.body)) reasons.push({ rule: "price_in_text", detail: "The text mentions a price: check it against the rate book" });
  const settings = await outboundSettingsInternal(tx, ctx.orgId);
  const mode = p.channel === "email" ? settings.modes.email : "shadow";
  const auto = !p.byPerson && !reasons.length && AUTO_PURPOSES[mode].includes(p.purpose);
  const state = reasons.length ? "held" : auto ? "approved" : "draft";
  const [m] = await tx.insert(outgoingMessages).values({
    orgId: ctx.orgId, leadId: lead.id, channel: p.channel, purpose: p.purpose, state, toAddress: to, subject: c.subject, body: c.body,
    templateId: c.templateId, templateVersion: c.templateVersion, priceEntryIds: c.priceEntryIds, items: c.items, documentIds: c.documentIds,
    holdReasons: reasons, ruleSetVersion: RULE_SET_VERSION, mode, autoApproved: auto, approvedBy: auto ? "system:outbound" : null, approvedAt: auto ? new Date() : null,
    replyToId: p.replyTo?.id ?? null,
    gmailThreadId: p.channel === "email" ? p.thread?.gmailThreadId ?? p.replyTo?.gmailThreadId ?? lead.gmailThreadId : null,
    inReplyToMessageId: p.channel === "email" ? p.thread?.gmailMessageId ?? (p.replyTo ? null : lead.gmailMessageId) : null,
    createdBy: actorString(ctx.actor),
  }).returning();
  await audit(tx, ctx, { action: "outbound.prepare", entityType: "outgoing_message", entityId: m!.id, changes: {
    leadId: lead.id, purpose: p.purpose, channel: p.channel, state, mode, ruleSet: RULE_SET_VERSION, holdReasons: reasons.map((r) => r.rule),
    template: c.templateId ? { id: c.templateId, version: c.templateVersion } : null, priceEntryIds: c.priceEntryIds, documentIds: c.documentIds,
  } });
  await emit(tx, ctx, { type: "message.prepared", entityType: "outgoing_message", entityId: m!.id, payload: { leadId: lead.id, purpose: p.purpose, state } });
  await syncLeadOutboxInternal(tx, ctx.orgId, lead.id); // something waits: the lead is "Not replied"
  if (state === "held") {
    await notifyOnceInternal(tx, ctx, {
      kind: "message_held", entityType: "outgoing_message", entityId: m!.id, href: "/outbox",
      title: `Held: ${PURPOSE_LABELS[p.purpose].toLowerCase()} for ${lead.contactName ?? lead.companyName ?? "a buyer"}`, body: reasons.map((r) => r.detail).join(" · "),
    });
  }
  return m!;
}

/** Which messages a new lead gets (G-OUT-5 channel rule, G-TPL-1 purposes). "wait" = not yet (no product). */
function purposesFor(lead: Lead, belowMoq: boolean | null): MessagePurpose[] | "wait" | "ai_reply" {
  if (lead.intent === "not_buyer") return [];
  if (lead.isInternational) return ["international_ack"];
  if (lead.intent === "complaint" || lead.intent === "order" || lead.intent === "price_negotiation") return "ai_reply";
  if (!lead.productId) return "wait";
  if (lead.intent === "document_request") return ["document_share"];
  if (lead.intent === "sample_request") return ["sample_request"];
  if (belowMoq) return ["below_moq"];
  return ["first_quotation"];
}

/** Job step: plan new leads (rules decided what they are; now decide what to send). */
export async function planNewLeadsInternal(ctx: Ctx, opts: { fetchImpl?: typeof fetch } = {}) {
  const leads = await withSystemTx((tx) => leadsToPlanInternal(tx, ctx.orgId, { hours: PLAN_WINDOW_HOURS, limit: 20 }));
  let prepared = 0;
  for (const lead of leads) {
    const moq = lead.productId ? await withSystemTx(async (tx) => (await moqByProductInternal(tx, ctx.orgId, [lead.productId!])).get(lead.productId!) ?? null) : null;
    const plan = purposesFor(lead, lead.quantityKg !== null && moq !== null ? Number(lead.quantityKg) < moq : null);
    if (plan === "wait") continue; // a person or AI may still add the product within the window
    if (plan === "ai_reply") {
      const draft = await draftReplyInternal(ctx, { leadId: lead.id, thread: [{ from: lead.contactName ?? "buyer", text: lead.message ?? lead.productText ?? "" }] }, { fetchImpl: opts.fetchImpl });
      await withSystemTx(async (tx) => {
        if (draft) for (const channel of CHANNELS) if (await prepareMessageInternal(tx, ctx, { leadId: lead.id, purpose: "reply", channel, written: draft.body })) { prepared++; break; }
        if (!draft) await notifyOnceInternal(tx, ctx, { kind: "needs_reply", entityType: "lead", entityId: lead.id, href: `/leads/${lead.id}`, title: `${lead.contactName ?? "A buyer"} needs a personal reply`, body: "A complaint, an order or a price negotiation: no template answers it." });
        await markLeadPlannedInternal(tx, ctx.orgId, lead.id);
      });
      continue;
    }
    await withSystemTx(async (tx) => {
      for (const purpose of plan) for (const channel of CHANNELS) if (await prepareMessageInternal(tx, ctx, { leadId: lead.id, purpose, channel })) prepared++;
      await markLeadPlannedInternal(tx, ctx.orgId, lead.id);
    });
  }
  return { leads: leads.length, prepared };
}

/** Job step: buyer replies in a conversation (G-CNV-2 documents, G-CNV-3 AI drafts, always for a person). */
export async function planRepliesInternal(ctx: Ctx, opts: { fetchImpl?: typeof fetch } = {}) {
  const emails = await withSystemTx((tx) => repliesToPlanInternal(tx, ctx.orgId, { hours: PLAN_WINDOW_HOURS, limit: 10 }));
  let prepared = 0;
  for (const e of emails) {
    const text = e.bodyText ?? e.snippet ?? "";
    const thread = { gmailThreadId: e.gmailThreadId, gmailMessageId: e.gmailMessageId, text };
    if (requestedDocuments(text).length) {
      await withSystemTx(async (tx) => {
        if (await prepareMessageInternal(tx, ctx, { leadId: e.leadId!, purpose: "document_share", channel: "email", thread })) prepared++;
        await markReplyPlannedInternal(tx, ctx.orgId, e.id);
      });
      continue;
    }
    const history = await withSystemTx((tx) => threadTextInternal(tx, ctx.orgId, e.leadId!));
    const draft = await draftReplyInternal(ctx, { leadId: e.leadId!, thread: history.length ? history : [{ from: e.fromName ?? "buyer", text }] }, { fetchImpl: opts.fetchImpl });
    await withSystemTx(async (tx) => {
      if (draft && (await prepareMessageInternal(tx, ctx, { leadId: e.leadId!, purpose: "reply", channel: "email", written: draft.body, thread }))) prepared++;
      if (!draft) await notifyOnceInternal(tx, ctx, { kind: "buyer_replied", entityType: "email_message", entityId: e.id, href: `/leads/${e.leadId}`, title: `${e.fromName ?? e.fromEmail ?? "A buyer"} replied`, body: (e.subject ?? "").slice(0, 200) });
      await markReplyPlannedInternal(tx, ctx.orgId, e.id);
    });
  }
  return { replies: emails.length, prepared };
}

/** Job step: follow-ups (G-FUP-1) for quotations sent `followUpDays` ago with no word from the buyer since. */
export async function planFollowUpsInternal(ctx: Ctx, now = new Date()) {
  return withSystemTx(async (tx) => {
    const settings = await outboundSettingsInternal(tx, ctx.orgId);
    if (!settings.followUpDays) return { followUps: 0 };
    const due = new Date(now.getTime() - settings.followUpDays * 86400_000);
    const oldest = new Date(due.getTime() - 14 * 86400_000);
    const sent = await tx.select().from(outgoingMessages).where(and(
      eq(outgoingMessages.orgId, ctx.orgId), eq(outgoingMessages.state, "sent"), inArray(outgoingMessages.purpose, ["first_quotation", "detailed_quotation"]),
      lte(outgoingMessages.sentAt, due), gte(outgoingMessages.sentAt, oldest),
      sql`not exists (select 1 from app.outgoing_messages f where f.reply_to_id = ${outgoingMessages.id} and f.purpose = 'follow_up')`,
    )).limit(20);
    let n = 0;
    for (const m of sent) {
      const lead = m.leadId ? await getLeadInternal(tx, ctx.orgId, m.leadId) : null;
      if (!lead || !["quoted", "contacted"].includes(lead.status)) continue;
      const facts = await leadEmailFactsInternal(tx, ctx.orgId, lead.id);
      if (facts.lastInboundAt && m.sentAt && facts.lastInboundAt > m.sentAt) continue; // the buyer wrote back
      if (await prepareMessageInternal(tx, ctx, { leadId: lead.id, purpose: "follow_up", channel: m.channel as Channel, replyTo: m })) n++;
    }
    return { followUps: n };
  });
}

/** The `outbound.plan` job: new leads, buyer replies, follow-ups. */
export async function runOutboundPlan(ctx: Ctx, opts: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  await withSystemTx((tx) => ensureDefaultTemplatesInternal(tx, { orgId: ctx.orgId, actor: { kind: "system", job: "outbound.templates" } }));
  const a = await planNewLeadsInternal(ctx, opts);
  const b = await planRepliesInternal(ctx, opts);
  const c = await planFollowUpsInternal(ctx, opts.now);
  return { ...a, ...b, ...c };
}

// ---------- send ----------

/** Re-checks the rules right before an automatic send: the buyer may have replied, a rate may have expired. */
async function recheckInternal(tx: Tx, ctx: Ctx, m: OutgoingMessage): Promise<{ reasons: HoldReason[]; stop?: string }> {
  if (!m.leadId) return { reasons: [] }; // the owner's daily summary: no buyer rules apply
  const lead = await getLeadInternal(tx, ctx.orgId, m.leadId);
  if (!lead) return { reasons: [], stop: "The lead was deleted" };
  if (["won", "lost", "not_relevant"].includes(lead.status)) return { reasons: [], stop: `The lead is now ${lead.status.replace("_", " ")}` };
  const buyerText = [lead.productText, lead.message].filter(Boolean).join("\n");
  const c: Composed = {
    subject: m.subject, body: m.body, templateId: m.templateId, templateVersion: m.templateVersion, items: m.items, priceEntryIds: m.priceEntryIds,
    documentIds: m.documentIds, blankTerms: [], rateProblem: null, missingDocuments: [],
  };
  if (QUOTES.has(m.purpose as MessagePurpose) && lead.productId) {
    const now = await quoteItemsForProductInternal(tx, ctx.orgId, lead.productId);
    const stillCurrent = m.priceEntryIds.every((id) => now.items.some((i) => i.priceEntryId === id));
    c.rateProblem = !now.items.length || !stillCurrent ? "missing" : now.flagged ? "flagged" : null;
  }
  return { reasons: holdReasons(await holdContextInternal(tx, ctx, lead, m.purpose as MessagePurpose, m.channel as Channel, c, { buyerText, aiWritten: false, excludeId: m.id })) };
}

async function recordSentInternal(tx: Tx, ctx: Ctx, m: OutgoingMessage, r: { gmailMessageId: string | null; threadId: string | null; attached: string[] }) {
  const [after] = await tx.update(outgoingMessages).set({
    state: "sent", sentAt: new Date(), sentBy: actorString(ctx.actor), gmailMessageId: r.gmailMessageId, gmailThreadId: r.threadId ?? m.gmailThreadId, error: null, attempts: m.attempts + 1,
  }).where(and(eq(outgoingMessages.id, m.id), eq(outgoingMessages.orgId, ctx.orgId))).returning();
  if (m.leadId && QUOTES.has(m.purpose as MessagePurpose)) await markQuotedInternal(tx, ctx, m.leadId);
  if (m.leadId) await noteReplySentInternal(tx, ctx.orgId, m.leadId, after!.sentAt ?? new Date()); // replied, unless something else still waits
  // G-OUT-10: rule set, template version, rate entries and the actor, on every send.
  await audit(tx, ctx, { action: "outbound.sent", entityType: "outgoing_message", entityId: m.id, changes: {
    leadId: m.leadId, channel: m.channel, purpose: m.purpose, ruleSet: m.ruleSetVersion, mode: m.mode, automatic: m.autoApproved,
    template: m.templateId ? { id: m.templateId, version: m.templateVersion } : null, priceEntryIds: m.priceEntryIds, attached: r.attached, gmailMessageId: r.gmailMessageId,
  } });
  await emit(tx, ctx, { type: "message.sent", entityType: "outgoing_message", entityId: m.id, payload: { leadId: m.leadId, purpose: m.purpose, channel: m.channel } });
  return after!;
}

async function recordFailedInternal(ctx: Ctx, m: OutgoingMessage, error: string) {
  return withSystemTx(async (tx) => {
    const [after] = await tx.update(outgoingMessages).set({ state: "failed", error: error.slice(0, 500), attempts: m.attempts + 1 })
      .where(and(eq(outgoingMessages.id, m.id), eq(outgoingMessages.orgId, ctx.orgId))).returning();
    await audit(tx, ctx, { action: "outbound.failed", entityType: "outgoing_message", entityId: m.id, changes: { error: error.slice(0, 300) } });
    await emit(tx, ctx, { type: "message.failed", entityType: "outgoing_message", entityId: m.id, payload: { leadId: m.leadId } });
    await notifyOnceInternal(tx, ctx, { kind: "message_failed", entityType: "outgoing_message", entityId: m.id, href: "/outbox?view=stopped", title: `Not sent: ${PURPOSE_LABELS[m.purpose as MessagePurpose].toLowerCase()}`, body: error.slice(0, 300) });
    if (m.leadId) await syncLeadOutboxInternal(tx, ctx.orgId, m.leadId); // a failed send keeps the lead in "Not replied"
    return after!;
  });
}

function sendError(e: unknown): string {
  const p = publicMessage(e);
  return p.code === "INTERNAL" ? `Gmail error: ${(e as Error).message}`.slice(0, 300) : p.message;
}

/**
 * The `outbound.send` job: sends messages the pipeline approved, only while not paused, inside the send
 * window and under the caps (G-OUT-4). A message the caps stop is held ("send limit reached", G-OUT-2).
 */
export async function runOutboundSend(ctx: Ctx, deps: SendDeps & { now?: Date } = {}) {
  const started = Date.now();
  const now = deps.now ?? new Date();
  const settings = await withSystemTx((tx) => outboundSettingsInternal(tx, ctx.orgId));
  if (settings.paused) return { sent: 0, skipped: "Paused" };
  if (!insideWindow(now, settings.window)) return { sent: 0, skipped: "Outside the send window" };
  const due = await withSystemTx((tx) => tx.select().from(outgoingMessages).where(and(
    eq(outgoingMessages.orgId, ctx.orgId), eq(outgoingMessages.state, "approved"), eq(outgoingMessages.autoApproved, true), eq(outgoingMessages.channel, "email"),
  )).orderBy(asc(outgoingMessages.createdAt)).limit(25));
  let sent = 0;
  for (const m of due) {
    if (Date.now() - started > SEND_BUDGET_MS) return { sent, more: true };
    const gate = await withSystemTx(async (tx) => {
      const count = async (ms: number) => (await tx.select({ n: sql<number>`count(*)::int` }).from(outgoingMessages).where(and(
        eq(outgoingMessages.orgId, ctx.orgId), eq(outgoingMessages.state, "sent"), eq(outgoingMessages.autoApproved, true), gte(outgoingMessages.sentAt, new Date(Date.now() - ms)),
      )))[0]!.n;
      const capped = (await count(3600_000)) >= settings.caps.perHour || (await count(86400_000)) >= settings.caps.perDay;
      const check = await recheckInternal(tx, ctx, m);
      if (check.stop) {
        await tx.update(outgoingMessages).set({ state: "cancelled", cancelledReason: check.stop }).where(eq(outgoingMessages.id, m.id));
        await audit(tx, ctx, { action: "outbound.cancel", entityType: "outgoing_message", entityId: m.id, changes: { reason: check.stop } });
        if (m.leadId) await syncLeadOutboxInternal(tx, ctx.orgId, m.leadId);
        return "stop" as const;
      }
      const reasons = [...check.reasons, ...(capped ? [{ rule: "send_limit", detail: "The automatic send limit for this hour or day is reached" }] : [])];
      if (reasons.length) {
        await tx.update(outgoingMessages).set({ state: "held", holdReasons: reasons, autoApproved: false }).where(eq(outgoingMessages.id, m.id));
        await audit(tx, ctx, { action: "outbound.hold", entityType: "outgoing_message", entityId: m.id, changes: { holdReasons: reasons.map((r) => r.rule) } });
        await notifyOnceInternal(tx, ctx, { kind: "message_held", entityType: "outgoing_message", entityId: m.id, href: "/outbox", title: `Held before sending: ${PURPOSE_LABELS[m.purpose as MessagePurpose].toLowerCase()}`, body: reasons.map((r) => r.detail).join(" · ") });
        return "held" as const;
      }
      return "go" as const;
    });
    if (gate !== "go") continue;
    try {
      const r = await sendEmailInternal(ctx, m, deps);
      await withSystemTx((tx) => recordSentInternal(tx, ctx, m, { gmailMessageId: r.gmailMessageId, threadId: r.threadId, attached: r.attached }));
      sent++;
    } catch (e) {
      await recordFailedInternal(ctx, m, sendError(e));
    }
  }
  return { sent };
}

// ---------- people (the Outbox screen) ----------

const OUTBOX_VIEWS = { review: ["held", "draft"], waiting: ["approved"], sent: ["sent"], stopped: ["failed", "cancelled"] } as const;

/** The Outbox: messages by view, newest first, with the lead's buyer and product. */
export const listOutbox = defineService({
  name: "outbound.list",
  input: z.object({ view: z.enum(["review", "waiting", "sent", "stopped"]).default("review"), leadId: z.string().uuid().optional(), page: z.number().int().min(1).max(1000).default(1) }),
  permission: "quotes.read",
  handler: async (ctx, input, tx) => {
    const where = and(eq(outgoingMessages.orgId, ctx.orgId), input.leadId ? eq(outgoingMessages.leadId, input.leadId) : inArray(outgoingMessages.state, [...OUTBOX_VIEWS[input.view]]));
    const rows = await tx.select().from(outgoingMessages).where(where).orderBy(desc(outgoingMessages.createdAt)).limit(26).offset((input.page - 1) * 25);
    const items = [];
    for (const m of rows.slice(0, 25)) {
      const l = m.leadId ? await getLeadInternal(tx, ctx.orgId, m.leadId) : null;
      items.push({ ...m, lead: l ? { id: l.id, contactName: l.contactName, companyName: l.companyName, productText: l.productText, phone: l.phone, email: l.email } : null });
    }
    return { items, more: rows.length > 25 };
  },
});

/** How many messages wait for a person, for the menu badge. */
export async function outboxCountsInternal(tx: Tx, orgId: string) {
  const rows = await tx.select({ state: outgoingMessages.state, n: sql<number>`count(*)::int` }).from(outgoingMessages)
    .where(eq(outgoingMessages.orgId, orgId)).groupBy(outgoingMessages.state);
  const by = Object.fromEntries(rows.map((r) => [r.state, r.n])) as Record<string, number>;
  return { review: (by.held ?? 0) + (by.draft ?? 0), held: by.held ?? 0, waiting: by.approved ?? 0, failed: by.failed ?? 0 };
}

export const getOutboxCounts = defineService({ name: "outbound.counts", input: z.object({}).default({}), permission: "quotes.read", handler: (ctx, _i, tx) => outboxCountsInternal(tx, ctx.orgId) });

/** A person asks for a message for a lead (lead page). It is checked like any other and never sent automatically. */
export const prepareMessage = defineService({
  name: "outbound.prepare",
  input: z.object({ leadId: z.string().uuid(), purpose: z.enum(MESSAGE_PURPOSES).refine((p) => p !== "reply" && p !== "daily_summary"), channel: z.enum(CHANNELS) }),
  permission: "quotes.create",
  handler: async (ctx, input, tx) => {
    const m = await prepareMessageInternal(tx, ctx, { ...input, byPerson: true });
    if (!m) throw new AppError("VALIDATION", input.channel === "email" ? "This lead has no email address." : "This lead has no phone number, or this message is email only.");
    return m;
  },
});

/** Claude connector (G-CNV-3): a reply it wrote, always held for a person. */
export const createReplyDraft = defineService({
  name: "outbound.replyDraft",
  input: z.object({ leadId: z.string().uuid(), body: z.string().trim().min(1).max(4000), channel: z.enum(CHANNELS).default("email") }),
  permission: "quotes.create",
  handler: async (ctx, input, tx) => {
    const m = await prepareMessageInternal(tx, ctx, { leadId: input.leadId, purpose: "reply", channel: input.channel, written: input.body, byPerson: true });
    if (!m) throw new AppError("VALIDATION", "This lead has no address on that channel.");
    return m;
  },
});

async function pendingMessage(tx: Tx, ctx: Ctx, id: string, states: string[]) {
  const [m] = await tx.select().from(outgoingMessages).where(and(eq(outgoingMessages.id, id), eq(outgoingMessages.orgId, ctx.orgId)));
  if (!m) throw notFound("Message");
  if (!states.includes(m.state)) throw new AppError("CONFLICT", `This message is already ${m.state}.`);
  return m;
}

/** A person edits the text. An automatic message they edit waits for them to send it. */
export const editMessage = defineService({
  name: "outbound.edit",
  input: z.object({ id: z.string().uuid(), subject: z.string().trim().max(300).nullish(), body: z.string().trim().min(1).max(10_000) }),
  permission: "quotes.create",
  handler: async (ctx, input, tx) => {
    const m = await pendingMessage(tx, ctx, input.id, ["draft", "held", "approved", "failed"]);
    const [after] = await tx.update(outgoingMessages).set({
      body: input.body, subject: input.subject === undefined ? m.subject : input.subject, edited: true,
      ...(m.state === "approved" ? { state: "draft", autoApproved: false, approvedBy: null, approvedAt: null } : {}),
    }).where(eq(outgoingMessages.id, m.id)).returning();
    await audit(tx, ctx, { action: "outbound.edit", entityType: "outgoing_message", entityId: m.id, changes: { chars: [m.body.length, input.body.length] } });
    return after!;
  },
});

/** A person rejects a message; the correction can become a hold rule (G-OUT-9). */
export const rejectMessage = defineService({
  name: "outbound.reject",
  input: z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(300), rule: ruleInput.optional() }),
  permission: "quotes.create",
  handler: async (ctx, input, tx) => {
    const m = await pendingMessage(tx, ctx, input.id, ["draft", "held", "approved", "failed"]);
    const [after] = await tx.update(outgoingMessages).set({ state: "cancelled", cancelledReason: input.reason }).where(eq(outgoingMessages.id, m.id)).returning();
    const rule = input.rule ? await createRuleInternal(tx, ctx, { ...input.rule, note: input.rule.note || input.reason }) : null;
    await audit(tx, ctx, { action: "outbound.reject", entityType: "outgoing_message", entityId: m.id, changes: { reason: input.reason, ruleId: rule?.id ?? null } });
    await emit(tx, ctx, { type: "message.cancelled", entityType: "outgoing_message", entityId: m.id, payload: { leadId: m.leadId } });
    if (m.leadId) await syncLeadOutboxInternal(tx, ctx.orgId, m.leadId);
    return { message: after!, rule };
  },
});

const approveInput = z.object({ id: z.string().uuid(), confirmHeld: z.boolean().default(false) });

/**
 * A person approves and sends. Email goes at once through `send.ts` (the window, caps and pause switch are for
 * automatic sending only); WhatsApp returns the tap-to-send link and is recorded as sent by that person (G-OUT-7).
 * A held message needs `confirmHeld`: the person has read the reasons.
 */
export const approveAndSend = defineExternalService({
  name: "outbound.approve",
  input: approveInput,
  permission: "quotes.create",
  handler: (ctx, input) => approveAndSendInternal(ctx, input),
});

export async function approveAndSendInternal(ctx: Ctx, raw: z.input<typeof approveInput>, deps: SendDeps = {}) {
  const input = parseInput(approveInput, raw);
  authorize(ctx, "quotes.create");
  const m = await runTx(ctx, async (tx) => {
    const msg = await pendingMessage(tx, ctx, input.id, ["draft", "held", "approved", "failed"]);
    if (msg.state === "held" && !input.confirmHeld) throw new AppError("VALIDATION", "This message is held. Read the reasons, then confirm to send it anyway.");
    const [a] = await tx.update(outgoingMessages).set({ state: "approved", autoApproved: false, approvedBy: actorString(ctx.actor), approvedAt: new Date() })
      .where(eq(outgoingMessages.id, msg.id)).returning();
    await audit(tx, ctx, { action: "outbound.approve", entityType: "outgoing_message", entityId: msg.id, changes: { from: msg.state, overrodeHold: msg.state === "held" ? msg.holdReasons.map((r) => r.rule) : [] } });
    return a!;
  });
  if (m.channel === "whatsapp") {
    const url = whatsappUrl(m.toAddress!, m.body);
    const after = await runTx(ctx, (tx) => recordSentInternal(tx, ctx, m, { gmailMessageId: null, threadId: null, attached: [] }));
    return { message: after, whatsappUrl: url };
  }
  try {
    const r = await sendEmailInternal(ctx, m, deps);
    const after = await runTx(ctx, (tx) => recordSentInternal(tx, ctx, m, { gmailMessageId: r.gmailMessageId, threadId: r.threadId, attached: r.attached }));
    return { message: after, whatsappUrl: null };
  } catch (e) {
    const after = await recordFailedInternal(ctx, m, sendError(e));
    return { message: after, whatsappUrl: null, error: after.error };
  }
}

/** Messages of one lead, newest first (lead page). */
export async function messagesForLeadInternal(tx: Tx, orgId: string, leadId: string) {
  return tx.select().from(outgoingMessages).where(and(eq(outgoingMessages.orgId, orgId), eq(outgoingMessages.leadId, leadId))).orderBy(desc(outgoingMessages.createdAt)).limit(30);
}

export const messagesForLead = defineService({
  name: "outbound.forLead", input: z.object({ leadId: z.string().uuid() }), permission: "quotes.read",
  handler: (ctx, input, tx) => messagesForLeadInternal(tx, ctx.orgId, input.leadId),
});

// ---------- reports and the daily summary (GOAL G-RPT-1, G-RPT-2) ----------

/** Sent and held counts since a time, and each lead's first sent reply (for time to first reply). */
export async function outboundStatsInternal(tx: Tx, orgId: string, since: Date) {
  const [r] = await tx.select({
    autoSent: sql<number>`count(*) filter (where ${outgoingMessages.state} = 'sent' and ${outgoingMessages.autoApproved} and ${outgoingMessages.sentAt} >= ${since.toISOString()}::timestamptz)::int`,
    sentByPeople: sql<number>`count(*) filter (where ${outgoingMessages.state} = 'sent' and not ${outgoingMessages.autoApproved} and ${outgoingMessages.sentAt} >= ${since.toISOString()}::timestamptz)::int`,
    heldNow: sql<number>`count(*) filter (where ${outgoingMessages.state} = 'held')::int`,
    readyNow: sql<number>`count(*) filter (where ${outgoingMessages.state} = 'draft')::int`,
  }).from(outgoingMessages).where(and(eq(outgoingMessages.orgId, orgId), sql`${outgoingMessages.purpose} <> 'daily_summary'`));
  const first = await tx.select({ leadId: outgoingMessages.leadId, at: sql<Date>`min(${outgoingMessages.sentAt})` }).from(outgoingMessages)
    .where(and(eq(outgoingMessages.orgId, orgId), eq(outgoingMessages.state, "sent"), sql`${outgoingMessages.leadId} is not null`, sql`${outgoingMessages.purpose} <> 'daily_summary'`))
    .groupBy(outgoingMessages.leadId).having(sql`min(${outgoingMessages.sentAt}) >= ${since.toISOString()}::timestamptz`);
  return { autoSent: r?.autoSent ?? 0, sentByPeople: r?.sentByPeople ?? 0, heldNow: r?.heldNow ?? 0, readyNow: r?.readyNow ?? 0, firstSent: first.map((f) => ({ leadId: f.leadId!, at: new Date(f.at) })) };
}

/**
 * Sends the owner's daily summary through the one send path (G-RPT-2). It goes to the company's own people,
 * not to a buyer, so buyer rules do not apply; the pause switch still stops it. Recorded like every message.
 */
export async function sendDailySummaryInternal(ctx: Ctx, mail: { to: string[]; subject: string; body: string }, deps: SendDeps = {}) {
  const settings = await withSystemTx((tx) => outboundSettingsInternal(tx, ctx.orgId));
  if (settings.paused) return { skipped: "Paused" };
  const m = await withSystemTx(async (tx) => {
    const [row] = await tx.insert(outgoingMessages).values({
      orgId: ctx.orgId, leadId: null, channel: "email", purpose: "daily_summary", state: "approved", toAddress: mail.to.join(", "), subject: mail.subject, body: mail.body,
      ruleSetVersion: RULE_SET_VERSION, mode: settings.modes.email, autoApproved: true, approvedBy: actorString(ctx.actor), approvedAt: new Date(), createdBy: actorString(ctx.actor),
    }).returning();
    await audit(tx, ctx, { action: "outbound.prepare", entityType: "outgoing_message", entityId: row!.id, changes: { purpose: "daily_summary", to: mail.to.length } });
    return row!;
  });
  try {
    const r = await sendEmailInternal(ctx, m, deps);
    await withSystemTx((tx) => recordSentInternal(tx, ctx, m, { gmailMessageId: r.gmailMessageId, threadId: r.threadId, attached: [] }));
    return { sent: true, id: m.id };
  } catch (e) {
    await recordFailedInternal(ctx, m, sendError(e));
    return { sent: false, id: m.id };
  }
}

/** Whether today's summary was already sent (or tried). */
export async function dailySummaryDoneInternal(tx: Tx, orgId: string, since: Date): Promise<boolean> {
  const [r] = await tx.select({ id: outgoingMessages.id }).from(outgoingMessages)
    .where(and(eq(outgoingMessages.orgId, orgId), eq(outgoingMessages.purpose, "daily_summary"), gte(outgoingMessages.createdAt, since))).limit(1);
  return !!r;
}
