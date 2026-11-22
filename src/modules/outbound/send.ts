/**
 * The ONLY code that sends email (AGENTS rule 4, ADR-032). Called by the outbound service after a message was
 * approved, by a person or by the pipeline within its mode, window, caps and pause switch. Builds the email the
 * same way as a quotation draft: the mailbox's own Gmail signature (G-TPL-2), the buyer's thread when there is
 * one, and the recorded documents. Network calls only; the caller records the result in its own transaction.
 * `tests/outbound.test.ts` fails if any other file calls `sendMessage`.
 */
import { withSystemTx } from "@/db/client";
import type { Ctx } from "@/modules/core/types";
import { getMessageMetaInternal } from "@/modules/email/service";
import { htmlToText } from "@/modules/email/parsers/text";
import { gmailClientFor } from "@/modules/sources/gmail/service";
import { documentFilesInternal, documentsByIdsInternal } from "@/modules/documents/service";
import type { FileStore } from "@/modules/documents/storage";
import { bodyToHtml, buildMime, formatAddress, type MimeAttachment } from "@/modules/quotes/mime";
import type { outgoingMessages } from "./schema";

export type SendDeps = { fetchImpl?: typeof fetch; store?: FileStore | null };
type Message = typeof outgoingMessages.$inferSelect;

/** Total size of attached files; Gmail's JSON send accepts about 5 MB of encoded message. */
const MAX_ATTACHMENT_BYTES = 3_500_000;

export async function sendEmailInternal(ctx: Ctx, m: Message, deps: SendDeps = {}): Promise<{ gmailMessageId: string; threadId: string; attached: string[] }> {
  if (!m.toAddress) throw new Error("The message has no recipient");
  const { client } = await gmailClientFor(ctx, deps.fetchImpl);
  const sendAs = await client.listSendAs();
  const primary = sendAs.sendAs.find((s) => s.isDefault) ?? sendAs.sendAs.find((s) => s.isPrimary) ?? sendAs.sendAs[0];
  const signatureHtml = primary?.signature?.trim() || null;
  const { original, docs } = await withSystemTx(async (tx) => ({
    original: m.inReplyToMessageId ? await getMessageMetaInternal(tx, ctx.orgId, m.inReplyToMessageId) : null,
    docs: await documentsByIdsInternal(tx, ctx.orgId, m.documentIds),
  }));
  const files = await documentFilesInternal(docs, { store: deps.store });
  const attachments: MimeAttachment[] = [];
  let total = 0;
  for (const f of files) {
    total += f.data.byteLength;
    if (total > MAX_ATTACHMENT_BYTES) throw new Error(`The attachments are larger than ${Math.round(MAX_ATTACHMENT_BYTES / 1_000_000)} MB together; send this one from Gmail`);
    attachments.push({ fileName: f.document.fileName, contentType: f.document.contentType, data: f.data });
  }
  const subject = original?.subject ? (/^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`) : (m.subject ?? "");
  const mime = buildMime({
    from: primary ? formatAddress(primary.sendAsEmail, primary.displayName) : null,
    to: m.toAddress,
    subject,
    text: signatureHtml ? `${m.body}\n\n-- \n${htmlToText(signatureHtml)}` : m.body,
    html: bodyToHtml(m.body, signatureHtml),
    inReplyTo: original?.rfcMessageId ?? null,
    references: original?.rfcMessageId ? [original.references, original.rfcMessageId].filter(Boolean).join(" ") : null,
    attachments,
  });
  const sent = await client.sendMessage(mime, m.gmailThreadId);
  return { gmailMessageId: sent.id, threadId: sent.threadId, attached: attachments.map((a) => a.fileName) };
}
