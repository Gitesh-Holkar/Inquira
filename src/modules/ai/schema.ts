import { index, integer, jsonb, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

/**
 * One row per AI decision (GOAL G-AI-9): which task, tier, provider and model, how confident, what
 * happened, and whether a person later corrected it. One model call (`call_id`) can produce several
 * rows: a lead call decides product, intent and quantity separately. Daily limits count distinct calls.
 * Written only by the AI job (system role); people may mark a row corrected through the lead or email.
 * Holds no key and no redacted-away personal data: `value` is only what the model proposed.
 */
export const aiDecisions = app.table("ai_decisions", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  callId: uuid().notNull(),
  /** lead.product | lead.intent | lead.quantity | email.classify */
  task: text().notNull(),
  /** basic | advanced */
  tier: text().notNull(),
  provider: text().notNull(),
  model: text().notNull(),
  /** lead | email_message (plain uuid: the leads and email modules own those rows) */
  entityType: text().notNull(),
  entityId: uuid().notNull(),
  /** applied | not_confident | invalid | error */
  outcome: text().notNull(),
  confidence: numeric({ precision: 4, scale: 3 }),
  value: jsonb().$type<unknown>(),
  /** Why it was not applied, or the provider's error kind and message (never a key). */
  detail: text(),
  latencyMs: integer(),
  inputTokens: integer(),
  outputTokens: integer(),
  correctedAt: timestamp({ withTimezone: true }),
  correctedBy: text(),
  correctedValue: jsonb().$type<unknown>(),
}, (t) => [
  index("ai_decisions_org_tier_created_idx").on(t.orgId, t.tier, t.createdAt),
  index("ai_decisions_org_entity_idx").on(t.orgId, t.entityType, t.entityId),
]);
