import { createHash } from "node:crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { withSystemTx, type Tx } from "@/db/client";
import { randomToken, sha256 } from "@/lib/crypto";
import { AppError, notFound } from "@/lib/errors";
import { audit, emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { mcpTokens, oauthClients, oauthCodes, oauthRefreshTokens } from "./schema";

export const ACCESS_TOKEN_TTL_S = 3600;
const REFRESH_TTL_MS = 30 * 86400_000;
const CODE_TTL_MS = 5 * 60_000;

// ---------- manual tokens (Settings → MCP tokens) ----------

export const createMcpToken = defineService({
  name: "mcp.createToken",
  input: z.object({ name: z.string().trim().min(2).max(60).regex(/^[\w .-]+$/, "Letters, numbers, spaces, dot, dash, underscore"), expiresInDays: z.number().int().min(1).max(3650).nullish() }),
  permission: "mcp_tokens.manage",
  handler: async (ctx, input, tx) => {
    const token = randomToken("inq_mcp");
    const [row] = await tx.insert(mcpTokens).values({
      orgId: ctx.orgId, name: input.name, kind: "manual", tokenHash: sha256(token), tokenPrefix: token.slice(0, 12),
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000) : null, createdBy: actorString(ctx.actor),
    }).returning();
    await audit(tx, ctx, { action: "mcp.token_create", entityType: "mcp_token", entityId: row!.id, changes: { name: input.name, expiresAt: row!.expiresAt } });
    await emit(tx, ctx, { type: "mcp.token_created", entityType: "mcp_token", entityId: row!.id });
    return { id: row!.id, name: row!.name, token }; // shown once; only the hash is stored
  },
});

export const listMcpTokens = defineService({
  name: "mcp.listTokens",
  input: z.object({}).default({}),
  permission: "mcp_tokens.manage",
  handler: (ctx, _i, tx) =>
    tx.select({ id: mcpTokens.id, name: mcpTokens.name, kind: mcpTokens.kind, tokenPrefix: mcpTokens.tokenPrefix, createdAt: mcpTokens.createdAt, lastUsedAt: mcpTokens.lastUsedAt, expiresAt: mcpTokens.expiresAt, revokedAt: mcpTokens.revokedAt, createdBy: mcpTokens.createdBy })
      .from(mcpTokens)
      .where(and(eq(mcpTokens.orgId, ctx.orgId), or(eq(mcpTokens.kind, "manual"), isNull(mcpTokens.revokedAt))))
      .orderBy(desc(mcpTokens.createdAt)).limit(100),
});

export const revokeMcpToken = defineService({
  name: "mcp.revokeToken",
  input: z.object({ id: z.string().uuid() }),
  permission: "mcp_tokens.manage",
  handler: async (ctx, input, tx) => {
    const [row] = await tx.update(mcpTokens).set({ revokedAt: new Date() }).where(and(eq(mcpTokens.id, input.id), eq(mcpTokens.orgId, ctx.orgId), isNull(mcpTokens.revokedAt))).returning();
    if (!row) throw notFound("Token");
    if (row.kind === "oauth") await tx.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(eq(oauthRefreshTokens.accessTokenId, row.id));
    await audit(tx, ctx, { action: "mcp.token_revoke", entityType: "mcp_token", entityId: row.id, changes: { name: row.name } });
    await emit(tx, ctx, { type: "mcp.token_revoked", entityType: "mcp_token", entityId: row.id });
    return { ok: true };
  },
});

/** Resolves a bearer token to an MCP actor context, or null. */
export async function authenticateBearer(token: string): Promise<Ctx | null> {
  if (!/^inq_(mcp|oat)_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const hash = sha256(token);
  return withSystemTx(async (tx) => {
    const [row] = await tx.select().from(mcpTokens).where(and(eq(mcpTokens.tokenHash, hash), isNull(mcpTokens.revokedAt), or(isNull(mcpTokens.expiresAt), gt(mcpTokens.expiresAt, new Date()))));
    if (!row) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) {
      await tx.update(mcpTokens).set({ lastUsedAt: new Date() }).where(eq(mcpTokens.id, row.id));
    }
    return { orgId: row.orgId, actor: { kind: "mcp", tokenId: row.id, tokenName: row.name, scopes: row.scopes } } satisfies Ctx;
  });
}

// ---------- OAuth 2.1 for claude.ai custom connectors (ADR-013) ----------

export class OAuthError extends Error {
  constructor(public readonly error: string, public readonly description: string, public readonly status = 400) {
    super(description);
  }
}

function isLoopback(u: URL) {
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
}

export function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === "https:" || isLoopback(u);
  } catch {
    return false;
  }
}

/** Exact match, except loopback redirects match on scheme+host+path with any port (RFC 8252 §7.3; Claude Code). */
export function redirectMatches(registered: string[], given: string): boolean {
  if (registered.includes(given)) return true;
  let g: URL;
  try {
    g = new URL(given);
  } catch {
    return false;
  }
  if (!isLoopback(g)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return isLoopback(u) && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
    } catch {
      return false;
    }
  });
}

export const dcrInput = z.object({
  redirect_uris: z.array(z.string().max(500)).min(1).max(10),
  client_name: z.string().max(120).optional(),
  token_endpoint_auth_method: z.enum(["none", "client_secret_post", "client_secret_basic"]).default("none"),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().max(200).optional(),
}).passthrough();

export async function registerOAuthClient(raw: unknown) {
  const r = dcrInput.safeParse(raw);
  if (!r.success) throw new OAuthError("invalid_client_metadata", "Invalid client metadata");
  const m = r.data;
  if (!m.redirect_uris.every(validRedirectUri)) throw new OAuthError("invalid_redirect_uri", "redirect_uris must be https or loopback http");
  const clientId = randomToken("inq_cli");
  let clientSecret: string | null = null;
  if (m.token_endpoint_auth_method !== "none") clientSecret = randomToken("inq_cs");
  await withSystemTx((tx) => tx.insert(oauthClients).values({
    clientId, clientSecretHash: clientSecret ? sha256(clientSecret) : null, clientName: m.client_name?.slice(0, 120) ?? null,
    redirectUris: m.redirect_uris, metadata: { token_endpoint_auth_method: m.token_endpoint_auth_method, scope: m.scope ?? "mcp" }, createdBy: "system:oauth_dcr",
  }));
  return {
    client_id: clientId, ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}), client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: m.client_name, redirect_uris: m.redirect_uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    token_endpoint_auth_method: m.token_endpoint_auth_method, scope: "mcp",
  };
}

export async function getOAuthClient(clientId: string) {
  const [c] = await withSystemTx((tx) => tx.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)));
  return c ?? null;
}

export const authorizeParams = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(5).max(200),
  redirect_uri: z.string().max(500),
  code_challenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(1000).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().max(500).optional(),
});

/** Validates an /oauth/authorize request. Throws OAuthError; returns the client when OK. */
export async function validateAuthorizeRequest(params: Record<string, string | undefined>) {
  const p = authorizeParams.safeParse(params);
  if (!p.success) throw new OAuthError("invalid_request", "Missing or invalid OAuth parameters (PKCE S256 is required).");
  const client = await getOAuthClient(p.data.client_id);
  if (!client) throw new OAuthError("invalid_client", "Unknown client_id. Remove and re-add the connector.");
  if (!redirectMatches(client.redirectUris, p.data.redirect_uri)) throw new OAuthError("invalid_request", "redirect_uri is not registered for this client.");
  return { client, params: p.data };
}

/** Called when the signed-in owner/admin clicks Allow on the consent screen. */
export async function issueAuthorizationCode(ctx: Ctx, params: z.infer<typeof authorizeParams>) {
  if (ctx.actor.kind !== "human" || !["owner", "admin"].includes(ctx.actor.role)) throw new AppError("FORBIDDEN", "Only owners and admins can connect Claude.");
  const code = randomToken("inq_code");
  await withSystemTx(async (tx) => {
    await tx.insert(oauthCodes).values({
      orgId: ctx.orgId, clientId: params.client_id, codeHash: sha256(code), redirectUri: params.redirect_uri, codeChallenge: params.code_challenge,
      scope: params.scope ?? "mcp", resource: params.resource ?? null, userId: (ctx.actor as { userId: string }).userId,
      expiresAt: new Date(Date.now() + CODE_TTL_MS), createdBy: actorString(ctx.actor),
    });
    await audit(tx, ctx, { action: "mcp.oauth_authorize", entityType: "oauth_client", changes: { clientId: params.client_id, redirectHost: new URL(params.redirect_uri).host } });
  });
  const u = new URL(params.redirect_uri);
  u.searchParams.set("code", code);
  if (params.state) u.searchParams.set("state", params.state);
  return u.toString();
}

async function issueTokens(tx: Tx, orgId: string, clientId: string, clientName: string | null, userId: string) {
  const access = randomToken("inq_oat");
  const refresh = randomToken("inq_ort");
  const name = `OAuth: ${clientName ?? "MCP client"}`.slice(0, 60);
  const [tok] = await tx.insert(mcpTokens).values({
    orgId, name, kind: "oauth", tokenHash: sha256(access), tokenPrefix: access.slice(0, 12), oauthClientId: null,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_S * 1000), createdBy: `human:${userId}`,
  }).returning();
  await tx.insert(oauthRefreshTokens).values({ orgId, clientId, tokenHash: sha256(refresh), accessTokenId: tok!.id, userId, expiresAt: new Date(Date.now() + REFRESH_TTL_MS), createdBy: `human:${userId}` });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, refresh_token: refresh, scope: "mcp" };
}

function verifyPkce(verifier: string, challenge: string) {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return computed === challenge;
}

export async function tokenEndpoint(form: URLSearchParams, basicAuth?: { clientId: string; clientSecret: string } | null) {
  const grant = form.get("grant_type");
  const clientId = form.get("client_id") ?? basicAuth?.clientId ?? "";
  const client = clientId ? await getOAuthClient(clientId) : null;
  if (!client) throw new OAuthError("invalid_client", "Unknown client", 401);
  if (client.clientSecretHash) {
    const secret = form.get("client_secret") ?? basicAuth?.clientSecret ?? "";
    if (sha256(secret) !== client.clientSecretHash) throw new OAuthError("invalid_client", "Bad client credentials", 401);
  }

  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    return withSystemTx(async (tx) => {
      const [row] = await tx.select().from(oauthCodes).where(eq(oauthCodes.codeHash, sha256(code)));
      if (!row || row.clientId !== clientId || row.usedAt || row.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Authorization code is invalid or expired");
      if (row.redirectUri !== redirectUri) throw new OAuthError("invalid_grant", "redirect_uri mismatch");
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !verifyPkce(verifier, row.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE verification failed");
      await tx.update(oauthCodes).set({ usedAt: new Date() }).where(eq(oauthCodes.id, row.id));
      const t = await issueTokens(tx, row.orgId, clientId, client.clientName, row.userId);
      await audit(tx, { orgId: row.orgId, actor: { kind: "human", userId: row.userId, email: "", role: "admin" } }, { action: "mcp.oauth_token", entityType: "oauth_client", changes: { clientId, grant } });
      return t;
    });
  }

  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token") ?? "";
    return withSystemTx(async (tx) => {
      const [row] = await tx.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, sha256(refresh)));
      if (!row || row.clientId !== clientId || row.revokedAt || row.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Refresh token is invalid, expired or revoked");
      // Rotate: revoke the old refresh token and its access token, issue new ones in the same response.
      await tx.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(eq(oauthRefreshTokens.id, row.id));
      if (row.accessTokenId) await tx.update(mcpTokens).set({ revokedAt: new Date() }).where(eq(mcpTokens.id, row.accessTokenId));
      return issueTokens(tx, row.orgId, clientId, client.clientName, row.userId);
    });
  }
  throw new OAuthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported");
}
