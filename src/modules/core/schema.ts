import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns, softDelete } from "@/db/pg-schema";

// Re-exported so drizzle-kit emits CREATE SCHEMA "app".
export { app } from "@/db/pg-schema";

export const roleEnum = app.enum("member_role", ["owner", "admin", "sales", "viewer"]);

export const organizations = app.table("organizations", {
  ...baseColumns(),
  ...softDelete(),
  name: text().notNull(),
  slug: text().notNull(),
});

export type OrgFeatures = {
  tradeindia?: boolean;
  gmail?: boolean;
  quotes?: boolean;
  buyleads?: boolean;
  mcp?: boolean;
};

export const orgSettings = app.table("org_settings", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  features: jsonb().$type<OrgFeatures>().notNull().default({}),
  quoteValidityDays: integer().notNull().default(3),
  timezone: text().notNull().default("Asia/Kolkata"),
  homeCountry: text().notNull().default("IN"),
  defaultPriceBasis: text().notNull().default("Ex-factory"),
}, (t) => [uniqueIndex("org_settings_org_uq").on(t.orgId)]);

export const memberships = app.table("memberships", {
  ...baseColumns(),
  ...softDelete(),
  orgId: uuid().notNull().references(() => organizations.id),
  userId: uuid().notNull(),
  role: roleEnum().notNull(),
  email: text().notNull(),
  displayName: text(),
}, (t) => [
  uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId),
  index("memberships_user_idx").on(t.userId),
]);

/** Append-only. Written by the service layer for every data change. */
export const auditLogs = app.table("audit_logs", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  actor: text().notNull(),
  action: text().notNull(),
  entityType: text().notNull(),
  entityId: uuid(),
  changes: jsonb().$type<Record<string, unknown>>(),
}, (t) => [
  index("audit_org_entity_idx").on(t.orgId, t.entityType, t.entityId),
  index("audit_org_created_idx").on(t.orgId, t.createdAt),
]);

/** Domain events (outbox). Future features subscribe by type; processed_at marks delivery. */
export const events = app.table("events", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  type: text().notNull(),
  entityType: text(),
  entityId: uuid(),
  payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  processedAt: timestamp({ withTimezone: true }),
}, (t) => [
  index("events_org_type_idx").on(t.orgId, t.type, t.createdAt),
  index("events_unprocessed_idx").on(t.processedAt),
]);

export const jobStatusEnum = app.enum("job_status", ["queued", "running", "done", "failed"]);

/** Background work queue processed by /api/cron/* endpoints. */
export const jobs = app.table("jobs", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  type: text().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  status: jobStatusEnum().notNull().default("queued"),
  runAfter: timestamp({ withTimezone: true }).notNull().defaultNow(),
  attempts: integer().notNull().default(0),
  maxAttempts: integer().notNull().default(5),
  lockedAt: timestamp({ withTimezone: true }),
  lastError: text(),
  dedupeKey: text(),
}, (t) => [
  index("jobs_pick_idx").on(t.status, t.runAfter),
  uniqueIndex("jobs_dedupe_uq").on(t.orgId, t.dedupeKey),
]);

export const integrationProviderEnum = app.enum("integration_provider", ["gmail", "tradeindia"]);
export const integrationStatusEnum = app.enum("integration_status", [
  "not_connected", "configured", "connected", "error", "reauth_required",
]);

/** Non-secret integration state. Secrets live in integration_secrets (no RLS read access). */
export const integrations = app.table("integrations", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  provider: integrationProviderEnum().notNull(),
  status: integrationStatusEnum().notNull().default("not_connected"),
  config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  cursor: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  accountEmail: text(),
  lastSyncAt: timestamp({ withTimezone: true }),
  lastSuccessAt: timestamp({ withTimezone: true }),
  lastError: text(),
  lastErrorAt: timestamp({ withTimezone: true }),
  consecutiveFailures: integer().notNull().default(0),
  backoffUntil: timestamp({ withTimezone: true }),
  enabled: boolean().notNull().default(true),
}, (t) => [uniqueIndex("integrations_org_provider_uq").on(t.orgId, t.provider)]);

/** AES-256-GCM encrypted JSON blobs (client secrets, refresh tokens, API keys). Never readable by the authenticated role. */
export const integrationSecrets = app.table("integration_secrets", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  integrationId: uuid().notNull().references(() => integrations.id),
  ciphertext: text().notNull(),
  keyVersion: integer().notNull().default(1),
}, (t) => [uniqueIndex("integration_secrets_integration_uq").on(t.integrationId)]);

export const syncRuns = app.table("sync_runs", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  provider: integrationProviderEnum().notNull(),
  kind: text().notNull().default("incremental"),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
  status: text().notNull().default("running"),
  fetched: integer().notNull().default(0),
  created: integer().notNull().default(0),
  duplicates: integer().notNull().default(0),
  errors: integer().notNull().default(0),
  errorMessage: text(),
  meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("sync_runs_org_provider_idx").on(t.orgId, t.provider, t.startedAt)]);
