import { boolean, date, index, integer, numeric, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns, softDelete } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

export const products = app.table("products", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  name: text().notNull(),
  category: text(),
  aliases: text().array().notNull().default([]),
  websiteUrl: text(),
  defaultPackSize: text(),
  defaultGstPercent: numeric({ precision: 5, scale: 2 }),
  notes: text(),
  sortOrder: integer().notNull().default(0),
}, (t) => [uniqueIndex("products_org_name_uq").on(t.orgId, t.name)]);

export const productGrades = app.table("product_grades", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  productId: uuid().notNull().references(() => products.id),
  name: text().notNull(),
  sortOrder: integer().notNull().default(0),
}, (t) => [uniqueIndex("grades_product_name_uq").on(t.productId, t.name)]);

/**
 * APPEND-ONLY rate book (a trigger rejects UPDATE/DELETE). The current rate for a grade is
 * the newest row with valid_from <= today and (valid_to is null or valid_to >= today).
 */
export const priceEntries = app.table("price_entries", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  gradeId: uuid().notNull().references(() => productGrades.id),
  pricePerKgInr: numeric({ precision: 12, scale: 2 }).notNull(),
  priceBasis: text().notNull(),
  moqKg: numeric({ precision: 12, scale: 2 }),
  gstPercent: numeric({ precision: 5, scale: 2 }).notNull(),
  gstInclusive: boolean().notNull().default(false),
  packSize: text(),
  validFrom: date().notNull(),
  validTo: date(),
  needsConfirmation: boolean().notNull().default(false),
  note: text(),
}, (t) => [index("price_entries_grade_idx").on(t.gradeId, t.validFrom, t.createdAt)]);
