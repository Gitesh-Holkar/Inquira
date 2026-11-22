import { boolean, index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns, softDelete } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

export type HoldReason = { rule: string; detail: string };

/**
 * Every message Inquira prepares for a buyer (GOAL G-OUT-1). Nothing is sent without passing through a row
 * here: draft → (held) → approved → sent, or failed / cancelled. A row records why it was held, which mode and
 * rule set decided, the template version, the rate entries and documents it used, and who approved and sent it.
 */
export const outgoingMessages = app.table("outgoing_messages", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  /** Plain uuids: the leads, templates, email and documents modules own those rows. Empty for the owner's daily summary. */
  leadId: uuid(),
  /** email | whatsapp */
  channel: text().notNull(),
  /** first_quotation | detailed_quotation | document_share | sample_request | below_moq | follow_up | international_ack | reply | daily_summary */
  purpose: text().notNull(),
  /** draft | held | approved | sent | failed | cancelled */
  state: text().notNull(),
  toAddress: text(),
  subject: text(),
  body: text().notNull(),
  templateId: uuid(),
  templateVersion: integer(),
  /** Rate book rows quoted (G-OUT-10). */
  priceEntryIds: uuid().array().notNull().default([]),
  /** Snapshot of quoted items, like a quotation. */
  items: jsonb().$type<unknown[]>().notNull().default([]),
  documentIds: uuid().array().notNull().default([]),
  holdReasons: jsonb().$type<HoldReason[]>().notNull().default([]),
  ruleSetVersion: text().notNull(),
  /** Mode of the channel when the message was decided. */
  mode: text().notNull(),
  /** Approved by the pipeline itself (the mode allowed it and no rule held it), not by a person. */
  autoApproved: boolean().notNull().default(false),
  /** The message it follows up or replies to. */
  replyToId: uuid(),
  gmailThreadId: text(),
  inReplyToMessageId: text(),
  gmailMessageId: text(),
  edited: boolean().notNull().default(false),
  approvedBy: text(),
  approvedAt: timestamp({ withTimezone: true }),
  sentBy: text(),
  sentAt: timestamp({ withTimezone: true }),
  cancelledReason: text(),
  error: text(),
  attempts: integer().notNull().default(0),
}, (t) => [
  index("outgoing_org_state_idx").on(t.orgId, t.state, t.createdAt),
  index("outgoing_org_lead_idx").on(t.orgId, t.leadId, t.createdAt),
  index("outgoing_org_sent_idx").on(t.orgId, t.sentAt),
]);

/**
 * Hold rules the team added from corrections (GOAL G-OUT-9: "a correction can become a rule"). Each one holds
 * every future message that matches it, on top of the built-in rules.
 */
export const outboundRules = app.table("outbound_rules", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  /** buyer_email | buyer_domain | buyer_phone | product | text_contains */
  matchType: text().notNull(),
  pattern: text().notNull(),
  /** Why the team made it; shown on every message it holds. */
  note: text(),
  enabled: boolean().notNull().default(true),
}, (t) => [index("outbound_rules_org_idx").on(t.orgId, t.enabled)]);
