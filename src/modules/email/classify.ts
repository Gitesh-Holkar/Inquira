import { extractAddress, mentionsForeignCountry, parseIndiaMart } from "./parsers/indiamart";
import { parseTradeIndia } from "./parsers/tradeindia";
import { bestText } from "./parsers/text";
import type { EmailInput, ParseResult } from "./parsers/types";

export type Classification = "inquiry" | "conversation" | "ignored" | "international" | "needs_review";

export type RuleLike = {
  id: string;
  matchType: "sender_email" | "sender_domain" | "subject_contains" | "body_contains";
  pattern: string;
  action: "ignore" | "needs_review" | "international" | "inquiry";
  priority: number;
  enabled: boolean;
};

export type ClassifyContext = {
  ownAddresses: string[];
  rules: RuleLike[];
  /** true if this Gmail thread already belongs to a lead */
  threadHasLead: boolean;
};

export type ClassifyResult = {
  classification: Classification;
  reason: string;
  /** rule:<id> | parser:<format> | system */
  by: string;
  parsed?: ParseResult;
  hints?: { internationalCountry?: string };
};

export function ruleMatches(rule: RuleLike, m: EmailInput, body: string): boolean {
  const p = rule.pattern.trim().toLowerCase();
  if (!p) return false;
  const addr = extractAddress(m.from);
  switch (rule.matchType) {
    case "sender_email":
      return addr === p;
    case "sender_domain": {
      const domain = addr.split("@")[1] ?? "";
      const d = p.replace(/^@/, "");
      return domain === d || domain.endsWith("." + d);
    }
    case "subject_contains":
      return m.subject.toLowerCase().includes(p);
    case "body_contains":
      return body.toLowerCase().includes(p);
  }
}

const OTP = /\b(otp|one[\s-]?time[\s-]?password|verification code|login code)\b/i;
const BANK = /\b(neft|rtgs|imps|utr|payee advice|payment advice|a\/c\s*(no|xx)|account statement|has been (credited|debited)|credited to|debited from|e-?statement)\b/i;
const NOREPLY = /^(no-?reply|noreply|do-?not-?reply|notifications?|alerts?|mailer-daemon|digest)[@.+-]/i;

/**
 * Deterministic classification (brief §7.2). Everything that code can't decide goes to
 * needs_review, where Claude (via MCP) or a person classifies it. Nothing is dropped silently.
 */
export function classifyEmail(m: EmailInput, ctx: ClassifyContext): ClassifyResult {
  const addr = extractAddress(m.from);
  const body = bestText(m);

  // 1. Our own mail
  if (m.labelIds?.includes("SENT") || m.labelIds?.includes("DRAFT") || ctx.ownAddresses.map((a) => a.toLowerCase()).includes(addr)) {
    return { classification: "ignored", reason: "Own mail (sent by us)", by: "system" };
  }

  // 2. Rules the team created (corrections become rules)
  const rules = ctx.rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);
  for (const r of rules) {
    if (!ruleMatches(r, m, body)) continue;
    const map = { ignore: "ignored", needs_review: "needs_review", international: "international", inquiry: "inquiry" } as const;
    const parsed = parseIndiaMart(m) ?? parseTradeIndia(m) ?? undefined;
    return { classification: map[r.action], reason: `Rule: ${r.matchType} "${r.pattern}"`, by: `rule:${r.id}`, parsed };
  }

  // 3. Portal notifications (deterministic parsers)
  const portal = parseIndiaMart(m) ?? parseTradeIndia(m);
  if (portal) {
    if (portal.kind === "reply") {
      return ctx.threadHasLead || portal.fields.phone || portal.fields.email
        ? { classification: "conversation", reason: "IndiaMART buyer message on an enquiry", by: `parser:${portal.format}`, parsed: portal }
        : { classification: "needs_review", reason: "IndiaMART message without buyer contact", by: `parser:${portal.format}`, parsed: portal };
    }
    const usable = !!(portal.fields.phone || portal.fields.email) && portal.confidence !== "low";
    if (!usable) return { classification: "needs_review", reason: "Portal email parsed with low confidence", by: `parser:${portal.format}`, parsed: portal };
    return {
      classification: portal.international ? "international" : "inquiry",
      reason: portal.international ? `International ${portal.source} inquiry (${portal.fields.country})` : `${portal.source} ${portal.kind}`,
      by: `parser:${portal.format}`,
      parsed: portal,
    };
  }
  if (/@([a-z0-9-]+\.)*(indiamart|tradeindia)\.com$/i.test(addr)) {
    // Portal mail we don't recognise (newsletters, account notices, new templates)
    if (/enquiry|inquiry|buyer|lead/i.test(m.subject)) return { classification: "needs_review", reason: "Unrecognised portal format", by: "system" };
    return { classification: "ignored", reason: "Portal notification (not an inquiry)", by: "system" };
  }

  // 4. Replies in a thread that already belongs to a lead
  if (ctx.threadHasLead) return { classification: "conversation", reason: "Reply in a lead's thread", by: "system" };

  // 5. Noise
  if (OTP.test(m.subject) || (OTP.test(body.slice(0, 400)) && body.length < 1500)) return { classification: "ignored", reason: "OTP / verification code", by: "system" };
  if (BANK.test(m.subject) || (BANK.test(body.slice(0, 600)) && /bank/i.test(addr + body.slice(0, 600)))) return { classification: "ignored", reason: "Bank alert", by: "system" };
  const promo = m.labelIds?.some((l) => l === "CATEGORY_PROMOTIONS" || l === "CATEGORY_SOCIAL");
  const listUnsub = Object.keys(m.headers ?? {}).some((h) => h.toLowerCase() === "list-unsubscribe");
  if (promo || (listUnsub && NOREPLY.test(addr)) || /digest|newsletter/i.test(addr)) return { classification: "ignored", reason: "Newsletter / promotion", by: "system" };

  // 6. Everything else: a person or Claude decides
  const country = mentionsForeignCountry(`${m.subject}\n${body.slice(0, 3000)}`);
  return { classification: "needs_review", reason: "Needs a human or Claude to classify", by: "system", hints: country ? { internationalCountry: country } : undefined };
}
