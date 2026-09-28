import { index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, baseColumns } from "@/db/pg-schema";
import { organizations } from "@/modules/core/schema";

export const tokenKindEnum = app.enum("mcp_token_kind", ["manual", "oauth"]);

/** Bearer tokens for /api/mcp. Only a SHA-256 hash is stored; the token is shown once. */
export const mcpTokens = app.table("mcp_tokens", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  name: text().notNull(),
  kind: tokenKindEnum().notNull().default("manual"),
  tokenHash: text().notNull(),
  tokenPrefix: text().notNull(),
  scopes: text().array().notNull().default(["mcp"]),
  oauthClientId: uuid(),
  expiresAt: timestamp({ withTimezone: true }),
  lastUsedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
}, (t) => [
  uniqueIndex("mcp_tokens_hash_uq").on(t.tokenHash),
  index("mcp_tokens_org_idx").on(t.orgId),
]);

/** OAuth 2.1 clients registered via Dynamic Client Registration (RFC 7591) — e.g. claude.ai connectors. Not org-scoped until authorized. */
export const oauthClients = app.table("oauth_clients", {
  ...baseColumns(),
  clientId: text().notNull(),
  clientSecretHash: text(),
  clientName: text(),
  redirectUris: text().array().notNull(),
  metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [uniqueIndex("oauth_clients_client_id_uq").on(t.clientId)]);

export const oauthCodes = app.table("oauth_codes", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  clientId: text().notNull(),
  codeHash: text().notNull(),
  redirectUri: text().notNull(),
  codeChallenge: text().notNull(),
  scope: text(),
  resource: text(),
  userId: uuid().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usedAt: timestamp({ withTimezone: true }),
}, (t) => [uniqueIndex("oauth_codes_hash_uq").on(t.codeHash)]);

export const oauthRefreshTokens = app.table("oauth_refresh_tokens", {
  ...baseColumns(),
  orgId: uuid().notNull().references(() => organizations.id),
  clientId: text().notNull(),
  tokenHash: text().notNull(),
  accessTokenId: uuid(),
  userId: uuid().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  revokedAt: timestamp({ withTimezone: true }),
}, (t) => [uniqueIndex("oauth_refresh_hash_uq").on(t.tokenHash)]);
