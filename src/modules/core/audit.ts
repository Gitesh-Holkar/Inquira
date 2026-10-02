import type { Tx } from "@/db/client";
import { auditLogs, events } from "./schema";
import { actorString, type Ctx, type EventType } from "./types";

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, unknown>;
};

/** Writes an audit row in the caller's transaction. Every data change must call this (hard rule 8). */
export async function audit(tx: Tx, ctx: Ctx, input: AuditInput) {
  await tx.insert(auditLogs).values({
    orgId: ctx.orgId,
    actor: actorString(ctx.actor),
    createdBy: actorString(ctx.actor),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    changes: input.changes ?? null,
  });
}

export type EmitInput = {
  type: EventType;
  entityType?: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
};

/** Records a domain event in the outbox (brief §6.6), in the same transaction as the change. */
export async function emit(tx: Tx, ctx: Ctx, input: EmitInput) {
  await tx.insert(events).values({
    orgId: ctx.orgId,
    createdBy: actorString(ctx.actor),
    type: input.type,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    payload: input.payload ?? {},
  });
}
