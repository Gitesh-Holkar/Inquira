import { AppError } from "@/lib/errors";

/**
 * Minimal Gmail REST client. Scopes (ADR-010): gmail.readonly (sync, signature via sendAs)
 * and gmail.compose (drafts.create). This client has NO method that sends mail — by design.
 */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GmailReauthRequired extends AppError {
  constructor(msg = "Gmail access was revoked or expired. Reconnect Gmail in Settings.") {
    super("INTEGRATION", msg);
  }
}
export class GmailHistoryExpired extends Error {}

export type GmailCredentials = { clientId: string; clientSecret: string; refreshToken: string };
type Fetch = typeof fetch;

export type GmailHeader = { name: string; value: string };
export type GmailPart = { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId: string; historyId?: string; internalDate?: string; labelIds?: string[]; snippet?: string; payload?: GmailPart };

export async function exchangeCode(p: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier?: string }, f: Fetch = fetch) {
  const body = new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, code: p.code, redirect_uri: p.redirectUri, grant_type: "authorization_code" });
  if (p.codeVerifier) body.set("code_verifier", p.codeVerifier);
  const res = await f(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new AppError("INTEGRATION", `Google token exchange failed: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

export class GmailClient {
  private accessToken: string | null = null;
  constructor(private creds: GmailCredentials, private f: Fetch = fetch) {}

  private async refresh() {
    const res = await this.f(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.creds.clientId, client_secret: this.creds.clientSecret, refresh_token: this.creds.refreshToken, grant_type: "refresh_token" }),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (json.error === "invalid_grant" || json.error === "unauthorized_client" || res.status === 401) throw new GmailReauthRequired();
    if (!res.ok || !json.access_token) throw new AppError("INTEGRATION", `Google token refresh failed: ${json.error_description ?? json.error ?? res.status}`);
    this.accessToken = json.access_token;
  }

  private async req<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    if (!this.accessToken) await this.refresh();
    const res = await this.f(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.accessToken}` } });
    if (res.status === 401 && attempt === 0) {
      this.accessToken = null;
      return this.req<T>(path, init, 1);
    }
    if (res.status === 401 || res.status === 403) {
      const t = await res.text();
      if (/insufficient|scope|revoked|invalid_grant|unauthorized/i.test(t) || res.status === 401) throw new GmailReauthRequired();
      throw new AppError("INTEGRATION", `Gmail API ${res.status}: ${t.slice(0, 200)}`);
    }
    if (res.status === 404 && path.startsWith("/history")) throw new GmailHistoryExpired();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      return this.req<T>(path, init, attempt + 1);
    }
    if (!res.ok) throw new AppError("INTEGRATION", `Gmail API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  getProfile() {
    return this.req<{ emailAddress: string; historyId: string; messagesTotal?: number }>("/profile");
  }

  listMessages(q: string, pageToken?: string, maxResults = 100) {
    const p = new URLSearchParams({ q, maxResults: String(maxResults), includeSpamTrash: "false" });
    if (pageToken) p.set("pageToken", pageToken);
    return this.req<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(`/messages?${p}`);
  }

  listHistory(startHistoryId: string, pageToken?: string) {
    const p = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
    if (pageToken) p.set("pageToken", pageToken);
    return this.req<{ history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[]; nextPageToken?: string; historyId: string }>(`/history?${p}`);
  }

  getMessage(id: string) {
    return this.req<GmailMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
  }

  listSendAs() {
    return this.req<{ sendAs: { sendAsEmail: string; displayName?: string; signature?: string; isDefault?: boolean; isPrimary?: boolean }[] }>("/settings/sendAs");
  }

  /** Creates a DRAFT only. A human reviews and clicks Send in Gmail. */
  createDraft(rawRfc822: string, threadId?: string | null) {
    const raw = Buffer.from(rawRfc822, "utf8").toString("base64url");
    return this.req<{ id: string; message: { id: string; threadId: string } }>("/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: threadId ? { raw, threadId } : { raw } }),
    });
  }
}

// ---------- MIME helpers ----------

export function header(msg: GmailMessage, name: string): string | null {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decode(data?: string): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

export function extractBodies(part: GmailPart | undefined): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;
  const walk = (p?: GmailPart) => {
    if (!p) return;
    if (p.filename) return; // attachments
    if (p.mimeType === "text/plain" && text === null) text = decode(p.body?.data);
    else if (p.mimeType === "text/html" && html === null) html = decode(p.body?.data);
    p.parts?.forEach(walk);
  };
  walk(part);
  return { text, html };
}

export function parseAddressList(v: string | null): string[] {
  if (!v) return [];
  return [...v.matchAll(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0].toLowerCase());
}

export function parseFrom(v: string | null): { email: string | null; name: string | null } {
  if (!v) return { email: null, name: null };
  const email = v.match(/<([^>]+)>/)?.[1] ?? v.match(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? null;
  const name = v.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || null;
  return { email: email?.toLowerCase() ?? null, name: name && name !== email ? name : null };
}

export function gmailDraftUrl(accountEmail: string | null, draftMessageId: string) {
  const auth = accountEmail ? `?authuser=${encodeURIComponent(accountEmail)}` : "";
  return `https://mail.google.com/mail/${auth}#drafts?compose=${encodeURIComponent(draftMessageId)}`;
}

export function gmailThreadUrl(accountEmail: string | null, threadId: string) {
  const auth = accountEmail ? `?authuser=${encodeURIComponent(accountEmail)}` : "";
  return `https://mail.google.com/mail/${auth}#all/${encodeURIComponent(threadId)}`;
}
