import { date, index, integer, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns, softDelete } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";
import { products } from "@/modules/catalog/schema";

export const documentTypeEnum = app.enum("document_type", ["coa", "tds", "msds", "specification", "brochure", "certificate"]);

/**
 * Document library (GOAL G-KB-4): one row per uploaded file. The file itself is in file storage
 * (`storage.ts`) under `storage_key`. A document without a product applies to the whole company
 * (a brochure, a factory certificate). Removing is a soft delete; the file is kept.
 */
export const documents = app.table("documents", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  productId: uuid().references(() => products.id),
  type: documentTypeEnum().notNull(),
  title: text().notNull(),
  fileName: text().notNull(),
  contentType: text().notNull(),
  sizeBytes: integer().notNull(),
  sha256: text().notNull(),
  storageKey: text().notNull(),
  batch: text(),
  issueDate: date(),
  expiryDate: date(),
  notes: text(),
}, (t) => [
  index("documents_org_product_type_idx").on(t.orgId, t.productId, t.type),
  uniqueIndex("documents_storage_key_uq").on(t.storageKey),
]);
