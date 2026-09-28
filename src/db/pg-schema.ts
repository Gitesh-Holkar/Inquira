import { pgSchema, timestamp, uuid, text } from "drizzle-orm/pg-core";

/**
 * All Inquira tables live in the `app` schema, which Supabase's Data API does not expose.
 * This means a signed-in user cannot bypass the service layer by calling PostgREST with
 * their JWT. See ADR-004.
 */
export const app = pgSchema("app");

/** Columns every table carries (brief §6.3). `created_by` is an actor string: human:<uuid> | mcp:<token> | system:<job>. */
export const baseColumns = () => ({
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: text().notNull(),
});

export const softDelete = () => ({
  deletedAt: timestamp({ withTimezone: true }),
});
