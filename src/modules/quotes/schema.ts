import { date, index, jsonb, text, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

export type QuoteItemSnapshot = {
  productId: string;
  productName: string;
  gradeId: string;
  gradeName: string;
  priceEntryId: string;
  pricePerKgInr: string;
  gstPercent: string;
  gstInclusive: boolean;
  priceBasis: string;
  moqKg: string | null;
  packSize: string | null;
  needsConfirmation: boolean;
};

export const quoteStatusEnum = app.enum("quote_status", ["rendered", "draft_created", "draft_failed"]);

/** Every quotation keeps a snapshot of the exact prices quoted (brief §1: record what was quoted). */
export const quotations = app.table("quotations", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  leadId: uuid().notNull(),
  templateId: uuid(),
  status: quoteStatusEnum().notNull().default("rendered"),
  items: jsonb().$type<QuoteItemSnapshot[]>().notNull(),
  validityDate: date().notNull(),
  subject: text().notNull(),
  bodyText: text().notNull(),
  toEmail: text(),
  gmailDraftId: text(),
  gmailThreadId: text(),
  gmailDraftUrl: text(),
  error: text(),
}, (t) => [index("quotations_lead_idx").on(t.leadId, t.createdAt)]);
