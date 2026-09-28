import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { AppError, notFound } from "@/lib/errors";
import { audit, emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { templates } from "./schema";
import { DEFAULT_QUOTE_BODY, DEFAULT_QUOTE_SUBJECT, DEFAULT_WHATSAPP_BODY, render, unknownPlaceholders, type TemplateVars } from "./engine";

export type Template = typeof templates.$inferSelect;
const kind = z.enum(["quote_email", "whatsapp"]);

export async function getDefaultTemplateInternal(tx: Tx, orgId: string, k: z.infer<typeof kind>): Promise<Template | null> {
  const rows = await tx.select().from(templates)
    .where(and(eq(templates.orgId, orgId), eq(templates.kind, k), isNull(templates.deletedAt)))
    .orderBy(asc(templates.createdAt));
  return rows.find((r) => r.isDefault) ?? rows[0] ?? null;
}

export async function ensureDefaultTemplatesInternal(tx: Tx, ctx: Ctx) {
  const by = actorString(ctx.actor);
  for (const [k, subject, body] of [
    ["quote_email", DEFAULT_QUOTE_SUBJECT, DEFAULT_QUOTE_BODY],
    ["whatsapp", null, DEFAULT_WHATSAPP_BODY],
  ] as const) {
    if (await getDefaultTemplateInternal(tx, ctx.orgId, k)) continue;
    const [t] = await tx.insert(templates).values({ orgId: ctx.orgId, kind: k, name: "Default", subject, body, isDefault: true, createdBy: by }).returning();
    await audit(tx, ctx, { action: "template.create", entityType: "template", entityId: t!.id, changes: { kind: k } });
  }
}

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
    if (input.isDefault) {
      await tx.update(templates).set({ isDefault: false }).where(and(eq(templates.orgId, ctx.orgId), eq(templates.kind, input.kind)));
    }
    let row: Template;
    if (input.id) {
      const [before] = await tx.select().from(templates).where(and(eq(templates.id, input.id), eq(templates.orgId, ctx.orgId)));
      if (!before) throw notFound("Template");
      [row] = (await tx.update(templates).set({ name: input.name, subject: input.subject ?? null, body: input.body, isDefault: input.isDefault || before.isDefault })
        .where(eq(templates.id, input.id)).returning()) as [Template];
    } else {
      [row] = (await tx.insert(templates).values({ orgId: ctx.orgId, kind: input.kind, name: input.name, subject: input.subject ?? null, body: input.body, isDefault: input.isDefault, createdBy: actorString(ctx.actor) }).returning()) as [Template];
    }
    await audit(tx, ctx, { action: input.id ? "template.update" : "template.create", entityType: "template", entityId: row.id, changes: { name: row.name, kind: row.kind } });
    await emit(tx, ctx, { type: "template.updated", entityType: "template", entityId: row.id });
    return row;
  },
});

/** Live preview with sample values (no DB writes). */
export function previewTemplate(body: string, subject: string | null, vars: TemplateVars) {
  return { subject: subject ? render(subject, vars) : null, body: render(body, vars), unknown: unknownPlaceholders(`${subject ?? ""}\n${body}`) };
}

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
  validity_date: "2 Oct 2026",
  quantity: " (500 kg)",
  city: "Pune",
  org_name: "Your Company",
};

export async function getTemplateInternal(tx: Tx, orgId: string, id: string): Promise<Template | null> {
  const [t] = await tx.select().from(templates).where(and(eq(templates.id, id), eq(templates.orgId, orgId), isNull(templates.deletedAt)));
  return t ?? null;
}
