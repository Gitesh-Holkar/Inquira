import type { Ctx } from "@/modules/core/types";
import type { NormalizedLead } from "@/modules/leads/types";

/**
 * Every lead source implements the same three steps (brief §6.4):
 *   fetch → normalize (to NormalizedLead) → upsert (leads service, idempotent on source+source_ref).
 * Add a new source by implementing this and registering a job type in src/modules/sources/jobs.ts.
 */
export interface LeadSourceAdapter<Raw> {
  readonly source: NormalizedLead["source"];
  fetch(ctx: Ctx, window: { from: Date; to: Date }): AsyncGenerator<Raw[], void, unknown>;
  normalize(raw: Raw): NormalizedLead | null;
}

export type SyncStats = { fetched: number; created: number; duplicates: number; errors: number; errorMessages: string[] };
export const emptyStats = (): SyncStats => ({ fetched: 0, created: 0, duplicates: 0, errors: 0, errorMessages: [] });
