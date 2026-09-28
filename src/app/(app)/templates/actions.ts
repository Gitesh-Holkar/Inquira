"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { saveTemplate } from "@/modules/templates/service";

export async function saveTemplateAction(input: { id?: string; kind: "quote_email" | "whatsapp"; name: string; subject: string | null; body: string }) {
  const s = await requireSession("templates.write");
  const r = await runAction(() => saveTemplate(s.ctx, { ...input, isDefault: true }), "Template saved");
  revalidatePath("/templates");
  return r.ok ? { ok: true as const } : r;
}
