import { z } from "zod";

/** GOAL G-OUT-1. */
export const MESSAGE_STATES = ["draft", "held", "approved", "sent", "failed", "cancelled"] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

export const CHANNELS = ["email", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];

/** What a message is for. Template purposes (G-TPL-1) plus `reply` (written by AI or Claude) and the owner's daily summary. */
export const MESSAGE_PURPOSES = [
  "first_quotation", "detailed_quotation", "document_share", "sample_request", "below_moq", "follow_up", "international_ack", "reply", "daily_summary",
] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export const PURPOSE_LABELS: Record<MessagePurpose, string> = {
  first_quotation: "First quotation",
  detailed_quotation: "Detailed quotation",
  document_share: "Documents",
  sample_request: "Sample reply",
  below_moq: "Below-MOQ reply",
  follow_up: "Follow-up",
  international_ack: "International acknowledgement",
  reply: "Reply (written by AI or Claude)",
  daily_summary: "Daily summary",
};

export const STATE_LABELS: Record<MessageState, string> = {
  draft: "Ready for a person",
  held: "Held",
  approved: "Waiting to send",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * GOAL G-OUT-3. shadow: a person sends everything. assisted: first quotations that pass every rule are sent
 * automatically. automatic: also document replies and follow-ups. WhatsApp has no sending API yet (G-OUT-8),
 * so a person always taps it, whatever the mode.
 */
export const MODES = ["shadow", "assisted", "automatic"] as const;
export type Mode = (typeof MODES)[number];
export const AUTO_PURPOSES: Record<Mode, MessagePurpose[]> = {
  shadow: [],
  assisted: ["first_quotation"],
  automatic: ["first_quotation", "document_share", "follow_up"],
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00");

/**
 * Sending settings, stored in org_settings.outbound. The defaults are the safe ones: shadow mode, paused
 * off but irrelevant in shadow, a 09:00–19:00 Monday–Saturday window and small caps (G-OUT-4 example).
 */
export const outboundSettingsSchema = z.object({
  modes: z.object({ email: z.enum(MODES).default("shadow") }).default({ email: "shadow" }),
  paused: z.boolean().default(false),
  window: z.object({
    start: time.default("09:00"),
    end: time.default("19:00"),
    /** 0 = Sunday … 6 = Saturday, in IST. */
    days: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5, 6]),
  }).default({ start: "09:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] }),
  caps: z.object({
    perHour: z.number().int().min(0).max(500).default(10),
    perDay: z.number().int().min(0).max(5000).default(40),
  }).default({ perHour: 10, perDay: 40 }),
  /** Days without a reply before a follow-up is prepared (G-FUP-1); 0 = no follow-ups. */
  followUpDays: z.number().int().min(0).max(60).default(3),
  /** Daily summary to the owner by email (G-RPT-2). */
  dailySummary: z.object({
    enabled: z.boolean().default(false),
    /** Recipients; empty = every owner of the company. */
    to: z.array(z.string().email()).max(5).default([]),
  }).default({ enabled: false, to: [] }),
});
export type OutboundSettings = z.output<typeof outboundSettingsSchema>;

export function readOutboundSettings(raw: unknown): OutboundSettings {
  const r = outboundSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : outboundSettingsSchema.parse({});
}

export const RULE_MATCH_TYPES = ["buyer_email", "buyer_domain", "buyer_phone", "product", "text_contains"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];
