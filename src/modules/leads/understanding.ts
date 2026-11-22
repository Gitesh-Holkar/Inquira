/**
 * Deterministic reading of a lead (GOAL G-UND-3, G-UND-4): intent by rules and quantity in kg.
 * Whatever these cannot settle is left for the AI tiers, then for a person (src/modules/ai).
 * Pure functions; no database.
 */
import type { LeadIntent } from "./types";

type IntentRule = { name: string; intent: LeadIntent; re: RegExp };

/** First match wins, so the most specific intents come first. */
const INTENT_RULES: IntentRule[] = [
  { name: "complaint", intent: "complaint", re: /\b(complain(?:t|ts|ing)?|damaged|defective|leak(?:ed|ing|age)|wrong (?:material|product|item|goods)|quality (?:issue|problem|complaint)|refund)\b/i },
  { name: "purchase_order", intent: "order", re: /\b(purchase order|p\.?\s?o\.?\s*(?:no|number|#|copy|attached)|(?:we are|we have|we'?re) (?:placing|placed|confirming) (?:an |the |our )?order|order (?:is )?confirmed|confirm(?:ed)? (?:the |our )?order)\b/i },
  { name: "sample", intent: "sample_request", re: /\bsamples?\b/i },
  { name: "documents", intent: "document_request", re: /\b(coa|tds|msds|sds|spec(?:ification)?s?\s*sheet|technical data ?sheet|data ?sheet|certificate of analysis|lab (?:test )?report)\b/i },
];

/** Channels whose leads are enquiries by construction (a portal form or a lead a person typed in). */
const ENQUIRY_CHANNELS = /^(tradeindia|indiamart|manual)/;

/**
 * Intent from rules, or null to leave it to AI. Portal enquiries and manual leads are new enquiries
 * unless the buyer's message says something more specific; a plain email needs AI or a person.
 * Only the message is read: a product name can contain such words ("Sample Protein Isolate").
 */
export function intentByRules(l: { channel?: string | null; message?: string | null }): { intent: LeadIntent; by: string } | null {
  const text = l.message ?? "";
  for (const r of INTENT_RULES) if (r.re.test(text)) return { intent: r.intent, by: `rule:${r.name}` };
  if (l.channel && ENQUIRY_CHANNELS.test(l.channel)) return { intent: "new_enquiry", by: "rule:portal_enquiry" };
  return null;
}

const UNIT_KG: [RegExp, number][] = [
  [/^(kg|kgs|kilo|kilos|kilogram|kilograms|kilo gram|kilo grams)$/, 1],
  [/^(g|gm|gms|gram|grams|grm)$/, 0.001],
  [/^(ton|tons|tonne|tonnes|mt|metric ton|metric tons|metric tonne|metric tonnes)$/, 1000],
  [/^(quintal|quintals|qtl|qtls)$/, 100],
  [/^(lb|lbs|pound|pounds)$/, 0.45359237],
];
const UNIT_WORDS = "kilo ?grams?|kilograms?|kilos?|kgs?|grams?|grm|gms?|g|metric ton(?:ne)?s?|ton(?:ne)?s?|mt|quintals?|qtls?|lbs?|pounds?";
const PACKS = "bags?|drums?|boxes|box|packs?|packets?|cartons?|jars?|bottles?|tins?|pouches|pouch|sacks?|containers?";

function toKg(n: number, unit: string): number | null {
  const u = unit.toLowerCase().replace(/\s+/g, " ").trim();
  for (const [re, factor] of UNIT_KG) if (re.test(u)) return n * factor;
  return null;
}

const round3 = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Quantity in kg from free text, or null when the text gives no weight. "30 KG" → 30, "10 MT" → 10000,
 * "4 bags of 25 kg" → 100, "25 kg x 4" → 100, "2 quintal" → 200. "1 Jar" → null: the weight of a jar is
 * unknown, so it stays empty rather than guessed.
 */
export function quantityToKg(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/(\d),(\d)/g, "$1$2");
  // N packs of M <unit>
  const packs = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${PACKS})\\s*(?:of|x|×|\\*|@)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\b`, "i"));
  if (packs) {
    const kg = toKg(Number(packs[2]), packs[3]!);
    if (kg !== null) return round3(Number(packs[1]) * kg);
  }
  // M <unit> x N
  const times = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\s*(?:x|×|\\*)\\s*(\\d+)\\b`, "i"));
  if (times) {
    const kg = toKg(Number(times[1]), times[2]!);
    if (kg !== null) return round3(kg * Number(times[3]));
  }
  const m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\b`, "i"));
  if (!m) return null;
  const kg = toKg(Number(m[1]), m[2]!);
  return kg === null || kg <= 0 ? null : round3(kg);
}

/** True when a text states a weight at all; AI may only fill quantity for such text (G-UND-4). */
export function mentionsWeight(text: string | null | undefined): boolean {
  return !!text && new RegExp(`\\d\\s*(?:${UNIT_WORDS})\\b`, "i").test(text);
}

/** Below the product's MOQ (smallest MOQ among its current grades). Null when either side is unknown. */
export function belowMoq(quantityKg: string | number | null | undefined, moqKg: number | null | undefined): boolean | null {
  if (quantityKg === null || quantityKg === undefined || moqKg === null || moqKg === undefined) return null;
  return Number(quantityKg) < moqKg;
}

export type ScoreReason = { points: number; reason: string };

/**
 * Lead score 0–100 (GOAL G-UND-6) with the reasons a person sees on the lead. Points: product matched 30;
 * quantity 25 (meets MOQ), 15 (stated, MOQ unknown) or 5 (below MOQ); phone 15; email 10; company 10;
 * a buying request 10. "Not a buyer" scores 0. The portals' notifications carry no order value today, so
 * order value does not count yet.
 */
export function scoreLead(l: {
  productId: string | null; quantityKg: string | number | null; phone: string | null; email: string | null; companyName: string | null;
  intent: string | null;
}, moqKg: number | null): { score: number; reasons: ScoreReason[] } {
  if (l.intent === "not_buyer") return { score: 0, reasons: [{ points: 0, reason: "Not a buyer" }] };
  const r: ScoreReason[] = [];
  r.push(l.productId ? { points: 30, reason: "Product matched to the catalogue" } : { points: 0, reason: "Product not matched" });
  const below = belowMoq(l.quantityKg, moqKg);
  if (l.quantityKg === null || l.quantityKg === undefined) r.push({ points: 0, reason: "No quantity in kg" });
  else if (below === false) r.push({ points: 25, reason: `Quantity meets the MOQ of ${moqKg} kg` });
  else if (below === true) r.push({ points: 5, reason: `Quantity below the MOQ of ${moqKg} kg` });
  else r.push({ points: 15, reason: "Quantity stated (no MOQ to compare)" });
  r.push(l.phone ? { points: 15, reason: "Phone number" } : { points: 0, reason: "No phone number" });
  r.push(l.email ? { points: 10, reason: "Email address" } : { points: 0, reason: "No email address" });
  if (l.companyName) r.push({ points: 10, reason: "Company name" });
  if (l.intent && ["new_enquiry", "order", "sample_request", "document_request", "price_negotiation"].includes(l.intent)) r.push({ points: 10, reason: "Asks to buy, for a sample or for documents" });
  return { score: Math.min(100, r.reduce((a, x) => a + x.points, 0)), reasons: r };
}
