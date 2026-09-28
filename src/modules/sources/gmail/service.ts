import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { withSystemTx } from "@/db/client";
import { randomToken, safeEqual, sha256 } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { AppError, publicMessage } from "@/lib/errors";
import { emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import type { Ctx } from "@/modules/core/types";
import {
  enqueueJobInternal, finishSyncRunInternal, getIntegrationInternal, readSecretsInternal, recordIntegrationFailure,
  recordIntegrationSuccess, startSyncRunInternal, updateIntegrationInternal, writeSecretsInternal, type Integration,
} from "@/modules/core/service";
import { ingestMessageInternal } from "@/modules/email/service";
import type { IngestMessage } from "@/modules/email/types";
import { emptyStats, type SyncStats } from "../types";
import {
  exchangeCode, extractBodies, GMAIL_SCOPES, GmailClient, GmailHistoryExpired, GmailReauthRequired, header, parseAddressList, parseFrom,
  type GmailCredentials, type GmailMessage,
} from "./client";

export type GmailSecrets = { clientId?: string; clientSecret?: string; refreshToken?: string; pendingVerifier?: string };
export type GmailCursor = { historyId?: string; backlog?: string[]; lastFullSyncAt?: string };

export const gmailRedirectUri = () => `${appUrl()}/api/integrations/gmail/callback`;

export const saveGmailClient = defineService({
  name: "gmail.saveClient",
  input: z.object({
    clientId: z.string().trim().regex(/\.apps\.googleusercontent\.com$/, "Client ID ends with .apps.googleusercontent.com"),
    clientSecret: z.string().trim().min(10).max(200),
  }),
  permission: "integrations.manage",
  handler: async (ctx, input, tx) => {
    const integ = await getIntegrationInternal(tx, ctx.orgId, "gmail");
    await writeSecretsInternal(tx, ctx, integ, { clientId: input.clientId, clientSecret: input.clientSecret });
    await updateIntegrationInternal(tx, ctx, integ.id, {
      status: integ.status === "connected" ? "connected" : "configured",
      config: { ...integ.config, clientIdSuffix: input.clientId.slice(0, 12) + "…" },
    }, "integration.configure");
    return { ok: true, redirectUri: gmailRedirectUri() };
  },
});

/** Returns the Google consent URL. state is single-use, hashed at rest, and bound to this user + 10 minutes. */
export const startGmailConnect = defineService({
  name: "gmail.startConnect",
  input: z.object({}).default({}),
  permission: "integrations.manage",
  handler: async (ctx, _i, tx) => {
    const integ = await getIntegrationInternal(tx, ctx.orgId, "gmail");
    const secrets = await readSecretsInternal<GmailSecrets>(tx, integ.id);
    if (!secrets?.clientId || !secrets.clientSecret) throw new AppError("VALIDATION", "Save the Google OAuth Client ID and Secret first.");
    const state = `${ctx.orgId}.${randomToken("st")}`;
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await writeSecretsInternal(tx, ctx, integ, { pendingVerifier: verifier });
    await updateIntegrationInternal(tx, ctx, integ.id, {
      config: { ...integ.config, oauthStateHash: sha256(state), oauthStateExpires: Date.now() + 10 * 60_000, oauthStateUser: ctx.actor.kind === "human" ? ctx.actor.userId : null },
    });
    const p = new URLSearchParams({
      client_id: secrets.clientId, redirect_uri: gmailRedirectUri(), response_type: "code", scope: GMAIL_SCOPES.join(" "),
      access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, code_challenge: challenge, code_challenge_method: "S256",
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` };
  },
});

export function orgIdFromState(state: string): string | null {
  const id = state.split(".")[0];
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

export const completeGmailConnect = defineService({
  name: "gmail.completeConnect",
  input: z.object({ code: z.string().min(5).max(2000), state: z.string().min(10).max(300) }),
  permission: "integrations.manage",
  handler: async (ctx, input) => completeConnectInternal(ctx, input),
});

export async function completeConnectInternal(ctx: Ctx, input: { code: string; state: string }, f: typeof fetch = fetch) {
  const { integ, secrets } = await withSystemTx(async (tx) => {
    const integ = await getIntegrationInternal(tx, ctx.orgId, "gmail");
    return { integ, secrets: await readSecretsInternal<GmailSecrets>(tx, integ.id) };
  });
  const cfg = integ.config as { oauthStateHash?: string; oauthStateExpires?: number; oauthStateUser?: string | null };
  if (!cfg.oauthStateHash || !safeEqual(cfg.oauthStateHash, sha256(input.state)) || (cfg.oauthStateExpires ?? 0) < Date.now()) {
    throw new AppError("VALIDATION", "This Gmail connection link has expired. Click Connect Gmail again.");
  }
  if (ctx.actor.kind === "human" && cfg.oauthStateUser && cfg.oauthStateUser !== ctx.actor.userId) throw new AppError("FORBIDDEN", "Connection was started by another user.");
  if (!secrets?.clientId || !secrets.clientSecret) throw new AppError("VALIDATION", "Google OAuth client is not configured.");

  const tok = await exchangeCode({ clientId: secrets.clientId, clientSecret: secrets.clientSecret, code: input.code, redirectUri: gmailRedirectUri(), codeVerifier: secrets.pendingVerifier }, f);
  const granted = (tok.scope ?? "").split(/\s+/);
  const missing = GMAIL_SCOPES.filter((s) => !granted.includes(s));
  if (missing.length) throw new AppError("VALIDATION", `Please tick all permissions on Google's consent screen (missing: ${missing.map((s) => s.split("/").pop()).join(", ")}).`);
  const refreshToken = tok.refresh_token ?? secrets.refreshToken;
  if (!refreshToken) throw new AppError("INTEGRATION", "Google did not return a refresh token. Remove Inquira from https://myaccount.google.com/permissions and connect again.");

  const client = new GmailClient({ clientId: secrets.clientId, clientSecret: secrets.clientSecret, refreshToken }, f);
  const profile = await client.getProfile();
  const sendAs = await client.listSendAs().catch(() => ({ sendAs: [] }));
  const own = [...new Set([profile.emailAddress, ...sendAs.sendAs.map((s) => s.sendAsEmail)].map((e) => e.toLowerCase()))];

  await withSystemTx(async (tx) => {
    await writeSecretsInternal(tx, ctx, integ, { refreshToken, pendingVerifier: null });
    const { oauthStateHash: _h, oauthStateExpires: _e, oauthStateUser: _u, ...restCfg } = integ.config as Record<string, unknown>;
    await updateIntegrationInternal(tx, ctx, integ.id, {
      status: "connected", accountEmail: profile.emailAddress.toLowerCase(), config: { ...restCfg, ownAddresses: own, scopes: granted },
      lastError: null, consecutiveFailures: 0, backoffUntil: null,
      // Switching mailbox → start fresh.
      cursor: integ.accountEmail && integ.accountEmail !== profile.emailAddress.toLowerCase() ? {} : integ.cursor,
    }, "integration.connect");
    await emit(tx, ctx, { type: "integration.connected", entityType: "integration", entityId: integ.id, payload: { provider: "gmail", account: profile.emailAddress } });
    await enqueueJobInternal(tx, ctx, { type: "gmail.sync", dedupeKey: "gmail.sync" });
  });
  return { accountEmail: profile.emailAddress };
}

export const disconnectGmail = defineService({
  name: "gmail.disconnect",
  input: z.object({}).default({}),
  permission: "integrations.manage",
  handler: async (ctx, _i, tx) => {
    const integ = await getIntegrationInternal(tx, ctx.orgId, "gmail");
    const secrets = await readSecretsInternal<GmailSecrets>(tx, integ.id);
    if (secrets?.refreshToken) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(secrets.refreshToken)}`, { method: "POST" }).catch(() => undefined);
    }
    await writeSecretsInternal(tx, ctx, integ, { refreshToken: null });
    await updateIntegrationInternal(tx, ctx, integ.id, { status: secrets?.clientId ? "configured" : "not_connected", accountEmail: null, cursor: {} }, "integration.disconnect");
    await emit(tx, ctx, { type: "integration.disconnected", entityType: "integration", entityId: integ.id, payload: { provider: "gmail" } });
    return { ok: true };
  },
});

/** For quote drafts and sync: a ready client, or a clear error telling the user to (re)connect. */
export async function gmailClientFor(ctx: Ctx, f: typeof fetch = fetch): Promise<{ client: GmailClient; integ: Integration }> {
  return withSystemTx(async (tx) => {
    const integ = await getIntegrationInternal(tx, ctx.orgId, "gmail");
    const s = await readSecretsInternal<GmailSecrets>(tx, integ.id);
    if (!s?.clientId || !s.clientSecret || !s.refreshToken) throw new AppError("INTEGRATION", "Gmail is not connected. Connect it in Settings → Integrations.");
    if (integ.status === "reauth_required") throw new GmailReauthRequired();
    return { client: new GmailClient(s as GmailCredentials, f), integ };
  });
}

export function toIngestMessage(msg: GmailMessage): IngestMessage {
  const { text, html } = extractBodies(msg.payload);
  const from = parseFrom(header(msg, "From"));
  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers ?? []) headers[h.name] = h.value;
  const dateHeader = header(msg, "Date");
  const received = msg.internalDate ? new Date(Number(msg.internalDate)) : dateHeader ? new Date(dateHeader) : new Date();
  return {
    gmailMessageId: msg.id, gmailThreadId: msg.threadId, historyId: msg.historyId ?? null, rfcMessageId: header(msg, "Message-ID") ?? header(msg, "Message-Id"),
    fromEmail: from.email, fromName: from.name, toEmails: parseAddressList(header(msg, "To")), ccEmails: parseAddressList(header(msg, "Cc")),
    subject: header(msg, "Subject") ?? "(no subject)", snippet: msg.snippet ?? null, text, html, labelIds: msg.labelIds ?? [], headers, receivedAt: received,
  };
}

const BACKFILL_DAYS = 14;
const MAX_PER_RUN = 150;

/**
 * Incremental Gmail sync using historyId; falls back to a date-based resync when the
 * history id has expired (Gmail keeps ~1 week). Messages beyond MAX_PER_RUN are kept in
 * cursor.backlog and processed next run, so every message is eventually stored.
 */
export async function syncGmail(ctx: Ctx, opts: { fetchImpl?: typeof fetch; maxPerRun?: number; now?: Date } = {}): Promise<SyncStats & { skipped?: string }> {
  const now = opts.now ?? new Date();
  const max = opts.maxPerRun ?? MAX_PER_RUN;
  let clientInfo: Awaited<ReturnType<typeof gmailClientFor>>;
  try {
    clientInfo = await gmailClientFor(ctx, opts.fetchImpl);
  } catch (e) {
    return { ...emptyStats(), skipped: publicMessage(e).message };
  }
  const { client, integ } = clientInfo;
  if (!integ.enabled) return { ...emptyStats(), skipped: "disabled" };
  if (integ.backoffUntil && integ.backoffUntil > now) return { ...emptyStats(), skipped: `backing off until ${integ.backoffUntil.toISOString()}` };

  const cursor = (integ.cursor ?? {}) as GmailCursor;
  const kind = cursor.historyId ? "incremental" : "backfill";
  const run = await withSystemTx((tx) => startSyncRunInternal(tx, ctx, "gmail", kind));
  const stats = emptyStats();
  const own = (integ.config as { ownAddresses?: string[] }).ownAddresses ?? (integ.accountEmail ? [integ.accountEmail] : []);
  try {
    const profile = await client.getProfile();
    const ids: string[] = [...(cursor.backlog ?? [])];
    let resync = false;
    if (cursor.historyId) {
      try {
        let pageToken: string | undefined;
        do {
          const h = await client.listHistory(cursor.historyId, pageToken);
          for (const rec of h.history ?? []) for (const a of rec.messagesAdded ?? []) {
            if (!a.message.labelIds?.includes("DRAFT")) ids.push(a.message.id);
          }
          pageToken = h.nextPageToken;
        } while (pageToken);
      } catch (e) {
        if (!(e instanceof GmailHistoryExpired)) throw e;
        resync = true;
      }
    }
    if (!cursor.historyId || resync) {
      const since = resync && integ.lastSuccessAt ? new Date(integ.lastSuccessAt.getTime() - 86400_000) : new Date(now.getTime() - BACKFILL_DAYS * 86400_000);
      let pageToken: string | undefined;
      do {
        const l = await client.listMessages(`after:${Math.floor(since.getTime() / 1000)} -in:drafts`, pageToken);
        ids.push(...(l.messages ?? []).map((m) => m.id));
        pageToken = l.nextPageToken;
      } while (pageToken && ids.length < 5000);
    }
    const unique = [...new Set(ids)];
    const now_ = unique.slice(0, max);
    const later = unique.slice(max);
    for (const id of now_) {
      try {
        const msg = await client.getMessage(id);
        stats.fetched++;
        const r = await withSystemTx((tx) => ingestMessageInternal(tx, ctx, toIngestMessage(msg), { ownAddresses: own }));
        if (r.duplicate) stats.duplicates++;
        else if (r.leadCreated) stats.created++;
      } catch (e) {
        if (e instanceof GmailReauthRequired) throw e;
        stats.errors++;
        stats.errorMessages.push(`${id}: ${(e as Error).message.slice(0, 200)}`);
        later.push(id); // retry next run
      }
    }
    const nextCursor: GmailCursor = { historyId: profile.historyId, backlog: later.slice(0, 5000), lastFullSyncAt: resync || !cursor.historyId ? now.toISOString() : cursor.lastFullSyncAt };
    await withSystemTx(async (tx) => {
      await finishSyncRunInternal(tx, run.id, { status: stats.errors ? "partial" : "ok", fetched: stats.fetched, created: stats.created, duplicates: stats.duplicates, errors: stats.errors, errorMessage: stats.errorMessages.slice(0, 3).join("; ") || null, meta: { resync, backlog: later.length } });
      await recordIntegrationSuccess(tx, ctx, integ, { cursor: nextCursor, lastError: null });
      await emit(tx, ctx, { type: "sync.completed", entityType: "integration", entityId: integ.id, payload: { provider: "gmail", fetched: stats.fetched, created: stats.created, errors: stats.errors, resync } });
      if (later.length) await enqueueJobInternal(tx, ctx, { type: "gmail.sync", dedupeKey: "gmail.sync" });
    });
    return stats;
  } catch (e) {
    const reauth = e instanceof GmailReauthRequired;
    const msg = reauth ? (e as Error).message : (e as Error).message.slice(0, 300);
    await withSystemTx(async (tx) => {
      await finishSyncRunInternal(tx, run.id, { status: "error", fetched: stats.fetched, created: stats.created, duplicates: stats.duplicates, errors: stats.errors + 1, errorMessage: msg });
      await recordIntegrationFailure(tx, ctx, integ, msg, { reauth });
    });
    return { ...stats, errors: stats.errors + 1, errorMessages: [...stats.errorMessages, msg] };
  }
}
