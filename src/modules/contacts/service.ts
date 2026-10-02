import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { normalizeEmail, toE164 } from "@/lib/phone";
import { audit, emit } from "@/modules/core/audit";
import { actorString, type Ctx } from "@/modules/core/types";
import { contacts } from "./schema";

/** Portal placeholder addresses that are not the buyer's real email. */
const PLACEHOLDER_EMAILS = [/^noreply@noreply\.tradeindia\.com$/, /^no-?reply@/, /@indiamart\.com$/, /@tradeindia\.com$/];

export function cleanEmail(raw: string | null | undefined): string | null {
  const e = normalizeEmail(raw);
  if (!e) return null;
  return PLACEHOLDER_EMAILS.some((re) => re.test(e)) ? null : e;
}

export type ContactInput = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

/**
 * Finds or creates the contact for an inquiry (ADR-008): match lowercase email first, then E.164 phone.
 * Existing values are never overwritten, only empty fields are filled. The company name stays on each
 * lead, so two companies sharing one mobile number are never merged.
 */
export async function resolveContactInternal(tx: Tx, ctx: Ctx, input: ContactInput) {
  const email = cleanEmail(input.email);
  const phone = toE164(input.phone);
  if (!email && !phone) return { contactId: null as string | null, created: false, matchedBy: null as null | "email" | "phone" };

  let existing: typeof contacts.$inferSelect | undefined;
  let matchedBy: "email" | "phone" | null = null;
  if (email) {
    [existing] = await tx.select().from(contacts).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.email, email), isNull(contacts.deletedAt))).limit(1);
    if (existing) matchedBy = "email";
  }
  if (!existing && phone) {
    [existing] = await tx.select().from(contacts).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.phone, phone), isNull(contacts.deletedAt))).limit(1);
    if (existing) matchedBy = "phone";
  }

  const incoming = {
    name: input.name?.trim() || null,
    email,
    phone,
    companyName: input.companyName?.trim() || null,
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    country: input.country?.trim() || null,
  };

  if (existing) {
    const fill: Partial<typeof incoming> = {};
    for (const k of Object.keys(incoming) as (keyof typeof incoming)[]) {
      if (!existing[k] && incoming[k]) fill[k] = incoming[k];
    }
    if (Object.keys(fill).length) {
      await tx.update(contacts).set(fill).where(eq(contacts.id, existing.id));
      await audit(tx, ctx, { action: "contact.fill", entityType: "contact", entityId: existing.id, changes: fill });
    }
    return { contactId: existing.id, created: false, matchedBy };
  }

  const [c] = await tx.insert(contacts).values({ orgId: ctx.orgId, ...incoming, createdBy: actorString(ctx.actor) }).returning();
  await audit(tx, ctx, { action: "contact.create", entityType: "contact", entityId: c!.id, changes: incoming });
  await emit(tx, ctx, { type: "contact.created", entityType: "contact", entityId: c!.id });
  return { contactId: c!.id, created: true, matchedBy: null };
}
