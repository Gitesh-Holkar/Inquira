import { z } from "zod";

export const LEAD_STATUSES = ["new", "contacted", "quoted", "negotiating", "won", "lost", "not_relevant"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_SOURCES = ["tradeindia", "indiamart", "gmail", "manual"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  not_relevant: "Not relevant",
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  tradeindia: "TradeIndia",
  indiamart: "IndiaMART",
  gmail: "Email",
  manual: "Manual",
};

/** The standard lead every source adapter normalises to (brief §6.4). */
export type NormalizedLead = {
  source: LeadSource;
  sourceRef: string;
  channel: string;
  contactName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  productText?: string | null;
  quantityText?: string | null;
  message?: string | null;
  rawPayload?: unknown;
  receivedAt: Date;
  isInternational?: boolean;
  gmailThreadId?: string | null;
  gmailMessageId?: string | null;
};

export const listLeadsInput = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  statuses: z.array(z.enum(LEAD_STATUSES)).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  productId: z.string().uuid().optional(),
  international: z.enum(["exclude", "only", "all"]).default("exclude"),
  q: z.string().trim().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export type ListLeadsInput = z.input<typeof listLeadsInput>;
