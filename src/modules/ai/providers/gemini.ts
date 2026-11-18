/**
 * Google Gemini (the default Basic tier: a free-tier key from Google AI Studio).
 * REST `POST {base}/models/{model}:generateContent` with the key in `x-goog-api-key`, as listed in
 * Google's Gemini API reference (checked 18 Nov 2026). JSON output uses `generationConfig.responseMimeType`
 * and `generationConfig.responseJsonSchema`. The reply text is `candidates[0].content.parts[].text`;
 * `usageMetadata.promptTokenCount` and `candidatesTokenCount` are the token counts.
 */
import { AiProviderError, postJson, trimSlash, type ProviderAdapter } from "./types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type GeminiReply = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

export const gemini: ProviderAdapter = {
  id: "gemini",
  label: "Google Gemini",
  needsBaseUrl: false,
  create: (cfg) => ({
    async complete(req) {
      const model = cfg.model.replace(/^models\//, "");
      const url = `${trimSlash(cfg.baseUrl ?? BASE_URL)}/models/${encodeURIComponent(model)}:generateContent`;
      const r = (await postJson(cfg, url, { "x-goog-api-key": cfg.apiKey }, {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: req.schema, maxOutputTokens: req.maxOutputTokens },
      })) as GeminiReply;
      if (r.promptFeedback?.blockReason) throw new AiProviderError("refused", `Gemini blocked the request (${r.promptFeedback.blockReason})`);
      const c = r.candidates?.[0];
      if (c?.finishReason === "MAX_TOKENS") throw new AiProviderError("truncated", "Gemini stopped at the output limit");
      if (c?.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(c.finishReason)) {
        throw new AiProviderError("refused", `Gemini stopped early (${c.finishReason})`);
      }
      const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      return { text, inputTokens: r.usageMetadata?.promptTokenCount ?? null, outputTokens: r.usageMetadata?.candidatesTokenCount ?? null };
    },
  }),
};
