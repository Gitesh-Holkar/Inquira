/**
 * The one interface every AI provider adapter implements (GOAL G-AI-1). An adapter turns a request
 * into one HTTPS call and returns the model's text; it never decides anything. Adding a provider is
 * one new file in this folder plus one line in `index.ts`.
 */

/** A JSON Schema object. Kept to the subset every provider accepts: no min/max, no string lengths. */
export type JsonSchema = Record<string, unknown>;

export type AiRequest = {
  system: string;
  user: string;
  /** The reply must be a JSON object matching this schema; code validates it again with zod. */
  schema: JsonSchema;
  maxOutputTokens: number;
};

export type AiResponse = { text: string; inputTokens: number | null; outputTokens: number | null };

/**
 * rate_limited  429, or a quota or spend limit
 * unavailable   408, 5xx, overloaded
 * network       no answer (timeout, DNS, connection refused)
 * auth          the key was refused (401, 403)
 * bad_request   the provider rejected the request (often a wrong model name)
 * refused       the model declined, or safety filters blocked the reply
 * truncated     the reply hit the output limit before it finished
 */
export type AiErrorKind = "rate_limited" | "unavailable" | "network" | "auth" | "bad_request" | "refused" | "truncated";

export class AiProviderError extends Error {
  constructor(public readonly kind: AiErrorKind, message: string, public readonly status?: number) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AiProvider {
  complete(req: AiRequest): Promise<AiResponse>;
}

export type ProviderConfig = {
  model: string;
  apiKey: string;
  baseUrl: string | null;
  fetch: typeof fetch;
  timeoutMs: number;
};

export type ProviderAdapter = {
  id: string;
  label: string;
  /** True when the company must enter the address (the OpenAI-compatible adapter). */
  needsBaseUrl: boolean;
  create(cfg: ProviderConfig): AiProvider;
};

/**
 * POSTs JSON and maps failures to AiProviderError. The key is sent only in the headers the adapter
 * passes and is scrubbed from any error text, so it never reaches logs, audit rows or the browser.
 */
export async function postJson(cfg: ProviderConfig, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const scrub = (s: string) => (cfg.apiKey ? s.split(cfg.apiKey).join("***") : s).slice(0, 300);
  let res: Response;
  try {
    res = await cfg.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (e) {
    throw new AiProviderError("network", scrub(`No answer from the provider (${e instanceof Error ? e.name : "error"})`));
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const detail = scrub(providerMessage(text) ?? res.statusText ?? "");
    const kind: AiErrorKind =
      res.status === 401 || res.status === 403 ? "auth"
      : res.status === 429 || res.status === 402 ? "rate_limited"
      : res.status === 408 || res.status >= 500 ? "unavailable"
      : "bad_request";
    throw new AiProviderError(kind, `Provider answered ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiProviderError("unavailable", "The provider's answer was not JSON");
  }
}

/** The human-readable part of a provider error body, when there is one. */
function providerMessage(text: string): string | null {
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    if (typeof j.error === "string") return j.error;
    if (j.error && typeof j.error.message === "string") return j.error.message;
    if (typeof j.message === "string") return j.message;
  } catch {
    /* not JSON */
  }
  return null;
}

export const trimSlash = (u: string) => u.replace(/\/+$/, "");
