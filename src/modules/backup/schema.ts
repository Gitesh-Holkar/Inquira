import { index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

/**
 * Nightly backups (GOAL G-PLT-7): one file per company per day in file storage (Supabase bucket or disk),
 * kept 14 days; owners download a copy to keep elsewhere. Restore: `npm run backup:restore` (docs/RUNBOOK.md).
 */
export const backups = app.table("backups", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  storageKey: text().notNull(),
  sizeBytes: integer().notNull(),
  /** Rows per table and number of document files inside. */
  counts: jsonb().$type<Record<string, number>>().notNull().default({}),
  deletedAt: timestamp({ withTimezone: true }),
}, (t) => [index("backups_org_created_idx").on(t.orgId, t.createdAt)]);

