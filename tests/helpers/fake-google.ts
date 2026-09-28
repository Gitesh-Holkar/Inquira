import { readFileSync } from "node:fs";
import path from "node:path";
import type { GmailMessage } from "@/modules/sources/gmail/client";

type Fixture = { id: string; from: string; to: string[]; subject: string; date: string; text: string | null; html: string | null; headers?: Record<string, string>; labels?: string[] };

export function fixture(id: string): Fixture {
  return JSON.parse(readFileSync(path.join(process.cwd(), "fixtures/emails", `${id}.json`), "utf8"));
}

/** Turns an email fixture into a Gmail API "full" message. */
export function toGmailMessage(f: Fixture, over: { id?: string; threadId?: string; messageId?: string } = {}): GmailMessage {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const parts = [];
  if (f.text !== null) parts.push({ mimeType: "text/plain", body: { data: b64(f.text) } });
  if (f.html) parts.push({ mimeType: "text/html", body: { data: b64(f.html) } });
  const headers = [
    { name: "From", value: f.from }, { name: "To", value: f.to.join(", ") }, { name: "Subject", value: f.subject },
    { name: "Date", value: new Date(f.date).toUTCString() }, { name: "Message-ID", value: over.messageId ?? `<${f.id}@mail.example>` },
    ...Object.entries(f.headers ?? {}).map(([name, value]) => ({ name, value })),
  ];
  const id = over.id ?? f.id;
  return {
    id, threadId: over.threadId ?? `t-${id}`, historyId: "100", internalDate: String(new Date(f.date).getTime()), labelIds: f.labels ?? ["INBOX"],
    snippet: (f.text ?? "").slice(0, 100), payload: { mimeType: "multipart/alternative", headers, parts },
  };
}

export type FakeGoogle = {
  fetch: typeof fetch;
  calls: { url: string; method: string; body?: string }[];
  messages: Map<string, GmailMessage>;
  historyAdds: string[];
  drafts: { raw: string; threadId?: string }[];
  historyExpired: boolean;
  revoked: boolean;
};

export function fakeGoogle(opts: { messages?: GmailMessage[]; signature?: string } = {}): FakeGoogle {
  const state: FakeGoogle = {
    fetch: undefined as unknown as typeof fetch, calls: [], messages: new Map((opts.messages ?? []).map((m) => [m.id, m])),
    historyAdds: [], drafts: [], historyExpired: false, revoked: false,
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    state.calls.push({ url, method, body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : undefined });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      if (state.revoked) return json({ error: "invalid_grant" }, 400);
      return json({ access_token: "at", refresh_token: "rt", scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose", expires_in: 3600 });
    }
    const u = new URL(url);
    const p = u.pathname.replace("/gmail/v1/users/me", "");
    if (p === "/profile") return json({ emailAddress: "sales@seller.example", historyId: "200" });
    if (p === "/settings/sendAs") return json({ sendAs: [{ sendAsEmail: "sales@seller.example", displayName: "Seller Foods", isDefault: true, isPrimary: true, signature: opts.signature ?? "<b>With Regards</b><br>Seller Foods Pvt. Ltd.<br>+91 90000 00000" }] });
    if (p === "/messages" && method === "GET") return json({ messages: [...state.messages.values()].map((m) => ({ id: m.id, threadId: m.threadId })) });
    if (p.startsWith("/messages/")) {
      const m = state.messages.get(decodeURIComponent(p.split("/")[2]!));
      return m ? json(m) : json({ error: "nf" }, 404);
    }
    if (p === "/history") {
      if (state.historyExpired) return json({ error: { code: 404 } }, 404);
      return json({ historyId: "300", history: state.historyAdds.map((id) => ({ messagesAdded: [{ message: { id, threadId: `t-${id}` } }] })) });
    }
    if (p === "/drafts" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { message: { raw: string; threadId?: string } };
      state.drafts.push({ raw: Buffer.from(body.message.raw, "base64url").toString("utf8"), threadId: body.message.threadId });
      return json({ id: `d${state.drafts.length}`, message: { id: `m${state.drafts.length}`, threadId: body.message.threadId ?? `new-thread-${state.drafts.length}` } });
    }
    if (/\/(messages|drafts)\/send/.test(p)) throw new Error("SEND MUST NEVER BE CALLED");
    return json({ error: "unexpected " + url }, 500);
  }) as typeof fetch;
  return state;
}
