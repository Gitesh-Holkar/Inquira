import { randomBytes } from "node:crypto";

function encodeHeader(v: string): string {
  // RFC 2047 encoded-word for non-ASCII (₹, –, names in other scripts)
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function b64lines(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Builds an RFC 2822 multipart/alternative message for Gmail drafts.create (never sent by us). */
export function buildMime(p: {
  from?: string | null;
  to?: string | null;
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const boundary = `inq_${randomBytes(12).toString("hex")}`;
  const headers = [
    p.from ? `From: ${p.from}` : null,
    p.to ? `To: ${p.to}` : null,
    `Subject: ${encodeHeader(p.subject)}`,
    p.inReplyTo ? `In-Reply-To: ${p.inReplyTo}` : null,
    p.references || p.inReplyTo ? `References: ${p.references ?? p.inReplyTo}` : null,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  return [
    ...headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(p.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(p.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Plain body → simple HTML (escaped), then the Gmail signature HTML verbatim (it's the user's own). */
export function bodyToHtml(body: string, signatureHtml: string | null): string {
  const html = escapeHtml(body).split("\n").map((l) => (l.trim() ? l : "")).join("<br>\n");
  return `<div dir="ltr">${html}${signatureHtml ? `<br><br>\n<div class="gmail_signature">${signatureHtml}</div>` : ""}</div>`;
}
