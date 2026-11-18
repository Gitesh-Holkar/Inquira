/**
 * A fake for the three AI providers (Gemini, Anthropic, OpenAI-compatible). It answers only at the
 * provider addresses the adapters use (plus `extraOrigins`), throws on anything else, and records every
 * request body so tests can check what would have left the app. `reply` returns the JSON object the
 * model "said" (or a Response to simulate an HTTP error).
 */
export type FakeAiCall = { provider: "gemini" | "anthropic" | "openai_compatible"; url: string; headers: Record<string, string>; body: Record<string, unknown>; raw: string };

export function fakeAi(reply: (call: FakeAiCall) => unknown | Response, opts: { extraOrigins?: string[] } = {}) {
  const calls: FakeAiCall[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const u = new URL(url);
    const raw = typeof init?.body === "string" ? init.body : "";
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const provider =
      u.origin === "https://generativelanguage.googleapis.com" && /\/v1beta\/models\/[^/]+:generateContent$/.test(u.pathname) ? "gemini"
      : u.origin === "https://api.anthropic.com" && u.pathname === "/v1/messages" ? "anthropic"
      : (opts.extraOrigins ?? []).includes(u.origin) && u.pathname.endsWith("/chat/completions") ? "openai_compatible"
      : null;
    if (!provider) throw new Error(`Test tried to reach ${u.origin}${u.pathname}`);
    const call: FakeAiCall = { provider, url, headers, body: JSON.parse(raw) as Record<string, unknown>, raw };
    calls.push(call);
    const out = reply(call);
    if (out instanceof Response) return out;
    const text = typeof out === "string" ? out : JSON.stringify(out);
    const body =
      provider === "gemini" ? { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } }
      : provider === "anthropic" ? { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } }
      : { choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

/** A lead-task reply. */
export const leadAnswer = (o: { ref?: string | null; refConf?: number; intent?: string | null; intentConf?: number; kg?: number | null; kgConf?: number } = {}) => ({
  product: { ref: o.ref ?? null, confidence: o.refConf ?? 0.95 },
  intent: { value: o.intent ?? null, confidence: o.intentConf ?? 0.95 },
  quantity: { kg: o.kg ?? null, confidence: o.kgConf ?? 0.95 },
});

/** An email-task reply. */
export const emailAnswer = (classification: string | null, confidence = 0.95, lead: Record<string, string | null> = {}) => ({
  classification, confidence, reason: "Test reason",
  lead: { contact_name: null, company: null, phone: null, email: null, city: null, state: null, country: null, product: null, quantity: null, ...lead },
});
