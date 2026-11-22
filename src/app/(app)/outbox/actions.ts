"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { approveAndSend, editMessage, prepareMessage, rejectMessage } from "@/modules/outbound/service";
import type { Channel, MessagePurpose, RuleMatchType } from "@/modules/outbound/types";

const done = () => { revalidatePath("/outbox"); revalidatePath("/", "layout"); };

/** Approve and send: email goes at once; WhatsApp returns the link to open. */
export async function approveAction(id: string, confirmHeld: boolean) {
  const s = await requireSession("quotes.create");
  const r = await runAction(() => approveAndSend(s.ctx, { id, confirmHeld }));
  done();
  if (!r.ok) return r;
  if ("error" in r.data && r.data.error) return { ok: false as const, error: `Not sent: ${r.data.error}` };
  return { ok: true as const, whatsappUrl: r.data.whatsappUrl };
}

export async function editAction(id: string, subject: string | null, body: string) {
  const s = await requireSession("quotes.create");
  const r = await runAction(() => editMessage(s.ctx, { id, subject, body }), "Saved");
  done();
  return r.ok ? { ok: true as const } : r;
}

export async function rejectAction(id: string, reason: string, rule: { matchType: RuleMatchType; pattern: string } | null) {
  const s = await requireSession("quotes.create");
  const r = await runAction(() => rejectMessage(s.ctx, { id, reason, rule: rule ?? undefined }));
  done();
  return r.ok ? { ok: true as const, rule: !!r.data.rule } : r;
}

export async function prepareAction(leadId: string, purpose: MessagePurpose, channel: Channel) {
  const s = await requireSession("quotes.create");
  const r = await runAction(() => prepareMessage(s.ctx, { leadId, purpose, channel }));
  done();
  revalidatePath(`/leads/${leadId}`);
  return r.ok ? { ok: true as const, state: r.data.state } : r;
}
