import { randomBytes } from "node:crypto";

/** Header values come partly from inbound email (subject, Message-ID): never let CR/LF start a new header. */
function oneLine(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeader(v: string): string {
  // RFC 2047 encoded-word for non-ASCII (₹, –, names in other scripts)
  const s = oneLine(v);
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** "Name <email>" with the display name quoted or encoded (commas, quotes and non-ASCII are safe). */
export function formatAddress(email: string, name?: string | null): string {
  const n = name ? oneLine(name) : "";
  if (!n) return oneLine(email);
  const display = /^[\x20-\x7e]*$/.test(n) ? `"${n.replace(/["\\]/g, "\\$&")}"` : encodeHeader(n);
  return `${display} <${oneLine(email)}>`;
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
    p.from ? `From: ${oneLine(p.from)}` : null,
    p.to ? `To: ${oneLine(p.to)}` : null,
    `Subject: ${encodeHeader(p.subject)}`,
    p.inReplyTo ? `In-Reply-To: ${oneLine(p.inReplyTo)}` : null,
    p.references || p.inReplyTo ? `References: ${oneLine(p.references ?? p.inReplyTo ?? "")}` : null,
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
