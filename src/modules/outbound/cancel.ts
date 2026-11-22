import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit } from "@/modules/core/audit";
import type { Ctx } from "@/modules/core/types";
import { outgoingMessages } from "./schema";

/**
 * Cancels messages for a lead that are not sent yet, for example when a person quoted it by hand through a
 * Gmail draft. Kept apart from the service so the quotes module can call it without an import cycle.
 */
export async function cancelPendingMessagesInternal(tx: Tx, ctx: Ctx, leadId: string, purposes: string[], reason: string) {
  const rows = await tx.update(outgoingMessages).set({ state: "cancelled", cancelledReason: reason })
    .where(and(eq(outgoingMessages.orgId, ctx.orgId), eq(outgoingMessages.leadId, leadId), inArray(outgoingMessages.purpose, purposes), inArray(outgoingMessages.state, ["draft", "held", "approved"])))
    .returning({ id: outgoingMessages.id });
  for (const r of rows) await audit(tx, ctx, { action: "outbound.cancel", entityType: "outgoing_message", entityId: r.id, changes: { reason } });
  return rows.length;
}
