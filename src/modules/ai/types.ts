import type { LeadIntent } from "@/modules/leads/types";

/**
 * The two AI tiers Inquira calls itself (GOAL section 3). The third, the Claude connector, is the
 * MCP server and needs no settings here.
 *  - basic:    finds the product when aliases fail, fills intent and quantity. Input is redacted (G-AI-4).
 *  - advanced: everything basic does, plus classifying review emails.
 */
export const AI_TIERS = ["basic", "advanced"] as const;
export type AiTier = (typeof AI_TIERS)[number];

export const AI_PROVIDERS = ["gemini", "anthropic", "openai_compatible"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

/** Each tier is stored as an integration row (non-secret config) with its key in integration_secrets. */
export const TIER_INTEGRATION = { basic: "ai_basic", advanced: "ai_advanced" } as const satisfies Record<AiTier, string>;

/** Per-company settings for one tier (G-AI-2). Model names are always settings, never constants. */
export type AiTierConfig = {
  provider: AiProviderId;
  model: string;
  /** Only needed for the OpenAI-compatible adapter, or to point another adapter at a proxy. */
  baseUrl: string | null;
  /** 0–1. A field is changed only when the model's confidence is at least this. */
  threshold: number;
  /** Calls per day (IST), counted by Inquira (G-AI-7). */
  dailyLimit: number;
};

/** Defaults offered when a tier is first set up; the company changes them in Settings → AI. */
export const AI_DEFAULTS = {
  threshold: 0.8,
  dailyLimit: { basic: 200, advanced: 50 } satisfies Record<AiTier, number>,
} as const;

/** What a decision was about. One model call can produce several decisions (product, intent, quantity). */
export const AI_TASKS = ["lead.product", "lead.intent", "lead.quantity", "email.classify"] as const;
export type AiTask = (typeof AI_TASKS)[number];

/**
 * applied        the value was written (audit actor ai:<tier>)
 * not_confident  below the threshold, or the model said it does not know
 * invalid        the reply failed the schema or named something that does not exist
 * error          the provider failed (rate limit, quota, network, key); the item moved on
 */
export const AI_OUTCOMES = ["applied", "not_confident", "invalid", "error"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

export type LeadUnderstandingField = "product" | "intent" | "quantity";

export type LeadUnderstanding = {
  product: { productId: string; name: string } | null;
  intent: LeadIntent | null;
  quantityKg: number | null;
};
