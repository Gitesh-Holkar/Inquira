import { boolean, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
}, (t) => [uniqueIndex("templates_org_kind_name_uq").on(t.orgId, t.kind, t.name)]);
