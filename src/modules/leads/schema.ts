import { boolean, index, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns, softDelete } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";
import { contacts } from "@/modules/contacts/schema";

export const leadSourceEnum = app.enum("lead_source", ["tradeindia", "indiamart", "gmail", "manual"]);
export const leadStatusEnum = app.enum("lead_status", [
  "new", "contacted", "quoted", "negotiating", "won", "lost", "not_relevant",
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
