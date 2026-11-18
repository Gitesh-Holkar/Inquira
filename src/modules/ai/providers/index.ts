import type { AiProviderId } from "../types";
import { anthropic } from "./anthropic";
import { gemini } from "./gemini";
import { openaiCompatible } from "./openai-compatible";
import type { ProviderAdapter } from "./types";

/** Provider id → adapter. Register a new provider here (and add its id to AI_PROVIDERS). */
export const PROVIDERS: Record<AiProviderId, ProviderAdapter> = {
  gemini,
  anthropic,
  openai_compatible: openaiCompatible,
};

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  gemini: gemini.label,
  anthropic: anthropic.label,
  openai_compatible: openaiCompatible.label,
};
