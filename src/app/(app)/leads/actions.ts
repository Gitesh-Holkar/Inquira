"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { addLeadNote, createManualLead, updateLead, updateLeadStatus } from "@/modules/leads/service";
import { createQuoteDraft, whatsappForLead } from "@/modules/quotes/service";
import type { LeadStatus } from "@/modules/leads/types";

export async function setStatusAction(leadId: string, status: LeadStatus, reason?: string) {
  const s = await requireSession();
  const r = await runAction(() => updateLeadStatus(s.ctx, { leadId, status, reason: reason || undefined }), "Status updated");
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return r.ok ? { ok: true as const, message: r.message } : r;
}

export async function addNoteAction(leadId: string, body: string) {
  const s = await requireSession();
  const r = await runAction(() => addLeadNote(s.ctx, { leadId, body }), "Note added");
  revalidatePath(`/leads/${leadId}`);
  return r.ok ? { ok: true as const, message: r.message } : r;
}

export async function quoteAction(leadId: string, gradeIds?: string[]) {
  const s = await requireSession();
  const r = await runAction(() => createQuoteDraft(s.ctx, { leadId, gradeIds: gradeIds?.length ? gradeIds : undefined }));
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  if (!r.ok) return r;
  return { ok: true as const, draftUrl: r.data.draftUrl, warning: r.data.warning, status: r.data.quotation.status };
}

export async function whatsappTextAction(leadId: string) {
  const s = await requireSession();
  return runAction(() => whatsappForLead(s.ctx, { leadId }));
}

export async function updateLeadAction(leadId: string, fields: Record<string, string | boolean | null>) {
  const s = await requireSession();
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) clean[k] = v === "" ? null : v;
  const r = await runAction(() => updateLead(s.ctx, { leadId, fields: clean }), "Lead saved");
  revalidatePath(`/leads/${leadId}`);
  return r.ok ? { ok: true as const, message: r.message } : r;
}

export async function createLeadAction(fields: Record<string, string>) {
  const s = await requireSession();
  const r = await runAction(() => createManualLead(s.ctx, fields as never), "Lead created");
  revalidatePath("/leads");
  return r.ok ? { ok: true as const, leadId: r.data.leadId } : r;
}
