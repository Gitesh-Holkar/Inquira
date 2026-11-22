"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { saveTemplate } from "@/modules/templates/service";
import type { TemplatePurpose } from "@/modules/templates/engine";

export async function saveTemplateAction(input: { id?: string; kind: "quote_email" | "whatsapp"; purpose: TemplatePurpose; name: string; subject: string | null; body: string }) {
  const s = await requireSession("templates.write");
  const r = await runAction(() => saveTemplate(s.ctx, { ...input, isDefault: true }), "Template saved");
  revalidatePath("/templates");
  return r.ok ? { ok: true as const } : r;
}
