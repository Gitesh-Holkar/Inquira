import { index, text, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns, softDelete } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

/**
 * A person we talk to. Deduplicated per org by lowercase email first, then E.164 phone (ADR-008).
 * Company names are NOT merged here: each lead keeps the company it was submitted with,
 * because unrelated companies sometimes share one mobile number.
 */
export const contacts = app.table("contacts", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  name: text(),
  email: text(),
  phone: text(),
  companyName: text(),
  city: text(),
  state: text(),
  country: text(),
}, (t) => [
  index("contacts_org_email_idx").on(t.orgId, t.email),
  index("contacts_org_phone_idx").on(t.orgId, t.phone),
]);
