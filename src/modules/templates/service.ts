import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { AppError, notFound } from "@/lib/errors";
import { audit, emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { templates, templateVersions } from "./schema";
import { DEFAULT_TEMPLATES, TEMPLATE_PURPOSES, WHATSAPP_PURPOSES, unknownPlaceholders, type TemplatePurpose, type TemplateVars } from "./engine";

export type Template = typeof templates.$inferSelect;
const kind = z.enum(["quote_email", "whatsapp"]);

const purpose = z.enum(TEMPLATE_PURPOSES);

/** The template used for a channel and purpose: the one marked default, else the oldest. */
export async function getDefaultTemplateInternal(tx: Tx, orgId: string, k: z.infer<typeof kind>, p: TemplatePurpose = "first_quotation"): Promise<Template | null> {
  const rows = await tx.select().from(templates)
    .where(and(eq(templates.orgId, orgId), eq(templates.kind, k), eq(templates.purpose, p), isNull(templates.deletedAt)))
    .orderBy(asc(templates.createdAt));
  return rows.find((r) => r.isDefault) ?? rows[0] ?? null;
}

/** Creates the starting template for every channel and purpose the company does not have yet (G-TPL-1). */
export async function ensureDefaultTemplatesInternal(tx: Tx, ctx: Ctx) {
  const by = actorString(ctx.actor);
  for (const d of DEFAULT_TEMPLATES) {
    if (await getDefaultTemplateInternal(tx, ctx.orgId, d.kind, d.purpose)) continue;
    const [t] = await tx.insert(templates).values({ orgId: ctx.orgId, kind: d.kind, purpose: d.purpose, name: "Default", subject: d.subject, body: d.body, isDefault: true, createdBy: by }).returning();
    await tx.insert(templateVersions).values({ orgId: ctx.orgId, templateId: t!.id, version: 1, subject: d.subject, body: d.body, createdBy: by });
    await audit(tx, ctx, { action: "template.create", entityType: "template", entityId: t!.id, changes: { kind: d.kind, purpose: d.purpose } });
  }
}

/** Saved versions of one template, newest first (G-TPL-3). */
export const listTemplateVersions = defineService({
  name: "templates.versions",
  input: z.object({ templateId: z.string().uuid() }),
  permission: "templates.read",
  handler: (ctx, input, tx) => tx.select().from(templateVersions)
    .where(and(eq(templateVersions.orgId, ctx.orgId), eq(templateVersions.templateId, input.templateId))).orderBy(desc(templateVersions.version)).limit(50),
});

export const listTemplates = defineService({
  name: "templates.list",
  input: z.object({ kind: kind.optional() }).default({}),
  permission: "templates.read",
  handler: async (ctx, input, tx) =>
    tx.select().from(templates)
      .where(and(eq(templates.orgId, ctx.orgId), isNull(templates.deletedAt), input.kind ? eq(templates.kind, input.kind) : undefined))
      .orderBy(asc(templates.kind), asc(templates.name)),
});

export const saveTemplate = defineService({
  name: "templates.save",
  input: z.object({
    id: z.string().uuid().optional(),
    kind,
    purpose: purpose.default("first_quotation"),
    name: z.string().trim().min(1).max(80),
    subject: z.string().trim().max(200).nullish(),
    body: z.string().trim().min(1).max(10_000),
    isDefault: z.boolean().default(false),
  }),
  permission: "templates.write",
  handler: async (ctx, input, tx) => {
    const unknown = unknownPlaceholders(`${input.subject ?? ""}\n${input.body}`);
    if (unknown.length) throw new AppError("VALIDATION", `Unknown placeholder(s): ${unknown.map((u) => `{{${u}}}`).join(", ")}`, { fieldErrors: { body: [`Unknown placeholder(s): ${unknown.join(", ")}`] } });
    if (/\b(with regards|warm regards|best regards|thanks & regards)\b/i.test(input.body.split("\n").slice(-3).join("\n"))) {
      throw new AppError("VALIDATION", "Leave out the sign-off. Your Gmail signature is added automatically.", { fieldErrors: { body: ["Remove the sign-off; the Gmail signature is appended automatically."] } });
    }
    if (input.kind === "whatsapp" && !WHATSAPP_PURPOSES.includes(input.purpose)) throw new AppError("VALIDATION", "This kind of message is sent by email only.");
    if (input.isDefault) {
      await tx.update(templates).set({ isDefault: false }).where(and(eq(templates.orgId, ctx.orgId), eq(templates.kind, input.kind), eq(templates.purpose, input.purpose)));
    }
    let row: Template;
    if (input.id) {
      const [before] = await tx.select().from(templates).where(and(eq(templates.id, input.id), eq(templates.orgId, ctx.orgId)));
      if (!before) throw notFound("Template");
      const changed = before.body !== input.body || (before.subject ?? null) !== (input.subject ?? null);
      [row] = (await tx.update(templates).set({
        name: input.name, subject: input.subject ?? null, body: input.body, isDefault: input.isDefault || before.isDefault, version: changed ? before.version + 1 : before.version,
      }).where(eq(templates.id, input.id)).returning()) as [Template];
      if (changed) await tx.insert(templateVersions).values({ orgId: ctx.orgId, templateId: row.id, version: row.version, subject: row.subject, body: row.body, createdBy: actorString(ctx.actor) });
    } else {
      [row] = (await tx.insert(templates).values({ orgId: ctx.orgId, kind: input.kind, purpose: input.purpose, name: input.name, subject: input.subject ?? null, body: input.body, isDefault: input.isDefault, createdBy: actorString(ctx.actor) }).returning()) as [Template];
      await tx.insert(templateVersions).values({ orgId: ctx.orgId, templateId: row.id, version: 1, subject: row.subject, body: row.body, createdBy: actorString(ctx.actor) });
    }
    await audit(tx, ctx, { action: input.id ? "template.update" : "template.create", entityType: "template", entityId: row.id, changes: { name: row.name, kind: row.kind, purpose: row.purpose, version: row.version } });
    await emit(tx, ctx, { type: "template.updated", entityType: "template", entityId: row.id });
    return row;
  },
});

export const SAMPLE_VARS: TemplateVars = {
  contact_name: "Mr. Sharma",
  company_name: "Sample Foods Pvt. Ltd.",
  product: "Pea Protein Isolate",
  grade: "Standard",
  price_per_kg: "350.00",
  price_basis: "Ex-factory",
  gst_percent: "18",
  moq: "100",
  pack_size: "20 Kg",
  payment_terms: "100% advance",
  validity_date: "2 Oct 2026",
  quantity: " (500 kg)",
  city: "Pune",
  org_name: "Your Company",
  hsn_code: "35040091",
  lead_time: "7 to 10 days",
  documents: "COA and TDS",
  sample_size: "250 g",
  sample_details: "- Company name\n- GST number\n- Delivery address",
  sample_note: "",
  quote_date: "29 Sep 2026",
};

export async function getTemplateInternal(tx: Tx, orgId: string, id: string): Promise<Template | null> {
  const [t] = await tx.select().from(templates).where(and(eq(templates.id, id), eq(templates.orgId, orgId), isNull(templates.deletedAt)));
  return t ?? null;
}
