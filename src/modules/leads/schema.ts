import { boolean, index, integer, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns, softDelete } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";
import { contacts } from "@/modules/contacts/schema";
import type { LeadFilledBy } from "./types";

export const leadSourceEnum = app.enum("lead_source", ["tradeindia", "indiamart", "gmail", "manual"]);
export const leadStatusEnum = app.enum("lead_status", [
  "new", "contacted", "quoted", "negotiating", "won", "lost", "not_relevant",
]);

export const leadIntentEnum = app.enum("lead_intent", [
  "new_enquiry", "document_request", "sample_request", "price_negotiation", "order", "complaint", "not_buyer", "other",
]);

export const leads = app.table("leads", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  contactId: uuid().references(() => contacts.id),
  source: leadSourceEnum().notNull(),
  /** Source-specific unique id: TradeIndia rfi_id, or gmail:<messageId> for email-only leads. */
  sourceRef: text().notNull(),
  /** How this lead was captured, e.g. tradeindia_api, tradeindia_email, indiamart_enquiry, indiamart_buylead, direct_email. */
  channel: text(),
  status: leadStatusEnum().notNull().default("new"),
  isInternational: boolean().notNull().default(false),
  contactName: text(),
  companyName: text(),
  phone: text(),
  email: text(),
  city: text(),
  state: text(),
  country: text(),
  productText: text(),
  /** Catalog product id if matched (catalog module owns products; stored as plain uuid). */
  productId: uuid(),
  quantityText: text(),
  quantityKg: numeric({ precision: 14, scale: 3 }),
  /** What the buyer wants (G-UND-3): rules, else AI, else empty for review. */
  intent: leadIntentEnum(),
  /** Who filled product, intent and quantity (alias, rule:…, ai:basic, ai:advanced, mcp:…, human:…). */
  filledBy: jsonb().$type<LeadFilledBy>().notNull().default({}),
  /** When rules and AI finished with this lead; null = still waiting for the AI job (src/modules/ai). */
  understoodAt: timestamp({ withTimezone: true }),
  /** Lead score 0–100 (G-UND-6) and the reasons behind it; recomputed whenever the lead changes. */
  score: integer().notNull().default(0),
  scoreReasons: jsonb().$type<{ points: number; reason: string }[]>().notNull().default([]),
  /** When the score was last computed; a nightly job refreshes older scores (MOQs change with rates). */
  scoredAt: timestamp({ withTimezone: true }),
  /** When the outbound pipeline decided what to send for this new lead (src/modules/outbound); null = not yet. */
  outreachPlannedAt: timestamp({ withTimezone: true }),
  /**
   * Replied or not (the Leads tabs). A lead is "replied" when `repliedAt` is set, nothing for it waits or failed in
   * the Outbox (`outboxPending`), and the buyer has not written since (`lastBuyerMessageAt`). `repliedAt` is set by a
   * sent message (email or WhatsApp), a reply a person sent from Gmail in the lead's thread, or "Mark as replied".
   */
  repliedAt: timestamp({ withTimezone: true }),
  /** The buyer's last message: the enquiry itself, or a reply in its thread. */
  lastBuyerMessageAt: timestamp({ withTimezone: true }),
  /** Something for this lead is prepared, held, waiting or failed in the Outbox (kept up to date by the outbound module). */
  outboxPending: boolean().notNull().default(false),
  /** Why the lead was deleted: "manual" (a person) or "replied" (removed automatically some days after the reply; a new buyer message brings it back). */
  deletedReason: text(),
  message: text(),
  rawPayload: jsonb().$type<unknown>(),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  gmailThreadId: text(),
  gmailMessageId: text(),
  /** Other refs for the same inquiry (e.g. the notification email that duplicated an API lead). */
  alternateRefs: jsonb().$type<{ source: string; ref: string; method: string }[]>().notNull().default([]),
  assignedTo: uuid(),
}, (t) => [
  uniqueIndex("leads_org_source_ref_uq").on(t.orgId, t.source, t.sourceRef),
  index("leads_org_status_idx").on(t.orgId, t.status, t.receivedAt),
  index("leads_org_received_idx").on(t.orgId, t.receivedAt),
  index("leads_org_phone_idx").on(t.orgId, t.phone),
  index("leads_org_email_idx").on(t.orgId, t.email),
  index("leads_org_thread_idx").on(t.orgId, t.gmailThreadId),
  index("leads_org_understood_idx").on(t.orgId, t.understoodAt),
  index("leads_org_score_idx").on(t.orgId, t.score, t.receivedAt),
  index("leads_org_replied_idx").on(t.orgId, t.repliedAt),
]);

export const leadNotes = app.table("lead_notes", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  leadId: uuid().notNull().references(() => leads.id),
  body: text().notNull(),
}, (t) => [index("lead_notes_lead_idx").on(t.leadId, t.createdAt)]);

export const leadStatusChanges = app.table("lead_status_changes", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  leadId: uuid().notNull().references(() => leads.id),
  fromStatus: leadStatusEnum(),
  toStatus: leadStatusEnum().notNull(),
  reason: text(),
}, (t) => [index("lead_status_changes_lead_idx").on(t.leadId, t.createdAt)]);
