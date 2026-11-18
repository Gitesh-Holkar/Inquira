/**
 * Anthropic Claude API (the default Advanced tier). `POST {base}/v1/messages` with `x-api-key` and
 * `anthropic-version: 2026-10-21`; JSON output through `output_config.format` (`type: "json_schema"`).
 * The reply is the `text` blocks of `content`; `stop_reason` is checked first (`refusal`, `max_tokens`);
 * `usage.input_tokens` / `usage.output_tokens` are the token counts. Shapes from Anthropic's API reference.
 *
 * Plain HTTPS instead of the official SDK because the repository adds no dependency without the owner's
 * approval (AGENTS.md section 9); the SDK can replace this file alone if the owner approves it.
 */
import { AiProviderError, postJson, trimSlash, type ProviderAdapter } from "./types";

const BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2026-10-21";

type AnthropicReply = {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export const anthropic: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic Claude",
  needsBaseUrl: false,
  create: (cfg) => ({
    async complete(req) {
      const r = (await postJson(cfg, `${trimSlash(cfg.baseUrl ?? BASE_URL)}/v1/messages`, { "x-api-key": cfg.apiKey, "anthropic-version": API_VERSION }, {
        model: cfg.model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: { type: "json_schema", schema: req.schema } },
      })) as AnthropicReply;
      if (r.stop_reason === "refusal") throw new AiProviderError("refused", "Claude declined this request");
      if (r.stop_reason === "max_tokens") throw new AiProviderError("truncated", "Claude stopped at the output limit");
      const text = (r.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      return { text, inputTokens: r.usage?.input_tokens ?? null, outputTokens: r.usage?.output_tokens ?? null };
    },
  }),
};
