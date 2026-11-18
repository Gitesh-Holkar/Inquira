/**
 * Any provider that speaks the OpenAI chat-completions format (OpenAI itself, OpenRouter, Groq, a local
 * model server, …). The company enters the address, for example `https://api.openai.com/v1`.
 * `POST {base}/chat/completions` with `Authorization: Bearer <key>`, `response_format: {type: "json_object"}`;
 * the reply is `choices[0].message.content`, `usage.prompt_tokens` / `usage.completion_tokens` the counts.
 * JSON mode does not carry the schema, so the prompt states it and code validates the reply.
 */
import { AiProviderError, postJson, trimSlash, type ProviderAdapter } from "./types";

type ChatReply = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export const openaiCompatible: ProviderAdapter = {
  id: "openai_compatible",
  label: "OpenAI-compatible",
  needsBaseUrl: true,
  create: (cfg) => ({
    async complete(req) {
      if (!cfg.baseUrl) throw new AiProviderError("bad_request", "Enter the provider's address in Settings → AI");
      const r = (await postJson(cfg, `${trimSlash(cfg.baseUrl)}/chat/completions`, { authorization: `Bearer ${cfg.apiKey}` }, {
        model: cfg.model,
        messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
        response_format: { type: "json_object" },
      })) as ChatReply;
      const c = r.choices?.[0];
      if (c?.message?.refusal) throw new AiProviderError("refused", "The model declined this request");
      if (c?.finish_reason === "length") throw new AiProviderError("truncated", "The model stopped at the output limit");
      if (c?.finish_reason === "content_filter") throw new AiProviderError("refused", "The provider's filter blocked the reply");
      return { text: c?.message?.content ?? "", inputTokens: r.usage?.prompt_tokens ?? null, outputTokens: r.usage?.completion_tokens ?? null };
    },
  }),
};
