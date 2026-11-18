import { and, desc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actorString, type Ctx } from "@/modules/core/types";
import { aiDecisions } from "./schema";
import type { AiTask } from "./types";

/**
 * Marks the latest applied AI decision for this lead or email field as corrected (GOAL G-AI-9), when a
 * person or the Claude connector changes the value the AI set. Called by the leads and email services in
 * the same transaction as the change. Kept apart from the AI service so those modules can call it
 * without importing the AI job (no import cycle). Does nothing when the AI never set the field.
 */
export async function markAiCorrectedInternal(tx: Tx, ctx: Ctx, d: { entityType: "lead" | "email_message"; entityId: string; task: AiTask; correctedValue: unknown }) {
  const [last] = await tx.select({ id: aiDecisions.id, value: aiDecisions.value }).from(aiDecisions)
    .where(and(
      eq(aiDecisions.orgId, ctx.orgId), eq(aiDecisions.entityType, d.entityType), eq(aiDecisions.entityId, d.entityId),
      eq(aiDecisions.task, d.task), eq(aiDecisions.outcome, "applied"), isNull(aiDecisions.correctedAt),
    ))
    .orderBy(desc(aiDecisions.createdAt)).limit(1);
  if (!last || JSON.stringify(last.value) === JSON.stringify(d.correctedValue)) return false;
  await tx.update(aiDecisions)
    .set({ correctedAt: new Date(), correctedBy: actorString(ctx.actor), correctedValue: d.correctedValue as object })
    .where(and(eq(aiDecisions.id, last.id), eq(aiDecisions.orgId, ctx.orgId)));
  return true;
}
