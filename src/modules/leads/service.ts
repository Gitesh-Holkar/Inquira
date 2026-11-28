import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, not, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withSystemTx, type Tx } from "@/db/client";
import { notFound, AppError, forbidden } from "@/lib/errors";
import { can } from "@/modules/core/permissions";
import { normalizeEmail, phoneCountry, toE164 } from "@/lib/phone";
import { audit, emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { resolveContactInternal, cleanEmail } from "@/modules/contacts/service";
import { matchProduct, moqByProductInternal, productMatcherCatalog, productNameById } from "@/modules/catalog/service";
import { enqueueJobInternal, getOrgSettingsInternal } from "@/modules/core/service";
import { cancelPendingMessagesInternal, isInquiraSentInternal, leadHasPendingMessagesInternal } from "@/modules/outbound/cancel";
import { markAiCorrectedInternal } from "@/modules/ai/corrections";
import { leadNotes, leads, leadStatusChanges } from "./schema";
import { LEAD_INTENTS, LEAD_STATUSES, listLeadsInput, type LeadFilledBy, type LeadIntent, type NormalizedLead } from "./types";
import { belowMoq, intentByRules, mentionsWeight, quantityToKg, scoreLead } from "./understanding";

export { quantityToKg } from "./understanding";

export type Lead = typeof leads.$inferSelect;

const INDIA = new Set(["in", "ind", "india", "bharat"]);
export function isIndia(country: string | null | undefined): boolean {
  return !country || INDIA.has(country.trim().toLowerCase());
}

/** International = a non-Indian country, or (when no country) a non-+91 phone number. */
export function detectInternational(l: Pick<NormalizedLead, "country" | "phone" | "isInternational">): boolean {
  if (l.isInternational) return true;
  if (l.country && !isIndia(l.country)) return true;
  if (!l.country && l.phone) {
    const pc = phoneCountry(toE164(l.phone));
    if (pc && pc !== "IN") return true;
  }
  return false;
}

const DUP_WINDOW_HOURS = 48;

/**
 * Idempotent upsert of a normalised lead (ADR-009):
 *  1. same (source, source_ref) → same lead (TradeIndia rfi_id makes API and email copies collide here);
 *  2. otherwise, same source + same phone/email + same product within 48h → the existing lead
 *     (records the alternate ref and method), upgrading an email-only ref to the real inquiry id;
 *  3. otherwise insert, linking/creating the contact.
 */
export async function upsertLeadInternal(tx: Tx, ctx: Ctx, input: NormalizedLead) {
  const phone = toE164(input.phone);
  const email = cleanEmail(input.email);
  const catalog = await productMatcherCatalog(tx, ctx.orgId);
  const product = matchProduct(input.productText, catalog) ?? (input.productText ? null : matchProduct(input.message, catalog));
  const international = detectInternational({ ...input, phone });

  const [exact] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, ctx.orgId), eq(leads.source, input.source), eq(leads.sourceRef, input.sourceRef)))
    .limit(1);
  if (exact) {
    await fillMissing(tx, ctx, exact, { ...input, phone, email }, { source: input.channel, ref: input.sourceRef, method: "source_ref" });
    return { leadId: exact.id, created: false, duplicate: true, method: "source_ref" as const };
  }

  if (phone || email) {
    const since = new Date(input.receivedAt.getTime() - DUP_WINDOW_HOURS * 3600_000);
    const until = new Date(input.receivedAt.getTime() + DUP_WINDOW_HOURS * 3600_000);
    const contactMatch = or(phone ? eq(leads.phone, phone) : undefined, email ? eq(leads.email, email) : undefined);
    const candidates = await tx
      .select()
      .from(leads)
      .where(and(
        eq(leads.orgId, ctx.orgId), eq(leads.source, input.source), isNull(leads.deletedAt),
        gte(leads.receivedAt, since), lte(leads.receivedAt, until), contactMatch,
      ))
      .orderBy(asc(leads.receivedAt))
      .limit(5);
    const dup = candidates.find((c) =>
      (product && c.productId ? c.productId === product.id : sameProductText(c.productText, input.productText)));
    if (dup) {
      const inputHasRealId = !input.sourceRef.startsWith("gmail:");
      const dupIsEmailOnly = dup.sourceRef.startsWith("gmail:");
      if (inputHasRealId && dupIsEmailOnly) {
        // Upgrade the email-only lead to the real inquiry id and its channel; the email stays as an alternate
        // (the API-versus-email counts read the channel and the alternates).
        const alternateRefs = [...dup.alternateRefs, { source: dup.channel ?? "email", ref: dup.sourceRef, method: "contact_time_window" }];
        await tx.update(leads).set({ sourceRef: input.sourceRef, channel: input.channel, alternateRefs }).where(eq(leads.id, dup.id));
        await audit(tx, ctx, { action: "lead.ref_upgraded", entityType: "lead", entityId: dup.id, changes: { sourceRef: [dup.sourceRef, input.sourceRef], channel: [dup.channel, input.channel] } });
        await fillMissing(tx, ctx, { ...dup, sourceRef: input.sourceRef, channel: input.channel, alternateRefs }, { ...input, phone, email }, null);
      } else {
        await fillMissing(tx, ctx, dup, { ...input, phone, email }, { source: input.channel, ref: input.sourceRef, method: "contact_time_window" });
      }
      await emit(tx, ctx, { type: "lead.duplicate_merged", entityType: "lead", entityId: dup.id, payload: { ref: input.sourceRef, method: "contact_time_window" } });
      return { leadId: dup.id, created: false, duplicate: true, method: "contact_time_window" as const };
    }
  }

  const contact = await resolveContactInternal(tx, ctx, {
    name: input.contactName, email, phone, companyName: input.companyName, city: input.city, state: input.state, country: input.country,
  });
  // Rules first (G-AI-6): alias match, intent rules, quantity units. What they leave open goes to the AI job.
  const intent = intentByRules(input);
  const quantityKg = quantityToKg(input.quantityText);
  const filledBy: LeadFilledBy = {
    ...(product ? { product: "alias" } : {}), ...(intent ? { intent: intent.by } : {}), ...(quantityKg ? { quantity: "rule:units" } : {}),
  };
  const open = openFields({ productId: product?.id ?? null, productText: input.productText ?? null, message: input.message ?? null, intent: intent?.intent ?? null, quantityKg, quantityText: input.quantityText ?? null });
  const moq = product ? (await moqByProductInternal(tx, ctx.orgId, [product.id])).get(product.id) ?? null : null;
  const scored = scoreLead({ productId: product?.id ?? null, quantityKg, phone, email, companyName: input.companyName?.trim() || null, intent: intent?.intent ?? null }, moq);
  const [row] = await tx
    .insert(leads)
    .values({
      orgId: ctx.orgId,
      contactId: contact.contactId,
      source: input.source,
      sourceRef: input.sourceRef,
      channel: input.channel,
      isInternational: international,
      contactName: input.contactName?.trim() || null,
      companyName: input.companyName?.trim() || null,
      phone,
      email,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      country: input.country?.trim() || null,
      productText: input.productText?.trim() || null,
      productId: product?.id ?? null,
      quantityText: input.quantityText?.trim() || null,
      quantityKg,
      intent: intent?.intent ?? null,
      filledBy,
      understoodAt: open.length ? null : new Date(),
      score: scored.score,
      scoreReasons: scored.reasons,
      scoredAt: new Date(),
      message: input.message?.slice(0, 5000) ?? null,
      rawPayload: input.rawPayload ?? null,
      receivedAt: input.receivedAt,
      lastActivityAt: input.receivedAt,
      lastBuyerMessageAt: input.receivedAt,
      gmailThreadId: input.gmailThreadId ?? null,
      gmailMessageId: input.gmailMessageId ?? null,
      createdBy: actorString(ctx.actor),
    })
    .returning();
  await tx.insert(leadStatusChanges).values({ orgId: ctx.orgId, leadId: row!.id, fromStatus: null, toStatus: "new", createdBy: actorString(ctx.actor), reason: `Imported from ${input.channel}` });
  await audit(tx, ctx, { action: "lead.create", entityType: "lead", entityId: row!.id, changes: { source: input.source, sourceRef: input.sourceRef, channel: input.channel, international } });
  await emit(tx, ctx, { type: "lead.created", entityType: "lead", entityId: row!.id, payload: { source: input.source, channel: input.channel, international, productId: product?.id ?? null } });
  // One job per company drains every waiting lead (dedupe key), so a burst of leads is one AI run.
  if (open.length) await enqueueJobInternal(tx, ctx, { type: "ai.work", dedupeKey: "ai.work" });
  return { leadId: row!.id, created: true, duplicate: false, method: null };
}

/**
 * Which of product, intent and quantity the rules left open for AI: no product although there is product
 * or requirement text; no intent; no kg although the text states a weight ("1 Jar" is not open: it has no
 * weight to read, G-UND-4).
 */
export function openFields(l: { productId: string | null; productText: string | null; message: string | null; intent: string | null; quantityKg: string | null; quantityText: string | null }): ("product" | "intent" | "quantity")[] {
  const out: ("product" | "intent" | "quantity")[] = [];
  if (!l.productId && (l.productText || l.message)) out.push("product");
  if (!l.intent) out.push("intent");
  if (!l.quantityKg && (mentionsWeight(l.quantityText) || (!l.quantityText && mentionsWeight(l.message)))) out.push("quantity");
  return out;
}

function sameProductText(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const x = n(a);
  const y = n(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
}

async function fillMissing(tx: Tx, ctx: Ctx, lead: Lead, input: NormalizedLead & { phone: string | null; email: string | null }, altRef: { source: string; ref: string; method: string } | null) {
  const patch: Partial<typeof leads.$inferInsert> = {};
  const pairs: [keyof Lead & keyof typeof patch, unknown][] = [
    ["contactName", input.contactName], ["companyName", input.companyName], ["phone", input.phone], ["email", input.email],
    ["city", input.city], ["state", input.state], ["country", input.country], ["productText", input.productText],
    ["quantityText", input.quantityText], ["message", input.message], ["gmailThreadId", input.gmailThreadId], ["gmailMessageId", input.gmailMessageId],
  ];
  for (const [k, v] of pairs) {
    if (!lead[k] && v) (patch as Record<string, unknown>)[k] = typeof v === "string" ? v.trim() : v;
  }
  const sameAsPrimary = altRef && altRef.ref === lead.sourceRef && altRef.source === lead.channel;
  if (altRef && !sameAsPrimary && !lead.alternateRefs.some((r) => r.ref === altRef.ref && r.source === altRef.source)) {
    patch.alternateRefs = [...lead.alternateRefs, altRef];
  }
  if (Object.keys(patch).length) {
    await tx.update(leads).set(patch).where(eq(leads.id, lead.id));
    await audit(tx, ctx, { action: "lead.merge_duplicate", entityType: "lead", entityId: lead.id, changes: { filled: Object.keys(patch), altRef } });
    await rescoreLeadInternal(tx, ctx.orgId, lead.id);
  }
}

// ---------- replied or not (the Leads tabs; owner's request of 28 Nov 2026) ----------

/**
 * A lead is replied when a reply went out (`replied_at`), nothing for it waits or failed in the Outbox, and the
 * buyer has not written since. Everything else is "Not replied", so a message that failed to send never hides a lead.
 */
const REPLIED = and(isNotNull(leads.repliedAt), eq(leads.outboxPending, false), or(isNull(leads.lastBuyerMessageAt), gte(leads.repliedAt, leads.lastBuyerMessageAt)))!;

/** Re-reads whether anything for this lead waits or failed in the Outbox. Called by the outbound module after any change. */
export async function syncLeadOutboxInternal(tx: Tx, orgId: string, leadId: string) {
  const pending = await leadHasPendingMessagesInternal(tx, orgId, leadId);
  await tx.update(leads).set({ outboxPending: pending }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  return pending;
}

/** A message to the buyer was sent (email or WhatsApp): the lead is replied unless something else still waits. */
export async function noteReplySentInternal(tx: Tx, orgId: string, leadId: string, at: Date) {
  await tx.update(leads).set({ repliedAt: sql`greatest(${leads.repliedAt}, ${at.toISOString()}::timestamptz)`, lastActivityAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  await syncLeadOutboxInternal(tx, orgId, leadId);
}

/**
 * The buyer wrote again (a reply in the lead's thread): the lead is "Not replied" until someone answers. A lead that
 * was removed automatically after its reply comes back; one a person deleted stays deleted.
 */
export async function noteBuyerMessageInternal(tx: Tx, ctx: Ctx, leadId: string, at: Date) {
  const [l] = await tx.select({ deletedAt: leads.deletedAt, deletedReason: leads.deletedReason }).from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, ctx.orgId)));
  if (!l || (l.deletedAt && l.deletedReason !== "replied")) return false;
  await tx.update(leads).set({
    lastBuyerMessageAt: sql`greatest(${leads.lastBuyerMessageAt}, ${at.toISOString()}::timestamptz)`, lastActivityAt: new Date(),
    ...(l.deletedAt ? { deletedAt: null, deletedReason: null } : {}),
  }).where(eq(leads.id, leadId));
  if (l.deletedAt) await audit(tx, ctx, { action: "lead.restore", entityType: "lead", entityId: leadId, changes: { reason: "The buyer wrote again" } });
  return true;
}

/**
 * A person replied from Gmail in the lead's thread (seen by the Gmail sync). Counts as a reply, and Inquira's unsent
 * email messages for this lead are stopped so the buyer never gets a second answer. WhatsApp messages stay.
 * Messages Inquira itself sent are recognised and skipped (they are counted when sent).
 */
export async function noteOwnGmailReplyInternal(tx: Tx, ctx: Ctx, leadId: string, at: Date, gmailMessageId: string) {
  if (await isInquiraSentInternal(tx, ctx.orgId, gmailMessageId)) return { counted: false, cancelled: 0 };
  const cancelled = await cancelPendingMessagesInternal(tx, ctx, leadId, "all", "A person replied by email from Gmail", { includeFailed: true, channel: "email" });
  await noteReplySentInternal(tx, ctx.orgId, leadId, at);
  await audit(tx, ctx, { action: "lead.replied", entityType: "lead", entityId: leadId, changes: { by: "gmail", cancelled } });
  return { counted: true, cancelled };
}

const leadIdsInput = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(100) });

async function liveLeads(tx: Tx, orgId: string, ids: string[]) {
  return tx.select({ id: leads.id }).from(leads).where(and(eq(leads.orgId, orgId), inArray(leads.id, [...new Set(ids)]), isNull(leads.deletedAt)));
}

/**
 * "Mark as replied" (lead page and the Leads list, one or many): the team answered outside Inquira, for example
 * on WhatsApp or by phone. Inquira's unsent messages for these leads are stopped so nobody gets a second answer.
 */
export const markLeadsReplied = defineService({
  name: "leads.markReplied",
  input: leadIdsInput,
  permission: "leads.update_status",
  handler: async (ctx, input, tx) => {
    let cancelled = 0;
    const rows = await liveLeads(tx, ctx.orgId, input.leadIds);
    for (const { id } of rows) {
      const n = await cancelPendingMessagesInternal(tx, ctx, id, "all", "Replied outside Inquira", { includeFailed: true });
      cancelled += n;
      await tx.update(leads).set({ repliedAt: new Date(), outboxPending: false, lastActivityAt: new Date() }).where(eq(leads.id, id));
      await audit(tx, ctx, { action: "lead.replied", entityType: "lead", entityId: id, changes: { by: "person", cancelled: n } });
    }
    return { count: rows.length, cancelled };
  },
});

/** Moves leads back to "Not replied" (undo a mistaken "Mark as replied"). */
export const markLeadsNotReplied = defineService({
  name: "leads.markNotReplied",
  input: leadIdsInput,
  permission: "leads.update_status",
  handler: async (ctx, input, tx) => {
    const rows = await liveLeads(tx, ctx.orgId, input.leadIds);
    for (const { id } of rows) {
      await tx.update(leads).set({ repliedAt: null, lastActivityAt: new Date() }).where(eq(leads.id, id));
      await audit(tx, ctx, { action: "lead.not_replied", entityType: "lead", entityId: id, changes: {} });
    }
    return { count: rows.length };
  },
});

/** Deletes one lead (soft): it leaves every list, and its unsent messages are stopped. Audited. */
async function deleteLeadInternal(tx: Tx, ctx: Ctx, leadId: string, reason: "manual" | "replied") {
  const cancelled = await cancelPendingMessagesInternal(tx, ctx, leadId, "all", reason === "manual" ? "The lead was deleted" : "The lead was removed after its reply", { includeFailed: true });
  await tx.update(leads).set({ deletedAt: new Date(), deletedReason: reason, outboxPending: false }).where(and(eq(leads.id, leadId), eq(leads.orgId, ctx.orgId)));
  await audit(tx, ctx, { action: reason === "manual" ? "lead.delete" : "lead.auto_remove", entityType: "lead", entityId: leadId, changes: { soft: true, cancelledMessages: cancelled } });
}

/** Deletes several leads at once (Leads list → select → Delete). */
export const deleteLeads = defineService({
  name: "leads.deleteMany",
  input: leadIdsInput,
  permission: "leads.delete",
  handler: async (ctx, input, tx) => {
    const rows = await liveLeads(tx, ctx.orgId, input.leadIds);
    for (const { id } of rows) await deleteLeadInternal(tx, ctx, id, "manual");
    return { count: rows.length };
  },
});

/**
 * Job `leads.cleanup`: leads replied more than the company's number of days ago (Settings → Organisation, default 7)
 * leave the list. Only leads that are still replied: nothing waits or failed in the Outbox, and the buyer has not
 * written since. They stay in the database (hidden), so the same enquiry is never imported twice, reports stay
 * right, and a new message from the buyer brings the lead back.
 */
export async function cleanupRepliedLeads(ctx: Ctx, opts: { now?: Date; limit?: number } = {}, tx?: Tx) {
  const run = async (t: Tx) => {
    const settings = await getOrgSettingsInternal(t, ctx.orgId);
    const days = settings.removeRepliedAfterDays;
    if (!days || days <= 0) return { removed: 0, skipped: "Keeping replied leads (Settings → Organisation)" };
    const before = new Date((opts.now ?? new Date()).getTime() - days * 86400_000);
    const due = await t.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.orgId, ctx.orgId), isNull(leads.deletedAt), REPLIED, lte(leads.repliedAt, before)))
      .limit(opts.limit ?? 200);
    for (const { id } of due) await deleteLeadInternal(t, ctx, id, "replied");
    return { removed: due.length };
  };
  return tx ? run(tx) : withSystemTx(run);
}

/** Leads not replied yet (dashboard), India only: international leads have their own view. */
export async function countNotRepliedInternal(tx: Tx, orgId: string) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), eq(leads.isInternational, false), not(REPLIED)));
  return r?.n ?? 0;
}

/** The Leads menu badge: leads not replied yet. */
export const getNotRepliedCount = defineService({
  name: "leads.notRepliedCount",
  input: z.object({}).default({}),
  permission: "leads.read",
  handler: (ctx, _i, tx) => countNotRepliedInternal(tx, ctx.orgId),
});

// ---------- queries ----------

function listWhere(orgId: string, input: z.output<typeof listLeadsInput>): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(leads.orgId, orgId), isNull(leads.deletedAt)];
  if (input.status) conds.push(eq(leads.status, input.status));
  if (input.statuses?.length) conds.push(inArray(leads.status, input.statuses));
  if (input.source) conds.push(eq(leads.source, input.source));
  if (input.productId) conds.push(eq(leads.productId, input.productId));
  if (input.intent) conds.push(eq(leads.intent, input.intent));
  if (input.minScore !== undefined) conds.push(gte(leads.score, input.minScore));
  if (input.replied === "yes") conds.push(REPLIED);
  if (input.replied === "no") conds.push(not(REPLIED));
  if (input.needsDetails) {
    conds.push(isNotNull(leads.understoodAt), or(isNull(leads.productId), isNull(leads.intent)), notInArray(leads.status, ["won", "lost", "not_relevant"]));
  }
  if (input.international === "exclude") conds.push(eq(leads.isInternational, false));
  if (input.international === "only") conds.push(eq(leads.isInternational, true));
  if (input.from) conds.push(gte(leads.receivedAt, new Date(input.from)));
  if (input.to) conds.push(lte(leads.receivedAt, new Date(input.to)));
  if (input.q) {
    const like = `%${input.q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    // Phones are stored as E.164 (+919876543210); "98765 43210" or "098765-43210" should still match.
    const digits = input.q.replace(/\D/g, "").replace(/^0+/, "");
    conds.push(or(
      ilike(leads.contactName, like), ilike(leads.companyName, like), ilike(leads.phone, like), ilike(leads.email, like),
      ilike(leads.productText, like), ilike(leads.city, like), ilike(leads.state, like),
      digits.length >= 5 ? ilike(leads.phone, `%${digits}%`) : undefined,
    ));
  }
  return and(...conds);
}

export const listLeads = defineService({
  name: "leads.list",
  input: listLeadsInput,
  permission: "leads.read",
  handler: async (ctx, input, tx) => {
    const where = listWhere(ctx.orgId, input);
    const [{ total } = { total: 0 }] = await tx.select({ total: sql<number>`count(*)::int` }).from(leads).where(where);
    const items = await tx
      .select()
      .from(leads)
      .where(where)
      .orderBy(...(input.sort === "score" ? [desc(leads.score), desc(leads.receivedAt)] : [desc(leads.receivedAt)]))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    const moq = await moqByProductInternal(tx, ctx.orgId, [...new Set(items.map((l) => l.productId).filter((id): id is string => !!id))]);
    return { items: items.map((l) => withMoq(l, moq)), total, page: input.page, pageSize: input.pageSize };
  },
});

/** Adds the product's MOQ and the below-MOQ flag (G-UND-4); both null when unknown. */
function withMoq(l: Lead, moq: Map<string, number>) {
  const moqKg = l.productId ? moq.get(l.productId) ?? null : null;
  return { ...l, moqKg, belowMoq: belowMoq(l.quantityKg, moqKg) };
}

export async function getLeadInternal(tx: Tx, orgId: string, id: string) {
  const [l] = await tx.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, id), isNull(leads.deletedAt)));
  return l ?? null;
}

export const getLead = defineService({
  name: "leads.get",
  input: z.object({ leadId: z.string().uuid() }),
  permission: "leads.read",
  handler: async (ctx, input, tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    const notes = await tx.select().from(leadNotes).where(and(eq(leadNotes.leadId, lead.id), eq(leadNotes.orgId, ctx.orgId), isNull(leadNotes.deletedAt))).orderBy(desc(leadNotes.createdAt));
    const statusChanges = await tx.select().from(leadStatusChanges).where(and(eq(leadStatusChanges.leadId, lead.id), eq(leadStatusChanges.orgId, ctx.orgId))).orderBy(desc(leadStatusChanges.createdAt));
    const moq = await moqByProductInternal(tx, ctx.orgId, lead.productId ? [lead.productId] : []);
    return { lead: withMoq(lead, moq), notes, statusChanges };
  },
});

export const updateLeadStatus = defineService({
  name: "leads.updateStatus",
  input: z.object({ leadId: z.string().uuid(), status: z.enum(LEAD_STATUSES), reason: z.string().trim().max(500).optional() }),
  permission: "leads.update_status",
  handler: async (ctx, input, tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    if (lead.status === input.status) return { lead, changed: false };
    const [updated] = await tx.update(leads).set({ status: input.status, lastActivityAt: new Date() }).where(and(eq(leads.id, lead.id), eq(leads.orgId, ctx.orgId))).returning();
    await tx.insert(leadStatusChanges).values({ orgId: ctx.orgId, leadId: lead.id, fromStatus: lead.status, toStatus: input.status, reason: input.reason ?? null, createdBy: actorString(ctx.actor) });
    await audit(tx, ctx, { action: "lead.status", entityType: "lead", entityId: lead.id, changes: { status: [lead.status, input.status], reason: input.reason ?? null } });
    await emit(tx, ctx, { type: "lead.status_changed", entityType: "lead", entityId: lead.id, payload: { from: lead.status, to: input.status } });
    return { lead: updated!, changed: true };
  },
});

/** Internal: move a lead forward when a quote is drafted (never moves backwards). */
export async function markQuotedInternal(tx: Tx, ctx: Ctx, leadId: string) {
  const lead = await getLeadInternal(tx, ctx.orgId, leadId);
  if (!lead || !["new", "contacted"].includes(lead.status)) return;
  await tx.update(leads).set({ status: "quoted", lastActivityAt: new Date() }).where(eq(leads.id, leadId));
  await tx.insert(leadStatusChanges).values({ orgId: ctx.orgId, leadId, fromStatus: lead.status, toStatus: "quoted", reason: "Quotation draft created", createdBy: actorString(ctx.actor) });
  await audit(tx, ctx, { action: "lead.status", entityType: "lead", entityId: leadId, changes: { status: [lead.status, "quoted"] } });
  await emit(tx, ctx, { type: "lead.status_changed", entityType: "lead", entityId: leadId, payload: { from: lead.status, to: "quoted" } });
}

export const addLeadNote = defineService({
  name: "leads.addNote",
  input: z.object({ leadId: z.string().uuid(), body: z.string().trim().min(1).max(4000) }),
  permission: "notes.write",
  handler: async (ctx, input, tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    const [note] = await tx.insert(leadNotes).values({ orgId: ctx.orgId, leadId: lead.id, body: input.body, createdBy: actorString(ctx.actor) }).returning();
    await tx.update(leads).set({ lastActivityAt: new Date() }).where(eq(leads.id, lead.id));
    await audit(tx, ctx, { action: "lead.note", entityType: "lead", entityId: lead.id, changes: { noteId: note!.id } });
    await emit(tx, ctx, { type: "lead.note_added", entityType: "lead", entityId: lead.id, payload: { noteId: note!.id } });
    return note!;
  },
});

/**
 * Removes a note from a lead (a typo, the wrong lead). Its author may remove it, and so may anyone who may delete
 * leads. The text stays in the audit trail.
 */
export const removeLeadNote = defineService({
  name: "leads.removeNote",
  input: z.object({ noteId: z.string().uuid() }),
  permission: "notes.write",
  handler: async (ctx, input, tx) => {
    const [note] = await tx.select().from(leadNotes).where(and(eq(leadNotes.id, input.noteId), eq(leadNotes.orgId, ctx.orgId), isNull(leadNotes.deletedAt)));
    if (!note) throw notFound("Note");
    if (note.createdBy !== actorString(ctx.actor) && !can(ctx, "leads.delete")) throw forbidden("Only the person who wrote a note, or someone who may delete leads, can remove it.");
    await tx.update(leadNotes).set({ deletedAt: new Date() }).where(eq(leadNotes.id, note.id));
    await audit(tx, ctx, { action: "lead.note_remove", entityType: "lead", entityId: note.leadId, changes: { noteId: note.id, body: note.body, writtenBy: note.createdBy } });
    return { ok: true, leadId: note.leadId };
  },
});

const editableFields = z.object({
  contactName: z.string().trim().max(120).nullish(),
  companyName: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(80).nullish(),
  state: z.string().trim().max(80).nullish(),
  country: z.string().trim().max(80).nullish(),
  productText: z.string().trim().max(300).nullish(),
  productId: z.string().uuid().nullish(),
  quantityText: z.string().trim().max(100).nullish(),
  intent: z.enum(LEAD_INTENTS).nullish(),
  /** Total kg, when a person knows it better than the text says ("4 drums" of a known size). */
  quantityKg: z.number().positive().max(10_000_000).nullish(),
  isInternational: z.boolean().optional(),
});

export const updateLead = defineService({
  name: "leads.update",
  input: z.object({ leadId: z.string().uuid(), fields: editableFields }),
  permission: "leads.edit",
  handler: async (ctx, input, tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    const f = input.fields;
    if (f.productId && !(await productNameById(tx, ctx.orgId, f.productId))) throw notFound("Product");
    const patch: Partial<typeof leads.$inferInsert> = { ...f } as Partial<typeof leads.$inferInsert>;
    if (f.phone !== undefined) {
      const p = f.phone ? toE164(f.phone) : null;
      if (f.phone && !p) throw new AppError("VALIDATION", "That phone number doesn't look valid", { fieldErrors: { phone: ["Invalid phone number"] } });
      patch.phone = p;
    }
    if (f.email !== undefined) {
      const e = f.email ? normalizeEmail(f.email) : null;
      if (f.email && !e) throw new AppError("VALIDATION", "That email doesn't look valid", { fieldErrors: { email: ["Invalid email"] } });
      patch.email = e;
    }
    // Kg follows the quantity text only when the text changed, so saving another field keeps a kg value
    // that AI or a person filled; a kg value typed in wins over both.
    if (f.quantityKg !== undefined) patch.quantityKg = f.quantityKg === null ? null : String(f.quantityKg);
    else if (f.quantityText !== undefined && (f.quantityText || null) !== (lead.quantityText || null)) patch.quantityKg = quantityToKg(f.quantityText);
    else delete patch.quantityKg;
    // A person's value is the answer: record who set it, and count it against the AI if the AI set it before.
    const by = actorString(ctx.actor);
    const filledBy: LeadFilledBy = { ...lead.filledBy };
    const touched: [keyof LeadFilledBy, "lead.product" | "lead.intent" | "lead.quantity", unknown, unknown][] = [
      ["product", "lead.product", lead.productId, patch.productId],
      ["intent", "lead.intent", lead.intent, patch.intent],
      ["quantity", "lead.quantity", lead.quantityKg === null ? null : Number(lead.quantityKg), patch.quantityKg === undefined ? undefined : patch.quantityKg === null ? null : Number(patch.quantityKg)],
    ];
    for (const [key, task, before, after] of touched) {
      if (after === undefined || JSON.stringify(before) === JSON.stringify(after)) continue;
      if (after === null) delete filledBy[key];
      else filledBy[key] = by;
      await markAiCorrectedInternal(tx, ctx, { entityType: "lead", entityId: lead.id, task, correctedValue: after });
    }
    patch.filledBy = filledBy;
    const [updated] = await tx.update(leads).set(patch).where(and(eq(leads.id, lead.id), eq(leads.orgId, ctx.orgId))).returning();
    const changes: Record<string, unknown> = {};
    for (const k of Object.keys(patch) as (keyof Lead)[]) if (k !== "filledBy" && JSON.stringify(lead[k]) !== JSON.stringify(updated![k])) changes[k] = [lead[k], updated![k]];
    await audit(tx, ctx, { action: "lead.update", entityType: "lead", entityId: lead.id, changes });
    await emit(tx, ctx, { type: "lead.updated", entityType: "lead", entityId: lead.id, payload: { fields: Object.keys(changes) } });
    return (await rescoreLeadInternal(tx, ctx.orgId, lead.id)) ?? updated!;
  },
});

export const createManualLead = defineService({
  name: "leads.createManual",
  input: z.object({
    contactName: z.string().trim().min(1).max(120),
    companyName: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().optional().or(z.literal("")),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    country: z.string().trim().max(80).optional(),
    productText: z.string().trim().max(300).optional(),
    quantityText: z.string().trim().max(100).optional(),
    message: z.string().trim().max(4000).optional(),
  }),
  permission: "leads.create",
  handler: async (ctx, input, tx) => {
    if (input.phone && !toE164(input.phone)) throw new AppError("VALIDATION", "That phone number doesn't look valid", { fieldErrors: { phone: ["Invalid phone number"] } });
    return upsertLeadInternal(tx, ctx, { ...input, email: input.email || null, source: "manual", sourceRef: `manual:${crypto.randomUUID()}`, channel: "manual", receivedAt: new Date() });
  },
});

export const deleteLead = defineService({
  name: "leads.delete",
  input: z.object({ leadId: z.string().uuid() }),
  permission: "leads.delete",
  handler: async (ctx, input, tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    await deleteLeadInternal(tx, ctx, lead.id, "manual");
    return { ok: true };
  },
});

/** For MCP: compact list of leads that need a human/AI action (new first, then stale open leads). */
export const listLeadsNeedingAction = defineService({
  name: "leads.needingAction",
  input: z.object({ limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d+$/).optional() }),
  permission: "leads.read",
  handler: async (ctx, input, tx) => {
    const offset = Number(input.cursor ?? 0);
    const staleBefore = new Date(Date.now() - 2 * 86400_000);
    const where = and(
      eq(leads.orgId, ctx.orgId), isNull(leads.deletedAt), eq(leads.isInternational, false),
      or(eq(leads.status, "new"), and(inArray(leads.status, ["contacted", "quoted", "negotiating"]), lte(leads.lastActivityAt, staleBefore))),
    );
    const rows = await tx.select().from(leads).where(where)
      .orderBy(sql`case when ${leads.status} = 'new' then 0 else 1 end`, desc(leads.receivedAt))
      .limit(input.limit + 1).offset(offset);
    const more = rows.length > input.limit;
    return { items: rows.slice(0, input.limit), nextCursor: more ? String(offset + input.limit) : null };
  },
});

export async function leadStatsInternal(tx: Tx, orgId: string, since: Date) {
  const bySource = await tx
    .select({ source: leads.source, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), gte(leads.receivedAt, since)))
    .groupBy(leads.source);
  const needing = await countNotRepliedInternal(tx, orgId);
  const [{ intl = 0 } = {}] = await tx
    .select({ intl: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), eq(leads.isInternational, true), ne(leads.status, "not_relevant")));
  return { bySource, needingAction: needing, international: intl };
}

/** Not deleted, or (with `includeAutoRemoved`) removed automatically after a reply: a buyer message brings those back. */
const visibleOr = (includeAutoRemoved?: boolean) => (includeAutoRemoved ? or(isNull(leads.deletedAt), eq(leads.deletedReason, "replied")) : isNull(leads.deletedAt));

export async function findLeadByThreadInternal(tx: Tx, orgId: string, threadId: string, opts: { includeAutoRemoved?: boolean } = {}) {
  const [l] = await tx.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.gmailThreadId, threadId), visibleOr(opts.includeAutoRemoved)))
    .orderBy(sql`${leads.deletedAt} is not null`, desc(leads.receivedAt)).limit(1);
  return l ?? null;
}

export async function findRecentLeadByContactInternal(tx: Tx, orgId: string, c: { phone?: string | null; email?: string | null }, source?: NormalizedLead["source"], opts: { includeAutoRemoved?: boolean } = {}) {
  const phone = toE164(c.phone);
  const email = cleanEmail(c.email);
  if (!phone && !email) return null;
  const [l] = await tx.select().from(leads)
    .where(and(eq(leads.orgId, orgId), visibleOr(opts.includeAutoRemoved), source ? eq(leads.source, source) : undefined,
      or(phone ? eq(leads.phone, phone) : undefined, email ? eq(leads.email, email) : undefined)))
    .orderBy(desc(leads.receivedAt)).limit(1);
  return l ?? null;
}

export async function touchLeadInternal(tx: Tx, orgId: string, leadId: string, patch: Partial<Pick<Lead, "gmailThreadId" | "gmailMessageId">> = {}) {
  await tx.update(leads).set({ lastActivityAt: new Date(), ...patch }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
}


export type PortalRoutes = { portal: "indiamart" | "tradeindia"; total: number; api: number; email: number; onlyApi: number; onlyEmail: number };

/**
 * GOAL G-SRC-7: how today's portal leads arrived, by API and by notification email. A lead that came both
 * ways is one record (merged), and every route it came by is in `channel` plus `alternate_refs`.
 * `onlyEmail` > 0 with the API connected means the API missed leads; `onlyApi` means emails did not arrive.
 */
export async function arrivalRoutesInternal(tx: Tx, orgId: string, since: Date): Promise<PortalRoutes[]> {
  const rows = await tx.select({ source: leads.source, channel: leads.channel, alternateRefs: leads.alternateRefs }).from(leads)
    .where(and(eq(leads.orgId, orgId), inArray(leads.source, ["indiamart", "tradeindia"]), gte(leads.receivedAt, since), isNull(leads.deletedAt)));
  return (["indiamart", "tradeindia"] as const).map((portal) => {
    const out: PortalRoutes = { portal, total: 0, api: 0, email: 0, onlyApi: 0, onlyEmail: 0 };
    for (const r of rows.filter((x) => x.source === portal)) {
      const routes = [r.channel ?? "", ...r.alternateRefs.map((a) => a.source)].filter(Boolean);
      const api = routes.some((c) => c.startsWith(`${portal}_api`));
      const email = routes.some((c) => !c.startsWith(`${portal}_api`) && c !== "manual");
      out.total++;
      if (api) out.api++;
      if (email) out.email++;
      if (api && !email) out.onlyApi++;
      if (email && !api) out.onlyEmail++;
    }
    return out;
  });
}

/** Buy Leads bought today, whichever way they arrived (notification email or the IndiaMART API). */
export async function countBoughtBuyLeadsSinceInternal(tx: Tx, orgId: string, since: Date) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(leads)
    .where(and(eq(leads.orgId, orgId), inArray(leads.channel, ["indiamart_buylead", "indiamart_api_b"]), gte(leads.receivedAt, since), isNull(leads.deletedAt)));
  return r?.n ?? 0;
}


// ---------- understanding: rules → AI → review (GOAL G-AI-6, src/modules/ai) ----------

/** Leads the AI job has not finished with, oldest first, received in the last `days` days. */
export async function leadsAwaitingUnderstandingInternal(tx: Tx, orgId: string, opts: { limit: number; days: number }) {
  const since = new Date(Date.now() - opts.days * 86400_000);
  return tx.select().from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), isNull(leads.understoodAt), gte(leads.receivedAt, since)))
    .orderBy(asc(leads.receivedAt)).limit(opts.limit);
}

export async function countLeadsAwaitingUnderstandingInternal(tx: Tx, orgId: string, days: number): Promise<number> {
  const since = new Date(Date.now() - days * 86400_000);
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), isNull(leads.understoodAt), gte(leads.receivedAt, since)));
  return r?.n ?? 0;
}

/**
 * Writes what rules or AI found, only into fields that are still empty: a person's edit made while the
 * model was thinking always wins. `by` is `rule:<name>`, `ai:basic`, `ai:advanced` or `mcp:<token>`.
 * Returns the fields actually written.
 */
export async function fillLeadDetailsInternal(tx: Tx, ctx: Ctx, leadId: string, found: { productId?: string; intent?: LeadIntent; quantityKg?: number }, by: string | { product?: string; intent?: string; quantity?: string }) {
  const lead = await getLeadInternal(tx, ctx.orgId, leadId);
  if (!lead) return [];
  const who = (k: keyof LeadFilledBy) => (typeof by === "string" ? by : by[k] ?? actorString(ctx.actor));
  const patch: Partial<typeof leads.$inferInsert> = {};
  const filledBy: LeadFilledBy = { ...lead.filledBy };
  const written: ("product" | "intent" | "quantity")[] = [];
  if (found.productId && !lead.productId && (await productNameById(tx, ctx.orgId, found.productId))) {
    patch.productId = found.productId; filledBy.product = who("product"); written.push("product");
  }
  if (found.intent && !lead.intent) { patch.intent = found.intent; filledBy.intent = who("intent"); written.push("intent"); }
  if (found.quantityKg && !lead.quantityKg) { patch.quantityKg = String(Math.round(found.quantityKg * 1000) / 1000); filledBy.quantity = who("quantity"); written.push("quantity"); }
  if (!written.length) return [];
  await tx.update(leads).set({ ...patch, filledBy }).where(and(eq(leads.id, lead.id), eq(leads.orgId, ctx.orgId)));
  await rescoreLeadInternal(tx, ctx.orgId, lead.id);
  await audit(tx, ctx, { action: "lead.understood", entityType: "lead", entityId: lead.id, changes: { ...Object.fromEntries(written.map((k) => [k, filledBy[k]])), productId: patch.productId, intent: patch.intent, quantityKg: patch.quantityKg } });
  await emit(tx, ctx, { type: "lead.updated", entityType: "lead", entityId: lead.id, payload: { fields: written, by: written.map((k) => filledBy[k]) } });
  return written;
}

/** Open leads in the review queue (no product or no intent after rules and AI), for the dashboard. */
export async function countLeadsNeedingDetailsInternal(tx: Tx, orgId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(leads)
    .where(listWhere(orgId, { needsDetails: true, international: "exclude", sort: "newest", page: 1, pageSize: 1 }));
  return r?.n ?? 0;
}

/** The AI job is done with this lead: anything still empty is now in the review queue (`needsDetails`). */
export async function markLeadUnderstoodInternal(tx: Tx, orgId: string, leadId: string) {
  await tx.update(leads).set({ understoodAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId), isNull(leads.understoodAt)));
}

/** For the Claude connector: leads whose product or intent rules and AI could not settle. */
export const listLeadsNeedingDetails = defineService({
  name: "leads.needingDetails",
  input: z.object({ limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d+$/).optional() }),
  permission: "leads.read",
  handler: async (ctx, input, tx) => {
    const offset = Number(input.cursor ?? 0);
    const where = listWhere(ctx.orgId, { needsDetails: true, international: "all", sort: "newest", page: 1, pageSize: 1 });
    const rows = await tx.select().from(leads).where(where).orderBy(desc(leads.receivedAt)).limit(input.limit + 1).offset(offset);
    const more = rows.length > input.limit;
    return { items: rows.slice(0, input.limit), nextCursor: more ? String(offset + input.limit) : null };
  },
});

/**
 * The Claude connector answers the review queue (G-AI-6, G-AI-10): it may fill an empty product, intent or
 * quantity, never overwrite one. Low confidence changes nothing and leaves a note for a person.
 */
export const submitLeadDetails = defineService({
  name: "leads.submitDetails",
  input: z.object({
    leadId: z.string().uuid(),
    productId: z.string().uuid().optional(),
    intent: z.enum(LEAD_INTENTS).optional(),
    quantityKg: z.number().positive().max(10_000_000).optional(),
    confidence: z.enum(["high", "medium", "low"]),
    reason: z.string().trim().min(1).max(500),
  }),
  permission: "leads.edit",
  handler: async (ctx, input, tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    if (input.productId && !(await productNameById(tx, ctx.orgId, input.productId))) throw notFound("Product");
    if (input.confidence === "low") {
      const [note] = await tx.insert(leadNotes).values({ orgId: ctx.orgId, leadId: lead.id, createdBy: actorString(ctx.actor), body: `Suggestion (low confidence, not applied): ${input.reason}` }).returning();
      await audit(tx, ctx, { action: "lead.suggest", entityType: "lead", entityId: lead.id, changes: { noteId: note!.id, productId: input.productId, intent: input.intent, quantityKg: input.quantityKg } });
      return { status: "kept_for_review" as const, written: [] };
    }
    const written = await fillLeadDetailsInternal(tx, ctx, lead.id, { productId: input.productId, intent: input.intent, quantityKg: input.quantityKg }, actorString(ctx.actor));
    return { status: written.length ? ("filled" as const) : ("nothing_to_fill" as const), written };
  },
});

// ---------- lead score (GOAL G-UND-6) ----------

/**
 * Recomputes one lead's score from its current fields and the product's MOQ. The score is derived data:
 * it is written together with the change that caused it (whose audit row covers it). Returns the lead.
 */
export async function rescoreLeadInternal(tx: Tx, orgId: string, leadId: string): Promise<Lead | null> {
  const lead = await getLeadInternal(tx, orgId, leadId);
  if (!lead) return null;
  const moq = lead.productId ? (await moqByProductInternal(tx, orgId, [lead.productId])).get(lead.productId) ?? null : null;
  const s = scoreLead(lead, moq);
  const [row] = await tx.update(leads).set({ score: s.score, scoreReasons: s.reasons, scoredAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId))).returning();
  return row ?? null;
}

/**
 * Job `leads.rescore` (daily): refreshes the scores of open leads from the last 180 days that were not
 * scored today, so a changed MOQ shows up. 300 leads per run; `{ more: true }` continues on the next tick.
 */
export async function rescoreLeadsInternal(tx: Tx, ctx: Ctx, now = new Date()) {
  const startOfDay = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now)}T00:00:00+05:30`);
  const rows = await tx.select({ id: leads.id }).from(leads).where(and(
    eq(leads.orgId, ctx.orgId), isNull(leads.deletedAt), inArray(leads.status, ["new", "contacted", "quoted", "negotiating"]),
    gte(leads.receivedAt, new Date(now.getTime() - 180 * 86400_000)),
    or(isNull(leads.scoredAt), lte(leads.scoredAt, startOfDay)),
  )).limit(301);
  for (const r of rows.slice(0, 300)) await rescoreLeadInternal(tx, ctx.orgId, r.id);
  if (rows.length) await audit(tx, ctx, { action: "leads.rescore", entityType: "lead", changes: { count: Math.min(rows.length, 300) } });
  return { rescored: Math.min(rows.length, 300), more: rows.length > 300 };
}


// ---------- outbound pipeline (src/modules/outbound) ----------

/** New leads the pipeline has not planned yet: understood, still new, received in the last `hours`. */
export async function leadsToPlanInternal(tx: Tx, orgId: string, opts: { hours: number; limit: number }) {
  return tx.select().from(leads).where(and(
    eq(leads.orgId, orgId), isNull(leads.deletedAt), eq(leads.status, "new"), isNotNull(leads.understoodAt), isNull(leads.outreachPlannedAt),
    gte(leads.receivedAt, new Date(Date.now() - opts.hours * 3600_000)),
  )).orderBy(asc(leads.receivedAt)).limit(opts.limit);
}

export async function markLeadPlannedInternal(tx: Tx, orgId: string, leadId: string) {
  await tx.update(leads).set({ outreachPlannedAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
}

/** The buyer behind this lead already bought (another of their leads is won): G-OUT-2 "existing customer". */
export async function isExistingCustomerInternal(tx: Tx, orgId: string, lead: Pick<Lead, "id" | "contactId">): Promise<boolean> {
  if (!lead.contactId) return false;
  const [r] = await tx.select({ id: leads.id }).from(leads).where(and(
    eq(leads.orgId, orgId), eq(leads.contactId, lead.contactId), ne(leads.id, lead.id), eq(leads.status, "won"), isNull(leads.deletedAt),
  )).limit(1);
  return !!r;
}

/** This buyer's leads (same contact), optionally for one product: "already received this quotation" check. */
export async function leadIdsOfContactInternal(tx: Tx, orgId: string, contactId: string | null, productId?: string | null): Promise<string[]> {
  if (!contactId) return [];
  const rows = await tx.select({ id: leads.id }).from(leads).where(and(
    eq(leads.orgId, orgId), eq(leads.contactId, contactId), productId ? eq(leads.productId, productId) : undefined,
  ));
  return rows.map((r) => r.id);
}

// ---------- reports (GOAL G-RPT-1) ----------

/** Leads received since a time, and how many have a catalogue product. */
export async function leadFunnelInternal(tx: Tx, orgId: string, since: Date) {
  const [r] = await tx.select({
    received: sql<number>`count(*)::int`,
    matched: sql<number>`count(*) filter (where ${leads.productId} is not null)::int`,
  }).from(leads).where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), gte(leads.receivedAt, since)));
  return { received: r?.received ?? 0, matched: r?.matched ?? 0 };
}

/** When each of these leads arrived (time to first reply). */
export async function receivedAtByIdsInternal(tx: Tx, orgId: string, ids: string[]): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const rows = await tx.select({ id: leads.id, at: leads.receivedAt }).from(leads).where(and(eq(leads.orgId, orgId), inArray(leads.id, ids)));
  return new Map(rows.map((r) => [r.id, r.at]));
}
