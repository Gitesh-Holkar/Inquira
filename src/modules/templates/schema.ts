import { boolean, index, integer, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns, softDelete } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

export const templateKindEnum = app.enum("template_kind", ["quote_email", "whatsapp"]);

/** Placeholders: {{contact_name}}, {{product}}, {{grade}}, {{price_per_kg}}, ... No sign-off: the Gmail signature is appended at draft time. */
export const templates = app.table("templates", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  kind: templateKindEnum().notNull(),
  name: text().notNull(),
  subject: text(),
  body: text().notNull(),
  isDefault: boolean().notNull().default(false),
  /** What the message is for (GOAL G-TPL-1): first_quotation, detailed_quotation, document_share, … (`TEMPLATE_PURPOSES`). */
  purpose: text().notNull().default("first_quotation"),
  /** Goes up by one on every save; each version is kept in template_versions (G-TPL-3). */
  version: integer().notNull().default(1),
}, (t) => [uniqueIndex("templates_org_kind_purpose_name_uq").on(t.orgId, t.kind, t.purpose, t.name)]);

/** Every saved version of a template (G-TPL-3). Outgoing messages record the version they were built from. */
export const templateVersions = app.table("template_versions", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  templateId: uuid().notNull().references(() => templates.id),
  version: integer().notNull(),
  subject: text(),
  body: text().notNull(),
}, (t) => [uniqueIndex("template_versions_uq").on(t.templateId, t.version), index("template_versions_org_idx").on(t.orgId)]);
