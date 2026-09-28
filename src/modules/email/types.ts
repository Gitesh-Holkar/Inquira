/** A message as stored/ingested, independent of the Gmail API shape. */
export type IngestMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  historyId?: string | null;
  rfcMessageId?: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  snippet: string | null;
  text: string | null;
  html: string | null;
  labelIds: string[];
  headers: Record<string, string>;
  receivedAt: Date;
};

export const EMAIL_CLASSES = ["inquiry", "conversation", "ignored", "international", "needs_review"] as const;
export type EmailClass = (typeof EMAIL_CLASSES)[number];
