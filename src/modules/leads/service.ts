import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { notFound, AppError } from "@/lib/errors";
import { normalizeEmail, phoneCountry, toE164 } from "@/lib/phone";
import { audit, emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { resolveContactInternal, cleanEmail } from "@/modules/contacts/service";
import { matchProduct, productMatcherCatalog } from "@/modules/catalog/service";
import { leadNotes, leads, leadStatusChanges } from "./schema";
import { LEAD_STATUSES, listLeadsInput, type NormalizedLead } from "./types";

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

/** "25 Kg", "1 Ton", "500kg" → kilograms (best effort). */
export function quantityToKg(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilogram|kilograms|ton|tons|tonne|tonnes|mt|metric ton|g|gm|gram|grams)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const kg = /^(ton|tons|tonne|tonnes|mt|metric ton)$/.test(unit) ? n * 1000 : /^(g|gm|gram|grams)$/.test(unit) ? n / 1000 : n;
  return String(Math.round(kg * 1000) / 1000);
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
        // Upgrade the email-only lead to the real inquiry id; keep the gmail ref as an alternate.
        await tx.update(leads).set({
          sourceRef: input.sourceRef,
          alternateRefs: [...dup.alternateRefs, { source: dup.channel ?? "email", ref: dup.sourceRef, method: "contact_time_window" }],
        }).where(eq(leads.id, dup.id));
        await audit(tx, ctx, { action: "lead.ref_upgraded", entityType: "lead", entityId: dup.id, changes: { sourceRef: [dup.sourceRef, input.sourceRef] } });
        await fillMissing(tx, ctx, { ...dup, sourceRef: input.sourceRef }, { ...input, phone, email }, null);
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
      quantityKg: quantityToKg(input.quantityText),
      message: input.message?.slice(0, 5000) ?? null,
      rawPayload: input.rawPayload ?? null,
      receivedAt: input.receivedAt,
      lastActivityAt: input.receivedAt,
      gmailThreadId: input.gmailThreadId ?? null,
      gmailMessageId: input.gmailMessageId ?? null,
      createdBy: actorString(ctx.actor),
    })
    .returning();
  await tx.insert(leadStatusChanges).values({ orgId: ctx.orgId, leadId: row!.id, fromStatus: null, toStatus: "new", createdBy: actorString(ctx.actor), reason: `Imported from ${input.channel}` });
  await audit(tx, ctx, { action: "lead.create", entityType: "lead", entityId: row!.id, changes: { source: input.source, sourceRef: input.sourceRef, channel: input.channel, international } });
  await emit(tx, ctx, { type: "lead.created", entityType: "lead", entityId: row!.id, payload: { source: input.source, channel: input.channel, international, productId: product?.id ?? null } });
  return { leadId: row!.id, created: true, duplicate: false, method: null };
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
  }
}

// ---------- queries ----------

function listWhere(orgId: string, input: z.output<typeof listLeadsInput>): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(leads.orgId, orgId), isNull(leads.deletedAt)];
  if (input.status) conds.push(eq(leads.status, input.status));
  if (input.statuses?.length) conds.push(inArray(leads.status, input.statuses));
  if (input.source) conds.push(eq(leads.source, input.source));
  if (input.productId) conds.push(eq(leads.productId, input.productId));
  if (input.international === "exclude") conds.push(eq(leads.isInternational, false));
  if (input.international === "only") conds.push(eq(leads.isInternational, true));
  if (input.from) conds.push(gte(leads.receivedAt, new Date(input.from)));
  if (input.to) conds.push(lte(leads.receivedAt, new Date(input.to)));
  if (input.q) {
    const like = `%${input.q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    conds.push(or(
      ilike(leads.contactName, like), ilike(leads.companyName, like), ilike(leads.phone, like), ilike(leads.email, like),
      ilike(leads.productText, like), ilike(leads.city, like), ilike(leads.state, like),
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
      .orderBy(desc(leads.receivedAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    return { items, total, page: input.page, pageSize: input.pageSize };
  },
});

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
    return { lead, notes, statusChanges };
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
    if (f.quantityText !== undefined) patch.quantityKg = quantityToKg(f.quantityText);
    const [updated] = await tx.update(leads).set(patch).where(and(eq(leads.id, lead.id), eq(leads.orgId, ctx.orgId))).returning();
    const changes: Record<string, unknown> = {};
    for (const k of Object.keys(patch) as (keyof Lead)[]) if (JSON.stringify(lead[k]) !== JSON.stringify(updated![k])) changes[k] = [lead[k], updated![k]];
    await audit(tx, ctx, { action: "lead.update", entityType: "lead", entityId: lead.id, changes });
    await emit(tx, ctx, { type: "lead.updated", entityType: "lead", entityId: lead.id, payload: { fields: Object.keys(changes) } });
    return updated!;
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
  handler: async (ctx, input, tx) =>
    upsertLeadInternal(tx, ctx, { ...input, email: input.email || null, source: "manual", sourceRef: `manual:${crypto.randomUUID()}`, channel: "manual", receivedAt: new Date() }),
});

export const deleteLead = defineService({
  name: "leads.delete",
  input: z.object({ leadId: z.string().uuid() }),
  permission: "leads.delete",
  handler: async (ctx, input, tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    await tx.update(leads).set({ deletedAt: new Date() }).where(eq(leads.id, lead.id));
    await audit(tx, ctx, { action: "lead.delete", entityType: "lead", entityId: lead.id, changes: { soft: true } });
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
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), gte(leads.createdAt, since)))
    .groupBy(leads.source);
  const [{ needing = 0 } = {}] = await tx
    .select({ needing: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), eq(leads.status, "new"), eq(leads.isInternational, false)));
  const [{ intl = 0 } = {}] = await tx
    .select({ intl: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), eq(leads.isInternational, true), ne(leads.status, "not_relevant")));
  return { bySource, needingAction: needing, international: intl };
}

export async function findLeadByThreadInternal(tx: Tx, orgId: string, threadId: string) {
  const [l] = await tx.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.gmailThreadId, threadId), isNull(leads.deletedAt))).limit(1);
  return l ?? null;
}

export async function findRecentLeadByContactInternal(tx: Tx, orgId: string, c: { phone?: string | null; email?: string | null }, source?: NormalizedLead["source"]) {
  const phone = toE164(c.phone);
  const email = cleanEmail(c.email);
  if (!phone && !email) return null;
  const [l] = await tx.select().from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt), source ? eq(leads.source, source) : undefined,
      or(phone ? eq(leads.phone, phone) : undefined, email ? eq(leads.email, email) : undefined)))
    .orderBy(desc(leads.receivedAt)).limit(1);
  return l ?? null;
}

export async function touchLeadInternal(tx: Tx, orgId: string, leadId: string, patch: Partial<Pick<Lead, "gmailThreadId" | "gmailMessageId">> = {}) {
  await tx.update(leads).set({ lastActivityAt: new Date(), ...patch }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
}

export async function countLeadsByChannelSinceInternal(tx: Tx, orgId: string, channel: string, since: Date) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(leads)
    .where(and(eq(leads.orgId, orgId), eq(leads.channel, channel), gte(leads.createdAt, since), isNull(leads.deletedAt)));
  return r?.n ?? 0;
}
