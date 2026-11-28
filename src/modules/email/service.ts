import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { AppError, notFound } from "@/lib/errors";
import { startOfTodayIST } from "@/lib/format";
import { audit, emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { enqueueJobInternal } from "@/modules/core/service";
import { markAiCorrectedInternal } from "@/modules/ai/corrections";
import { findLeadByThreadInternal, findRecentLeadByContactInternal, getLeadInternal, noteBuyerMessageInternal, noteOwnGmailReplyInternal, upsertLeadInternal } from "@/modules/leads/service";
import type { LeadSource, NormalizedLead } from "@/modules/leads/types";
import { classificationRules, emailMessages } from "./schema";
import { classifyEmail, ruleMatches, type ClassifyResult } from "./classify";
import { bestText, isUsableText } from "./parsers/text";
import { extractAddress } from "./parsers/indiamart";
import type { ParseResult, ParsedLeadFields } from "./parsers/types";
import { EMAIL_CLASSES, type IngestMessage } from "./types";

export type EmailRow = typeof emailMessages.$inferSelect;
const BODY_LIMIT = 20_000;

function channelFor(p: ParseResult | undefined, fallback: string): string {
  if (!p) return fallback;
  if (p.source === "tradeindia") return "tradeindia_email";
  return p.kind === "buylead" ? "indiamart_buylead" : "indiamart_enquiry";
}

function portalSource(fromEmail: string | null): LeadSource {
  if (fromEmail && /indiamart\.com$/i.test(fromEmail)) return "indiamart";
  if (fromEmail && /tradeindia\.com$/i.test(fromEmail)) return "tradeindia";
  return "gmail";
}

/** The team's rules in the order they are checked: top of Settings → Email rules first (priority, then age). */
async function activeRules(tx: Tx, orgId: string) {
  return tx.select().from(classificationRules)
    .where(and(eq(classificationRules.orgId, orgId), isNull(classificationRules.deletedAt), eq(classificationRules.enabled, true)))
    .orderBy(asc(classificationRules.priority), asc(classificationRules.createdAt), asc(classificationRules.id));
}

/**
 * Stores one message (idempotent on gmail id), classifies it, and creates/links the lead.
 * Called by the Gmail sync job. Every message is stored — nothing is skipped silently.
 */
export async function ingestMessageInternal(tx: Tx, ctx: Ctx, m: IngestMessage, own: { ownAddresses: string[] }) {
  const [existing] = await tx.select({ id: emailMessages.id }).from(emailMessages)
    .where(and(eq(emailMessages.orgId, ctx.orgId), eq(emailMessages.gmailMessageId, m.gmailMessageId)));
  if (existing) return { emailId: existing.id, duplicate: true, classification: null, leadId: null, leadCreated: false };

  // A lead removed automatically after its reply still counts: the buyer writing again brings it back.
  const threadLead = await findLeadByThreadInternal(tx, ctx.orgId, m.gmailThreadId, { includeAutoRemoved: true });
  const rules = await activeRules(tx, ctx.orgId);
  const input = {
    id: m.gmailMessageId, threadId: m.gmailThreadId, from: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail ?? "",
    to: m.toEmails, subject: m.subject, text: m.text, html: m.html, headers: m.headers, labelIds: m.labelIds, date: m.receivedAt,
  };
  const r = classifyEmail(input, { ownAddresses: own.ownAddresses, rules, threadHasLead: !!threadLead });
  const isOutgoing = m.labelIds.includes("SENT") || (!!m.fromEmail && own.ownAddresses.includes(m.fromEmail));
  const bodyText = bestText({ text: m.text, html: m.html }).slice(0, BODY_LIMIT);
  // Keep HTML only when the text part is unusable (portal templates), so it can be re-parsed later.
  const bodyHtml = !isUsableText(m.text) && m.html ? m.html.slice(0, 200_000) : null;

  const [row] = await tx.insert(emailMessages).values({
    orgId: ctx.orgId, gmailMessageId: m.gmailMessageId, gmailThreadId: m.gmailThreadId, historyId: m.historyId ?? null,
    rfcMessageId: m.rfcMessageId ?? null, fromEmail: m.fromEmail, fromName: m.fromName, toEmails: m.toEmails, ccEmails: m.ccEmails,
    subject: m.subject, snippet: m.snippet, bodyText, bodyHtml, labelIds: m.labelIds, headers: pickHeaders(m.headers),
    receivedAt: m.receivedAt, isOutgoing, classification: r.classification, classificationReason: r.reason, classifiedBy: r.by,
    classifiedAt: new Date(), parserFormat: r.parsed?.format ?? null,
    parsed: r.parsed || r.hints ? ({ ...(r.parsed ?? {}), hints: r.hints ?? null } as Record<string, unknown>) : null,
    confidence: r.parsed?.confidence ?? null, createdBy: actorString(ctx.actor), attachmentNames: (m.attachments ?? []).slice(0, 20).map((n) => n.slice(0, 200)),
  }).returning();

  const { leadId, leadCreated } = await applyClassification(tx, ctx, row!, r, threadLead?.id ?? null);
  // A person replied from Gmail in a lead's thread: the lead counts as replied (Inquira's own sends are skipped there).
  if (m.labelIds.includes("SENT") && threadLead && !threadLead.deletedAt) {
    await tx.update(emailMessages).set({ leadId: threadLead.id }).where(eq(emailMessages.id, row!.id));
    await noteOwnGmailReplyInternal(tx, ctx, threadLead.id, m.receivedAt, m.gmailMessageId);
  }
  // Emails the rules could not settle go to the Advanced AI tier first, if the company turned it on (G-AI-6).
  if (r.classification === "needs_review") await enqueueJobInternal(tx, ctx, { type: "ai.work", dedupeKey: "ai.work" });
  await audit(tx, ctx, { action: "email.ingest", entityType: "email_message", entityId: row!.id, changes: { classification: r.classification, by: r.by, leadId } });
  await emit(tx, ctx, { type: "email.received", entityType: "email_message", entityId: row!.id, payload: { from: m.fromEmail, subject: m.subject.slice(0, 200) } });
  await emit(tx, ctx, { type: "email.classified", entityType: "email_message", entityId: row!.id, payload: { classification: r.classification, by: r.by, leadId } });
  return { emailId: row!.id, duplicate: false, classification: r.classification, leadId, leadCreated };
}

function pickHeaders(h: Record<string, string>) {
  const keep = ["message-id", "in-reply-to", "references", "list-unsubscribe", "reply-to", "date", "subject"];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (keep.includes(k.toLowerCase())) out[k.toLowerCase()] = v.slice(0, 2000);
  return out;
}

async function applyClassification(tx: Tx, ctx: Ctx, row: EmailRow, r: ClassifyResult, threadLeadId: string | null) {
  let leadId: string | null = null;
  let leadCreated = false;
  if ((r.classification === "inquiry" || r.classification === "international") && (r.parsed || r.by.startsWith("rule:"))) {
    const fields: ParsedLeadFields = r.parsed?.fields ?? { contactName: row.fromName, email: row.fromEmail, productText: row.subject, message: row.bodyText?.slice(0, 2000) ?? null };
    const source: LeadSource = r.parsed?.source ?? portalSource(row.fromEmail);
    const res = await upsertLeadInternal(tx, ctx, {
      ...fields,
      source,
      sourceRef: r.parsed?.sourceRef ?? `gmail:${row.gmailMessageId}`,
      channel: channelFor(r.parsed, "direct_email"),
      isInternational: r.classification === "international",
      receivedAt: row.receivedAt,
      gmailThreadId: row.gmailThreadId,
      gmailMessageId: row.gmailMessageId,
      rawPayload: { email: { id: row.gmailMessageId, subject: row.subject, from: row.fromEmail }, parsed: r.parsed ?? null },
    });
    leadId = res.leadId;
    leadCreated = res.created;
  } else if (r.classification === "conversation") {
    leadId = threadLeadId;
    if (!leadId) {
      const f = r.parsed?.fields;
      const l = await findRecentLeadByContactInternal(tx, ctx.orgId, { phone: f?.phone, email: f?.email ?? row.fromEmail }, r.parsed?.source, { includeAutoRemoved: true });
      leadId = l?.id ?? null;
    }
    // The buyer wrote again: back to "Not replied" (and back in the list if it was removed after its reply).
    if (leadId && !row.isOutgoing && !(await noteBuyerMessageInternal(tx, ctx, leadId, row.receivedAt))) leadId = null;
  }
  if (leadId) await tx.update(emailMessages).set({ leadId }).where(eq(emailMessages.id, row.id));
  return { leadId, leadCreated };
}

// ---------- review queue ----------

export const listEmailsNeedingReview = defineService({
  name: "email.needingReview",
  input: z.object({ limit: z.number().int().min(1).max(25).default(10), cursor: z.string().regex(/^\d+$/).optional(), bodyChars: z.number().int().min(200).max(4000).default(1500) }),
  permission: "emails.read",
  handler: async (ctx, input, tx) => {
    const offset = Number(input.cursor ?? 0);
    const where = and(eq(emailMessages.orgId, ctx.orgId), inArray(emailMessages.classification, ["needs_review", "pending"]));
    const [{ total } = { total: 0 }] = await tx.select({ total: sql<number>`count(*)::int` }).from(emailMessages).where(where);
    const rows = await tx.select().from(emailMessages).where(where).orderBy(desc(emailMessages.receivedAt)).limit(input.limit + 1).offset(offset);
    const items = rows.slice(0, input.limit).map((r) => ({
      id: r.id, from: r.fromName ? `${r.fromName} <${r.fromEmail}>` : r.fromEmail, subject: r.subject, receivedAt: r.receivedAt,
      reason: r.classificationReason, hints: (r.parsed as { hints?: unknown } | null)?.hints ?? null,
      suggestion: (r.parsed as { suggestion?: unknown } | null)?.suggestion ?? null,
      parsedFields: (r.parsed as { fields?: unknown } | null)?.fields ?? null,
      body: (r.bodyText ?? r.snippet ?? "").slice(0, input.bodyChars),
      bodyTruncated: (r.bodyText?.length ?? 0) > input.bodyChars,
    }));
    return { items, total, nextCursor: rows.length > input.limit ? String(offset + input.limit) : null };
  },
});

export const listEmailsForLead = defineService({
  name: "email.forLead",
  input: z.object({ leadId: z.string().uuid() }),
  permission: "emails.read",
  handler: async (ctx, input, tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    const conds = [eq(emailMessages.leadId, lead.id)];
    if (lead.gmailThreadId) conds.push(eq(emailMessages.gmailThreadId, lead.gmailThreadId));
    return tx.select().from(emailMessages)
      .where(and(eq(emailMessages.orgId, ctx.orgId), sql`(${sql.join(conds, sql` or `)})`))
      .orderBy(emailMessages.receivedAt).limit(50);
  },
});

const leadFieldsInput = z.object({
  contactName: z.string().trim().max(120).nullish(),
  companyName: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(80).nullish(),
  state: z.string().trim().max(80).nullish(),
  country: z.string().trim().max(80).nullish(),
  productText: z.string().trim().max(300).nullish(),
  quantityText: z.string().trim().max(100).nullish(),
  message: z.string().trim().max(4000).nullish(),
});

const classificationInput = z.object({
  emailId: z.string().uuid(),
  classification: z.enum(EMAIL_CLASSES),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().trim().min(1).max(500),
  lead: leadFieldsInput.optional(),
  leadId: z.string().uuid().optional(),
});
export type EmailClassificationInput = z.output<typeof classificationInput>;

export const submitEmailClassification = defineService({
  name: "email.submitClassification",
  input: classificationInput,
  permission: "emails.classify",
  handler: (ctx, input, tx) => classifyEmailInternal(tx, ctx, input),
});

/**
 * Classifies one stored email: by a person, by the Claude connector (MCP) or by the Advanced AI tier.
 * Automated actors (MCP, AI) may only classify emails still in review, and a low-confidence answer only
 * leaves a suggestion for a person. When a person or the connector changes what the AI decided, the AI's
 * decision is marked corrected (G-AI-9).
 */
export async function classifyEmailInternal(tx: Tx, ctx: Ctx, input: EmailClassificationInput) {
  const [row] = await tx.select().from(emailMessages).where(and(eq(emailMessages.orgId, ctx.orgId), eq(emailMessages.id, input.emailId)));
  if (!row) throw notFound("Email");
  const automated = ctx.actor.kind === "mcp" || ctx.actor.kind === "ai";
  if (automated && !["needs_review", "pending"].includes(row.classification)) {
    throw new AppError("CONFLICT", `Email is already classified as ${row.classification}; only emails in review can be classified automatically.`);
  }
  const by = actorString(ctx.actor);
  const parsed = (row.parsed ?? {}) as Record<string, unknown>;

  // Low confidence stays in review for a person (brief §7.6); the suggestion is shown in the queue.
  if (automated && input.confidence === "low") {
    await tx.update(emailMessages).set({ parsed: { ...parsed, suggestion: { ...input, by, at: new Date().toISOString() } } }).where(eq(emailMessages.id, row.id));
    await audit(tx, ctx, { action: "email.suggest", entityType: "email_message", entityId: row.id, changes: { suggested: input.classification, confidence: "low" } });
    return { status: "kept_for_review" as const, emailId: row.id, leadId: null, leadCreated: false };
  }
  if (row.classifiedBy?.startsWith("ai:") && !automated) {
    await markAiCorrectedInternal(tx, ctx, { entityType: "email_message", entityId: row.id, task: "email.classify", correctedValue: input.classification });
  }

  let leadId: string | null = null;
  let leadCreated = false;
  if (input.classification === "inquiry" || input.classification === "international") {
    const f = input.lead ?? {};
    const n: NormalizedLead = {
      contactName: f.contactName ?? row.fromName, companyName: f.companyName, phone: f.phone, email: f.email ?? row.fromEmail,
      city: f.city, state: f.state, country: f.country, productText: f.productText ?? row.subject, quantityText: f.quantityText,
      message: f.message ?? row.bodyText?.slice(0, 2000) ?? null,
      source: portalSource(row.fromEmail), sourceRef: (parsed as { sourceRef?: string | null }).sourceRef ?? `gmail:${row.gmailMessageId}`,
      channel: portalSource(row.fromEmail) === "gmail" ? "direct_email" : "review", isInternational: input.classification === "international",
      receivedAt: row.receivedAt, gmailThreadId: row.gmailThreadId, gmailMessageId: row.gmailMessageId,
      rawPayload: { email: { id: row.gmailMessageId, subject: row.subject, from: row.fromEmail }, classifiedBy: by },
    };
    const res = await upsertLeadInternal(tx, ctx, n);
    leadId = res.leadId;
    leadCreated = res.created;
  } else if (input.classification === "conversation") {
    leadId = input.leadId ?? (await findLeadByThreadInternal(tx, ctx.orgId, row.gmailThreadId, { includeAutoRemoved: true }))?.id
      ?? (await findRecentLeadByContactInternal(tx, ctx.orgId, { email: input.lead?.email ?? row.fromEmail, phone: input.lead?.phone }, undefined, { includeAutoRemoved: true }))?.id ?? null;
    if (!leadId) throw new AppError("VALIDATION", "Conversation needs a leadId (no lead matches this thread or sender).");
    if (!row.isOutgoing) await noteBuyerMessageInternal(tx, ctx, leadId, row.receivedAt); // brings back a lead removed after its reply
    if (!(await getLeadInternal(tx, ctx.orgId, leadId))) throw notFound("Lead");
  }

  await tx.update(emailMessages).set({
    classification: input.classification, classificationReason: input.reason, classifiedBy: by, classifiedAt: new Date(),
    confidence: input.confidence, leadId, parsed: { ...parsed, suggestion: null },
  }).where(eq(emailMessages.id, row.id));
  await audit(tx, ctx, { action: "email.classify", entityType: "email_message", entityId: row.id, changes: { classification: [row.classification, input.classification], confidence: input.confidence, leadId } });
  await emit(tx, ctx, { type: "email.classified", entityType: "email_message", entityId: row.id, payload: { classification: input.classification, by, leadId } });
  return { status: "classified" as const, emailId: row.id, leadId, leadCreated };
}

// ---------- rules ----------

export const listClassificationRules = defineService({
  name: "email.listRules",
  input: z.object({}).default({}),
  permission: "rules.read",
  handler: (ctx, _i, tx) =>
    tx.select().from(classificationRules).where(and(eq(classificationRules.orgId, ctx.orgId), isNull(classificationRules.deletedAt)))
      .orderBy(classificationRules.priority, classificationRules.createdAt),
});

export const ruleInput = z.object({
  name: z.string().trim().min(1).max(120),
  matchType: z.enum(["sender_email", "sender_domain", "subject_contains", "body_contains"]),
  pattern: z.string().trim().toLowerCase().min(2).max(200),
  action: z.enum(["ignore", "needs_review", "international", "inquiry"]),
  /** Position in the check order (lower first). Left out, a new rule goes to the end of the list. */
  priority: z.number().int().min(1).max(1000).optional(),
  enabled: z.boolean().default(true),
});

/** Public mailbox providers: a domain-wide rule on these would hit every buyer using them. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "ymail.com", "rediffmail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "protonmail.com", "proton.me", "zoho.com", "zohomail.in", "gmx.com", "mail.com",
]);

export const createClassificationRule = defineService({
  name: "email.createRule",
  input: ruleInput.extend({ applyToReviewQueue: z.boolean().default(false) }),
  permission: "rules.write",
  handler: async (ctx, input, tx) => {
    const { applyToReviewQueue, ...rule } = input;
    if (rule.matchType === "sender_domain" && FREE_MAIL_DOMAINS.has(rule.pattern.replace(/^@/, ""))) {
      throw new AppError("VALIDATION", `${rule.pattern} is a public email provider used by many buyers. Make a rule for the exact sender address instead.`, { fieldErrors: { pattern: ["Use the full sender address for public email providers"] } });
    }
    if (rule.priority === undefined) {
      const [{ max } = { max: 0 }] = await tx.select({ max: sql<number>`coalesce(max(${classificationRules.priority}), 0)::int` }).from(classificationRules)
        .where(and(eq(classificationRules.orgId, ctx.orgId), isNull(classificationRules.deletedAt)));
      rule.priority = Math.min(1000, max + 1);
    }
    const [r] = await tx.insert(classificationRules).values({ orgId: ctx.orgId, ...rule, priority: rule.priority, createdBy: actorString(ctx.actor) }).returning();
    await audit(tx, ctx, { action: "rule.create", entityType: "classification_rule", entityId: r!.id, changes: rule });
    await emit(tx, ctx, { type: "rule.created", entityType: "classification_rule", entityId: r!.id });
    let applied = 0;
    if (applyToReviewQueue && rule.action === "ignore") {
      const queue = await tx.select().from(emailMessages).where(and(eq(emailMessages.orgId, ctx.orgId), inArray(emailMessages.classification, ["needs_review", "pending"])));
      const cleared: string[] = [];
      for (const e of queue) {
        const m = { id: e.gmailMessageId, from: e.fromEmail ?? "", to: e.toEmails, subject: e.subject ?? "", text: e.bodyText, html: null, date: e.receivedAt };
        if (ruleMatches(r!, m, e.bodyText ?? "")) cleared.push(e.id);
      }
      if (cleared.length) {
        applied = cleared.length;
        await tx.update(emailMessages).set({ classification: "ignored", classificationReason: `Rule: ${rule.name}`, classifiedBy: `rule:${r!.id}`, classifiedAt: new Date() })
          .where(and(eq(emailMessages.orgId, ctx.orgId), inArray(emailMessages.id, cleared)));
        await tx.update(classificationRules).set({ hitCount: applied }).where(eq(classificationRules.id, r!.id));
        await audit(tx, ctx, { action: "rule.apply_to_review_queue", entityType: "classification_rule", entityId: r!.id, changes: { ignored: applied, emailIds: cleared.slice(0, 100) } });
      }
    }
    return { rule: r!, applied };
  },
});

/**
 * Settings → Email rules → ↑ / ↓: moves a rule one place in the check order. The first rule that matches an email
 * decides, so order matters when two rules could match (for example "ignore @vendor.com" above "inquiry: subject
 * contains price"). Every rule is renumbered 1, 2, 3… in one go, so the order stays exact.
 */
export const moveClassificationRule = defineService({
  name: "email.moveRule",
  input: z.object({ id: z.string().uuid(), direction: z.enum(["up", "down"]) }),
  permission: "rules.write",
  handler: async (ctx, input, tx) => {
    const all = await tx.select({ id: classificationRules.id, priority: classificationRules.priority }).from(classificationRules)
      .where(and(eq(classificationRules.orgId, ctx.orgId), isNull(classificationRules.deletedAt)))
      .orderBy(asc(classificationRules.priority), asc(classificationRules.createdAt), asc(classificationRules.id));
    const i = all.findIndex((r) => r.id === input.id);
    if (i < 0) throw notFound("Rule");
    const j = input.direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= all.length) return { moved: false };
    [all[i], all[j]] = [all[j]!, all[i]!];
    for (const [k, r] of all.entries()) {
      const priority = Math.min(1000, k + 1);
      if (r.priority !== priority) await tx.update(classificationRules).set({ priority }).where(eq(classificationRules.id, r.id));
    }
    await audit(tx, ctx, { action: "rule.move", entityType: "classification_rule", entityId: input.id, changes: { direction: input.direction, position: [i + 1, j + 1] } });
    return { moved: true };
  },
});

export const updateClassificationRule = defineService({
  name: "email.updateRule",
  input: z.object({ id: z.string().uuid(), enabled: z.boolean().optional(), priority: z.number().int().min(1).max(1000).optional(), deleted: z.boolean().optional() }),
  permission: "rules.write",
  handler: async (ctx, input, tx) => {
    const patch: Partial<typeof classificationRules.$inferInsert> = {};
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.deleted) patch.deletedAt = new Date();
    const [r] = await tx.update(classificationRules).set(patch).where(and(eq(classificationRules.id, input.id), eq(classificationRules.orgId, ctx.orgId))).returning();
    if (!r) throw notFound("Rule");
    await audit(tx, ctx, { action: input.deleted ? "rule.delete" : "rule.update", entityType: "classification_rule", entityId: r.id, changes: patch });
    return r;
  },
});

/** Compact rules for MCP. */
export const getClassificationRulesCompact = defineService({
  name: "email.rulesCompact",
  input: z.object({}).default({}),
  permission: "rules.read",
  handler: async (ctx, _i, tx) => {
    const rows = await activeRules(tx, ctx.orgId);
    return rows.map((r) => ({ match: r.matchType, pattern: r.pattern, action: r.action, name: r.name }));
  },
});

// ---------- reconciliation ----------

export async function reconciliationInternal(tx: Tx, orgId: string, since: Date = startOfTodayIST()) {
  const rows = await tx.select({ c: emailMessages.classification, n: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(and(eq(emailMessages.orgId, orgId), eq(emailMessages.isOutgoing, false), gte(emailMessages.receivedAt, since)))
    .groupBy(emailMessages.classification);
  const by: Record<string, number> = {};
  for (const r of rows) by[r.c] = r.n;
  const received = Object.values(by).reduce((a, b) => a + b, 0);
  const pending = (by.needs_review ?? 0) + (by.pending ?? 0);
  const [{ backlog = 0 } = {}] = await tx.select({ backlog: sql<number>`count(*)::int` }).from(emailMessages)
    .where(and(eq(emailMessages.orgId, orgId), inArray(emailMessages.classification, ["needs_review", "pending"]), lt(emailMessages.receivedAt, since)));
  return { received, classified: received - pending, pendingReview: pending, olderBacklog: backlog, byClass: by };
}

export const getReconciliation = defineService({
  name: "email.reconciliation",
  input: z.object({ since: z.string().datetime({ offset: true }).optional() }).default({}),
  permission: "dashboard.read",
  handler: (ctx, i, tx) => reconciliationInternal(tx, ctx.orgId, i.since ? new Date(i.since) : undefined),
});

export function senderDomain(email: string | null): string | null {
  if (!email) return null;
  return extractAddress(email).split("@")[1] ?? null;
}

/** Which of these Gmail message ids are already stored (so the sync doesn't download them again). */
export async function storedGmailIdsInternal(tx: Tx, orgId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await tx.select({ id: emailMessages.gmailMessageId }).from(emailMessages)
    .where(and(eq(emailMessages.orgId, orgId), inArray(emailMessages.gmailMessageId, ids)));
  return new Set(rows.map((r) => r.id));
}

/** Threading metadata of an ingested message (used by quotes to reply in the same Gmail thread). */
export async function getMessageMetaInternal(tx: Tx, orgId: string, gmailMessageId: string) {
  const [m] = await tx.select({ subject: emailMessages.subject, rfcMessageId: emailMessages.rfcMessageId, headers: emailMessages.headers })
    .from(emailMessages).where(and(eq(emailMessages.orgId, orgId), eq(emailMessages.gmailMessageId, gmailMessageId)));
  return m ? { subject: m.subject, rfcMessageId: m.rfcMessageId, references: m.headers["references"] ?? null } : null;
}

// ---------- Advanced AI tier (src/modules/ai) ----------

/** Review emails the Advanced tier has not looked at, oldest first, received in the last `days` days. */
export async function reviewEmailsAwaitingAiInternal(tx: Tx, orgId: string, opts: { limit: number; days: number }) {
  const since = new Date(Date.now() - opts.days * 86400_000);
  return tx.select().from(emailMessages)
    .where(and(eq(emailMessages.orgId, orgId), eq(emailMessages.classification, "needs_review"), isNull(emailMessages.aiCheckedAt),
      eq(emailMessages.isOutgoing, false), gte(emailMessages.receivedAt, since)))
    .orderBy(asc(emailMessages.receivedAt)).limit(opts.limit);
}

export async function markEmailAiCheckedInternal(tx: Tx, orgId: string, emailId: string) {
  await tx.update(emailMessages).set({ aiCheckedAt: new Date() }).where(and(eq(emailMessages.id, emailId), eq(emailMessages.orgId, orgId)));
}

// ---------- outbound pipeline (src/modules/outbound) ----------

/** What the hold rules need to know about a lead's emails (G-OUT-2): buyer replies and attachments. */
export async function leadEmailFactsInternal(tx: Tx, orgId: string, leadId: string) {
  const rows = await tx.select({ classification: emailMessages.classification, attachmentNames: emailMessages.attachmentNames, receivedAt: emailMessages.receivedAt })
    .from(emailMessages).where(and(eq(emailMessages.orgId, orgId), eq(emailMessages.leadId, leadId), eq(emailMessages.isOutgoing, false)));
  return {
    inConversation: rows.some((r) => r.classification === "conversation"),
    buyerAttachment: rows.some((r) => r.attachmentNames.length > 0),
    lastInboundAt: rows.reduce<Date | null>((a, r) => (!a || r.receivedAt > a ? r.receivedAt : a), null),
  };
}

/** Buyer replies the pipeline has not planned an answer for yet, received in the last `hours`. */
export async function repliesToPlanInternal(tx: Tx, orgId: string, opts: { hours: number; limit: number }) {
  return tx.select().from(emailMessages).where(and(
    eq(emailMessages.orgId, orgId), eq(emailMessages.classification, "conversation"), eq(emailMessages.isOutgoing, false),
    isNull(emailMessages.replyPlannedAt), sql`${emailMessages.leadId} is not null`,
    gte(emailMessages.receivedAt, new Date(Date.now() - opts.hours * 3600_000)),
  )).orderBy(asc(emailMessages.receivedAt)).limit(opts.limit);
}

export async function markReplyPlannedInternal(tx: Tx, orgId: string, emailId: string) {
  await tx.update(emailMessages).set({ replyPlannedAt: new Date() }).where(and(eq(emailMessages.id, emailId), eq(emailMessages.orgId, orgId)));
}

/** The last messages of a lead's thread, oldest first, for an AI reply draft. */
export async function threadTextInternal(tx: Tx, orgId: string, leadId: string, limit = 5) {
  const rows = await tx.select({ fromEmail: emailMessages.fromEmail, fromName: emailMessages.fromName, bodyText: emailMessages.bodyText, isOutgoing: emailMessages.isOutgoing, receivedAt: emailMessages.receivedAt })
    .from(emailMessages).where(and(eq(emailMessages.orgId, orgId), eq(emailMessages.leadId, leadId))).orderBy(desc(emailMessages.receivedAt)).limit(limit);
  return rows.reverse().map((r) => ({ from: r.isOutgoing ? "us" : r.fromName ?? r.fromEmail ?? "buyer", text: (r.bodyText ?? "").slice(0, 3000) }));
}

/** Emails set aside as not needing a reply since a time (GOAL G-RPT-1 "ignored"). */
export async function ignoredSinceInternal(tx: Tx, orgId: string, since: Date): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(emailMessages)
    .where(and(eq(emailMessages.orgId, orgId), eq(emailMessages.classification, "ignored"), eq(emailMessages.isOutgoing, false), gte(emailMessages.receivedAt, since)));
  return r?.n ?? 0;
}
