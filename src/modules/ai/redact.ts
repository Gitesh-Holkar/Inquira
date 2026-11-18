/**
 * Redaction for the Basic tier (GOAL G-AI-4). Free-tier AI terms exclude personal data, so before any
 * Basic call this removes email addresses, URLs, phone numbers and other long digit runs, tax ids, and
 * every name the lead or email carries (buyer, company, sender, city). What is left is the product and
 * requirement text. `tests/ai.test.ts` proves nothing personal reaches the provider.
 *
 * Limit: a name that appears in the text but in no field of the lead (for example a colleague named in
 * a signature) is only caught by the patterns above when it is not a plain word. That is why Basic only
 * ever sees the product, quantity, subject and requirement text, never a whole email thread.
 */

export type KnownPersonalData = {
  /** People: buyer name, email sender name. */
  names: (string | null | undefined)[];
  /** Companies: buyer company. */
  companies: (string | null | undefined)[];
  /** Places tied to the buyer: city. */
  places: (string | null | undefined)[];
  emails: (string | null | undefined)[];
  phones: (string | null | undefined)[];
};

/** Words that appear in company names but say nothing about who the buyer is; kept so product text survives. */
const GENERIC_COMPANY_WORDS = new Set([
  "pvt", "private", "ltd", "limited", "llp", "inc", "co", "company", "corp", "corporation", "the", "and", "of", "india",
  "indian", "industries", "industry", "enterprises", "enterprise", "traders", "trading", "trade", "foods", "food",
  "international", "exports", "export", "imports", "import", "impex", "group", "solutions", "services", "agro",
  "products", "product", "pharma", "pharmaceuticals", "chemicals", "nutrition", "healthcare", "global", "overseas",
]);

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|net|org|co|io|biz|info)(?:\/\S*)?\b/gi;
/** Indian GSTIN (15 characters) and PAN (10 characters). */
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/gi;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
/** Phone-like runs: optional +, then 7 or more digits with spaces, dots, dashes or brackets between them. */
const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function wordsOf(values: (string | null | undefined)[], skip?: Set<string>): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const full = v.trim();
    if (full.length >= 2) out.add(full);
    for (const w of full.split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 3 && !skip?.has(w.toLowerCase())) out.add(w);
    }
  }
  // Longest first, so "Sharma Foods" goes before "Sharma".
  return [...out].sort((a, b) => b.length - a.length);
}

function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

/**
 * Returns `text` with personal data replaced by placeholders ([email], [phone], [link], [name], [company],
 * [place], [id]). Numbers with a unit or of six digits or fewer (quantities, prices, pack sizes) are kept.
 */
export function redactForBasic(text: string | null | undefined, known: KnownPersonalData): string {
  if (!text) return "";
  let s = text;
  s = s.replace(EMAIL, "[email]");
  for (const e of known.emails) if (e) s = s.replace(new RegExp(escapeRe(e), "gi"), "[email]");
  s = s.replace(URL_RE, "[link]").replace(DOMAIN, "[link]");
  s = s.replace(GSTIN, "[id]").replace(PAN, "[id]");
  // Known phone numbers in any spelling: match on their last 10 digits with any separators in between.
  for (const p of known.phones) {
    const d = digitsOnly(p ?? "").slice(-10);
    if (d.length >= 7) s = s.replace(new RegExp(d.split("").join("[\\s().-]*"), "g"), "[phone]");
  }
  s = s.replace(PHONE, (m) => (digitsOnly(m).length >= 7 ? "[phone]" : m));
  for (const w of wordsOf(known.companies, GENERIC_COMPANY_WORDS)) s = s.replace(wordRe(w), "[company]");
  for (const w of wordsOf(known.names)) s = s.replace(wordRe(w), "[name]");
  for (const w of wordsOf(known.places)) s = s.replace(wordRe(w), "[place]");
  return s.replace(/[ \t]{2,}/g, " ").trim();
}

function wordRe(w: string) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, "giu");
}
