import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns, softDelete } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

export const emailClassEnum = app.enum("email_classification", [
  "pending", "inquiry", "conversation", "ignored", "international", "needs_review",
]);

export const emailMessages = app.table("email_messages", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  gmailMessageId: text().notNull(),
  gmailThreadId: text().notNull(),
  historyId: text(),
  rfcMessageId: text(),
  fromEmail: text(),
  fromName: text(),
  toEmails: text().array().notNull().default([]),
  ccEmails: text().array().notNull().default([]),
  subject: text(),
  snippet: text(),
  /** Trimmed plain text (HTML converted when no usable text part). Max ~20k chars. */
  bodyText: text(),
  /** Trimmed HTML kept only for portal notifications whose text part is broken. */
  bodyHtml: text(),
  labelIds: text().array().notNull().default([]),
  headers: jsonb().$type<Record<string, string>>().notNull().default({}),
  receivedAt: timestamp({ withTimezone: true }).notNull(),
  isOutgoing: boolean().notNull().default(false),
  classification: emailClassEnum().notNull().default("pending"),
  classificationReason: text(),
  /** rule:<id> | parser:<format> | mcp:<token> | human:<uuid> | system */
  classifiedBy: text(),
  classifiedAt: timestamp({ withTimezone: true }),
  parserFormat: text(),
  parsed: jsonb().$type<Record<string, unknown>>(),
  confidence: text(),
  leadId: uuid(),
}, (t) => [
  uniqueIndex("email_org_msg_uq").on(t.orgId, t.gmailMessageId),
  index("email_org_class_idx").on(t.orgId, t.classification, t.receivedAt),
  index("email_org_thread_idx").on(t.orgId, t.gmailThreadId),
  index("email_org_received_idx").on(t.orgId, t.receivedAt),
]);

export const ruleMatchEnum = app.enum("rule_match", [
  "sender_email", "sender_domain", "subject_contains", "body_contains",
]);
export const ruleActionEnum = app.enum("rule_action", [
  "ignore", "needs_review", "international", "inquiry",
]);

/** Editable in the UI. Corrections become rules ("sender domain X is always ignored"). */
export const classificationRules = app.table("classification_rules", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  name: text().notNull(),
  matchType: ruleMatchEnum().notNull(),
  pattern: text().notNull(),
  action: ruleActionEnum().notNull(),
  priority: integer().notNull().default(100),
  enabled: boolean().notNull().default(true),
  hitCount: integer().notNull().default(0),
}, (t) => [index("rules_org_idx").on(t.orgId, t.enabled, t.priority)]);
