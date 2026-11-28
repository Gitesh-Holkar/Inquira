import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit } from "@/modules/core/audit";
import type { Ctx } from "@/modules/core/types";
import { outgoingMessages } from "./schema";

/** Outbox states that still need a person or a send (the lead is not "replied" while one exists). */
export const PENDING_STATES = ["draft", "held", "approved", "failed"] as const;

/**
 * Cancels messages for a lead that are not sent yet, for example when a person quoted it by hand through a
 * Gmail draft, replied outside Inquira, or deleted the lead. Kept apart from the service so the quotes and leads
 * modules can call it without an import cycle. `purposes: "all"` covers every kind; `includeFailed` also stops
 * failed sends; `channel` limits it to one channel. Returns how many were cancelled.
 */
export async function cancelPendingMessagesInternal(
  tx: Tx, ctx: Ctx, leadId: string, purposes: string[] | "all", reason: string,
  opts: { includeFailed?: boolean; channel?: "email" | "whatsapp" } = {},
) {
  const states = opts.includeFailed ? [...PENDING_STATES] : ["draft", "held", "approved"];
  const rows = await tx.update(outgoingMessages).set({ state: "cancelled", cancelledReason: reason })
    .where(and(
      eq(outgoingMessages.orgId, ctx.orgId), eq(outgoingMessages.leadId, leadId), inArray(outgoingMessages.state, states),
      purposes === "all" ? undefined : inArray(outgoingMessages.purpose, purposes),
      opts.channel ? eq(outgoingMessages.channel, opts.channel) : undefined,
    ))
    .returning({ id: outgoingMessages.id });
  for (const r of rows) await audit(tx, ctx, { action: "outbound.cancel", entityType: "outgoing_message", entityId: r.id, changes: { reason } });
  return rows.length;
}

/** Whether anything for this lead waits or failed in the Outbox. */
export async function leadHasPendingMessagesInternal(tx: Tx, orgId: string, leadId: string): Promise<boolean> {
  const [r] = await tx.select({ id: outgoingMessages.id }).from(outgoingMessages)
    .where(and(eq(outgoingMessages.orgId, orgId), eq(outgoingMessages.leadId, leadId), inArray(outgoingMessages.state, [...PENDING_STATES]))).limit(1);
  return !!r;
}

/** Whether a Gmail message is one Inquira itself sent (so the Gmail sync does not mistake it for a person's reply). */
export async function isInquiraSentInternal(tx: Tx, orgId: string, gmailMessageId: string): Promise<boolean> {
  const [r] = await tx.select({ id: outgoingMessages.id }).from(outgoingMessages)
    .where(and(eq(outgoingMessages.orgId, orgId), eq(outgoingMessages.gmailMessageId, gmailMessageId))).limit(1);
  return !!r;
}
