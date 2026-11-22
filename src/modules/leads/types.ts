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

/** What the buyer wants (GOAL G-UND-3). Set by rules, else by AI, else left empty for review. */
export const LEAD_INTENTS = [
  "new_enquiry", "document_request", "sample_request", "price_negotiation", "order", "complaint", "not_buyer", "other",
] as const;
export type LeadIntent = (typeof LEAD_INTENTS)[number];

export const INTENT_LABELS: Record<LeadIntent, string> = {
  new_enquiry: "New enquiry",
  document_request: "Document request",
  sample_request: "Sample request",
  price_negotiation: "Price negotiation",
  order: "Order / PO",
  complaint: "Complaint",
  not_buyer: "Not a buyer",
  other: "Other",
};

/**
 * Who filled product, intent and quantity on a lead: `alias`, `rule:<name>`, `ai:basic`, `ai:advanced`,
 * `mcp:<token>` or `human:<id>`. Shown on the lead so a person can see what to check.
 */
export type LeadFilledBy = { product?: string; intent?: string; quantity?: string };

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
  intent: z.enum(LEAD_INTENTS).optional(),
  /** Leads the rules and AI could not complete: no product or no intent (the review queue, G-AI-6). */
  needsDetails: z.boolean().optional(),
  /** "score": best leads first (G-UND-6); default newest first. */
  sort: z.enum(["newest", "score"]).default("newest"),
  minScore: z.number().int().min(0).max(100).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export type ListLeadsInput = z.input<typeof listLeadsInput>;
