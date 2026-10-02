import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { AppError, notFound, publicMessage } from "@/lib/errors";
import { addDays, formatAmount, formatDate, formatNumber, formatPercent, todayIST } from "@/lib/format";
import { whatsappUrl } from "@/lib/phone";
import { audit, emit } from "@/modules/core/audit";
import { authorize } from "@/modules/core/permissions";
import { defineService, parseInput, runTx } from "@/modules/core/service-kit";
import { getOrgSettingsInternal } from "@/modules/core/service";
import { actorString, type Ctx } from "@/modules/core/types";
import { currentRatesInternal, productNameById } from "@/modules/catalog/service";
import type { CurrentRate } from "@/modules/catalog/types";
import { getLeadInternal, markQuotedInternal, type Lead } from "@/modules/leads/service";
import { getDefaultTemplateInternal, getTemplateInternal } from "@/modules/templates/service";
import { DEFAULT_ITEM_BLOCK, render, type TemplateVars } from "@/modules/templates/engine";
import { getMessageMetaInternal } from "@/modules/email/service";
import { htmlToText } from "@/modules/email/parsers/text";
import { gmailClientFor } from "@/modules/sources/gmail/service";
import { gmailDraftUrl, gmailThreadUrl } from "@/modules/sources/gmail/client";
import { quotations, type QuoteItemSnapshot } from "./schema";
import { bodyToHtml, buildMime, formatAddress } from "./mime";

export type Quotation = typeof quotations.$inferSelect;

function greetingName(lead: Lead): string {
  const n = lead.contactName?.replace(/^(mr|mrs|ms|dr)\.?\s+/i, "").trim();
  if (!n || n.length < 2 || /^[A-Z]$/.test(n)) return "Sir/Madam";
  return n.split(/\s+/)[0]!.replace(/^./, (c) => c.toUpperCase());
}

function snapshot(r: CurrentRate): QuoteItemSnapshot {
  return {
    productId: r.productId, productName: r.productName, gradeId: r.gradeId, gradeName: r.gradeName, priceEntryId: r.priceEntryId!,
    pricePerKgInr: r.pricePerKgInr!, gstPercent: r.gstPercent!, gstInclusive: r.gstInclusive, priceBasis: r.priceBasis ?? "Ex-factory",
    moqKg: r.moqKg, packSize: r.packSize, needsConfirmation: r.needsConfirmation,
  };
}

function itemVars(i: QuoteItemSnapshot): TemplateVars {
  return {
    product: i.productName, grade: i.gradeName, price_per_kg: formatAmount(i.pricePerKgInr), price_basis: i.priceBasis,
    gst_percent: formatPercent(i.gstPercent), moq: i.moqKg ? formatNumber(i.moqKg) : "", pack_size: i.packSize ?? "",
  };
}

export function renderQuote(lead: Lead, items: QuoteItemSnapshot[], tpl: { subject: string | null; body: string }, validityDate: string, orgName: string) {
  const first = items[0]!;
  const blocks = items.map((it, idx) => {
    const b = render(DEFAULT_ITEM_BLOCK, itemVars(it));
    const noGrade = it.gradeName === "Standard" ? b.replace(` (${it.gradeName})`, "") : b;
    return items.length > 1 ? `${idx + 1}. ${noGrade}` : noGrade;
  });
  const vars: TemplateVars = {
    ...itemVars(first),
    product: [...new Set(items.map((i) => i.productName))].join(", "),
    contact_name: greetingName(lead), company_name: lead.companyName ?? "", city: lead.city ?? "",
    quantity: lead.quantityText ? ` (${lead.quantityText})` : "", validity_date: formatDate(validityDate),
    items_block: blocks.join("\n\n"), org_name: orgName,
  };
  return { subject: render(tpl.subject ?? "Quotation – {{product}}", vars), body: render(tpl.body, vars), vars };
}

async function pickItems(tx: Tx, ctx: Ctx, lead: Lead, gradeIds?: string[]) {
  const rates = await currentRatesInternal(tx, ctx.orgId, gradeIds?.length ? {} : lead.productId ? { productIds: [lead.productId] } : {});
  let chosen = gradeIds?.length ? rates.filter((r) => gradeIds.includes(r.gradeId)) : rates.filter((r) => r.productId === lead.productId);
  chosen = chosen.filter((r) => r.pricePerKgInr);
  if (!chosen.length) {
    if (!lead.productId && !gradeIds?.length) throw new AppError("VALIDATION", "Pick the product for this lead first (Edit → Product), then create the quote.");
    const name = lead.productId ? await productNameById(tx, ctx.orgId, lead.productId) : "the selected grade";
    throw new AppError("VALIDATION", `There is no current rate for ${name}. Add one on the Rates screen first.`);
  }
  return chosen.map(snapshot);
}

const createInput = z.object({
  leadId: z.string().uuid(),
  gradeIds: z.array(z.string().uuid()).max(10).optional(),
  templateId: z.string().uuid().optional(),
  validityDays: z.number().int().min(1).max(60).optional(),
});

/** Same function behind the UI button and the MCP tool. Creates a Gmail DRAFT only — never sends. */
export async function createQuoteDraft(ctx: Ctx, raw: z.input<typeof createInput>, deps: { fetchImpl?: typeof fetch } = {}) {
  const input = parseInput(createInput, raw);
  authorize(ctx, "quotes.create");

  const prep = await runTx(ctx, async (tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    if (lead.isInternational) throw new AppError("VALIDATION", "Quotation drafts are disabled for international leads (USD pricing is not supported yet).");
    const items = await pickItems(tx, ctx, lead, input.gradeIds);
    const settings = await getOrgSettingsInternal(tx, ctx.orgId);
    const validityDate = addDays(todayIST(), input.validityDays ?? settings.quoteValidityDays);
    const tpl = input.templateId ? await getTemplateInternal(tx, ctx.orgId, input.templateId) : await getDefaultTemplateInternal(tx, ctx.orgId, "quote_email");
    if (!tpl) throw new AppError("VALIDATION", "No quotation template found. Create one under Templates.");
    const rendered = renderQuote(lead, items, tpl, validityDate, settings.orgName);
    const original = lead.gmailMessageId ? await getMessageMetaInternal(tx, ctx.orgId, lead.gmailMessageId) : null;
    const [q] = await tx.insert(quotations).values({
      orgId: ctx.orgId, leadId: lead.id, templateId: tpl.id, status: "rendered", items, validityDate,
      subject: rendered.subject, bodyText: rendered.body, toEmail: lead.email, gmailThreadId: lead.gmailThreadId, createdBy: actorString(ctx.actor),
    }).returning();
    await audit(tx, ctx, { action: "quote.render", entityType: "quotation", entityId: q!.id, changes: { leadId: lead.id, items: items.map((i) => ({ grade: `${i.productName} / ${i.gradeName}`, price: i.pricePerKgInr, priceEntryId: i.priceEntryId })), validityDate } });
    return { lead, q: q!, rendered, original };
  });

  const { lead, q, rendered, original } = prep;
  try {
    const { client, integ } = await gmailClientFor(ctx, deps.fetchImpl);
    const sendAs = await client.listSendAs();
    const primary = sendAs.sendAs.find((s) => s.isDefault) ?? sendAs.sendAs.find((s) => s.isPrimary) ?? sendAs.sendAs[0];
    const signatureHtml = primary?.signature?.trim() || null; // real Gmail signature; never written in code
    const text = signatureHtml ? `${rendered.body}\n\n-- \n${htmlToText(signatureHtml)}` : rendered.body;
    const threadSubject = original?.subject ? (/^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`) : rendered.subject;
    const mime = buildMime({
      from: primary ? formatAddress(primary.sendAsEmail, primary.displayName) : null,
      to: lead.email, subject: lead.gmailThreadId ? threadSubject : rendered.subject, text, html: bodyToHtml(rendered.body, signatureHtml),
      inReplyTo: lead.gmailThreadId ? original?.rfcMessageId : null,
      references: lead.gmailThreadId && original?.rfcMessageId ? [original.references, original.rfcMessageId].filter(Boolean).join(" ") : null,
    });
    const draft = await client.createDraft(mime, lead.gmailThreadId);
    const url = lead.gmailThreadId ? gmailThreadUrl(integ.accountEmail, draft.message.threadId) : gmailDraftUrl(integ.accountEmail, draft.message.id);
    return await runTx(ctx, async (tx) => {
      const [updated] = await tx.update(quotations).set({ status: "draft_created", gmailDraftId: draft.id, gmailThreadId: draft.message.threadId, gmailDraftUrl: url, error: null })
        .where(eq(quotations.id, q.id)).returning();
      await markQuotedInternal(tx, ctx, lead.id);
      await audit(tx, ctx, { action: "quote.draft", entityType: "quotation", entityId: q.id, changes: { gmailDraftId: draft.id, threaded: !!lead.gmailThreadId, signature: !!signatureHtml } });
      await emit(tx, ctx, { type: "quote.drafted", entityType: "quotation", entityId: q.id, payload: { leadId: lead.id, threaded: !!lead.gmailThreadId } });
      return { quotation: updated!, draftUrl: url, warning: lead.email ? null : "The lead has no email address; add the recipient in Gmail before sending." };
    });
  } catch (e) {
    const msg = publicMessage(e).message === "Something went wrong. Please try again." ? `Gmail error: ${(e as Error).message}`.slice(0, 300) : publicMessage(e).message;
    return await runTx(ctx, async (tx) => {
      const [updated] = await tx.update(quotations).set({ status: "draft_failed", error: msg }).where(eq(quotations.id, q.id)).returning();
      await audit(tx, ctx, { action: "quote.draft_failed", entityType: "quotation", entityId: q.id, changes: { error: msg } });
      await emit(tx, ctx, { type: "quote.failed", entityType: "quotation", entityId: q.id, payload: { leadId: lead.id, error: msg } });
      return { quotation: updated!, draftUrl: null, warning: `Draft not created in Gmail: ${msg} The quotation text is saved; copy it from the lead page.` };
    });
  }
}

export const listQuotationsForLead = defineService({
  name: "quotes.forLead",
  input: z.object({ leadId: z.string().uuid() }),
  permission: "quotes.read",
  handler: (ctx, input, tx) =>
    tx.select().from(quotations).where(and(eq(quotations.orgId, ctx.orgId), eq(quotations.leadId, input.leadId))).orderBy(desc(quotations.createdAt)),
});

/** Pre-filled WhatsApp text for a lead (read-only; the user edits it before opening wa.me). */
export const whatsappForLead = defineService({
  name: "quotes.whatsapp",
  input: z.object({ leadId: z.string().uuid() }),
  permission: "leads.read",
  handler: async (ctx, input, tx) => {
    const lead = await getLeadInternal(tx, ctx.orgId, input.leadId);
    if (!lead) throw notFound("Lead");
    const tpl = await getDefaultTemplateInternal(tx, ctx.orgId, "whatsapp");
    const settings = await getOrgSettingsInternal(tx, ctx.orgId);
    const rates = lead.productId ? (await currentRatesInternal(tx, ctx.orgId, { productIds: [lead.productId] })).filter((r) => r.pricePerKgInr) : [];
    const first = rates[0];
    const vars: TemplateVars = {
      contact_name: greetingName(lead), company_name: lead.companyName ?? "", product: first?.productName ?? lead.productText ?? "your requirement",
      grade: first?.gradeName ?? "", price_per_kg: first ? formatAmount(first.pricePerKgInr) : "", price_basis: first?.priceBasis ?? "",
      gst_percent: first ? formatPercent(first.gstPercent) : "", moq: first?.moqKg ? formatNumber(first.moqKg) : "", pack_size: first?.packSize ?? "",
      validity_date: formatDate(addDays(todayIST(), settings.quoteValidityDays)), quantity: lead.quantityText ? ` (${lead.quantityText})` : "",
      city: lead.city ?? "", org_name: settings.orgName,
    };
    let text = render(tpl?.body ?? "Hello {{contact_name}}, thank you for your inquiry for {{product}}.", vars);
    if (!first) text = text.replace(/Our current rate is[^.]*\.[^.]*\.?/i, "").replace(/Valid until[^.]*\./i, "").replace(/\s{2,}/g, " ").trim();
    return { text, url: lead.phone ? whatsappUrl(lead.phone, text) : null, hasRate: !!first };
  },
});


