import { boolean, index, integer, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

export type BuyleadProductTerm = { productId: string | null; productName: string; terms: string[] };

/** Rules served to the Claude Cowork IndiaMART task (brief §7.2b). One row per org. */
export const buyleadRules = app.table("buylead_rules", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  productTerms: jsonb().$type<BuyleadProductTerm[]>().notNull().default([]),
  excludedTerms: text().array().notNull().default([]),
  allowedCountries: text().array().notNull().default(["India"]),
  allowedStates: text().array().notNull().default([]),
  excludedStates: text().array().notNull().default([]),
  minQuantityKg: numeric({ precision: 12, scale: 2 }),
  maxQuantityKg: numeric({ precision: 12, scale: 2 }),
  dailyCap: integer().notNull().default(10),
  testMode: boolean().notNull().default(true),
}, (t) => [uniqueIndex("buylead_rules_org_uq").on(t.orgId)]);

export const buyleadDecisionEnum = app.enum("buylead_decision", ["contacted", "skipped", "would_contact"]);

export const buyleadDecisions = app.table("buylead_decisions", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  leadTitle: text().notNull(),
  product: text(),
  location: text(),
  quantity: text(),
  decision: buyleadDecisionEnum().notNull(),
  reason: text().notNull(),
  decidedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  testMode: boolean().notNull().default(false),
  meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("buylead_decisions_org_idx").on(t.orgId, t.decidedAt)]);
