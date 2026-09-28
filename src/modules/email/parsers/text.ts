const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → readable text with line breaks at block boundaries. Good enough for notification emails. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|tbody|ul|ol)>/gi, "\n")
    .replace(/<(p|div|tr|li|h[1-6]|table|ul|ol)(\s[^>]*)?>/gi, "\n")
    .replace(/<\/td>/gi, " \t ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Normalised non-empty lines. */
export function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/[\t  ]+/g, " ").trim()).filter(Boolean);
}

/** A text/plain part that is really a broken template or a placeholder ("." / "%7B%7B.toname%7D%7D"). */
export function isUsableText(text: string | null | undefined): text is string {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 20) return false;
  if (/%7B%7B|\{\{\s*\./.test(t)) return false;
  return true;
}

/** Prefer the text part; fall back to HTML. */
export function bestText(m: { text?: string | null; html?: string | null }): string {
  if (isUsableText(m.text)) return m.text;
  if (m.html) return htmlToText(m.html);
  return m.text ?? "";
}

export function clean(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || /^(not provided|n\/?a|-|na|null|none)$/i.test(t)) return null;
  return t;
}

export const INDIAN_STATE_CODES: Record<string, string> = {
  AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam", BR: "Bihar", CH: "Chandigarh",
  CG: "Chhattisgarh", CT: "Chhattisgarh", DN: "Dadra and Nagar Haveli and Daman and Diu", DD: "Dadra and Nagar Haveli and Daman and Diu",
  DL: "Delhi", GA: "Goa", GJ: "Gujarat", HR: "Haryana", HP: "Himachal Pradesh", JK: "Jammu and Kashmir", JH: "Jharkhand",
  KA: "Karnataka", KL: "Kerala", LA: "Ladakh", LD: "Lakshadweep", MP: "Madhya Pradesh", MH: "Maharashtra", MN: "Manipur",
  ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland", OD: "Odisha", OR: "Odisha", PY: "Puducherry", PB: "Punjab", RJ: "Rajasthan",
  SK: "Sikkim", TN: "Tamil Nadu", TS: "Telangana", TG: "Telangana", TR: "Tripura", UP: "Uttar Pradesh", UK: "Uttarakhand",
  UT: "Uttarakhand", WB: "West Bengal",
};
export const INDIAN_STATES = new Set(Object.values(INDIAN_STATE_CODES).map((s) => s.toLowerCase()));

/** Common non-Indian countries buyers write from (used for international hints, never auto-dropping). */
export const FOREIGN_COUNTRIES = [
  "Afghanistan", "Australia", "Bangladesh", "Bahrain", "Bhutan", "Brazil", "Canada", "China", "Egypt", "France", "Germany", "Ghana",
  "Hong Kong", "Indonesia", "Iran", "Iraq", "Israel", "Italy", "Japan", "Jordan", "Kenya", "Korea", "Kuwait", "Lebanon", "Malaysia",
  "Maldives", "Mexico", "Morocco", "Myanmar", "Nepal", "Netherlands", "New Zealand", "Nigeria", "Oman", "Pakistan", "Philippines",
  "Poland", "Qatar", "Russia", "Saudi Arabia", "Singapore", "South Africa", "Spain", "Sri Lanka", "Tanzania", "Thailand", "Turkey",
  "Uganda", "UAE", "United Arab Emirates", "United Kingdom", "UK", "USA", "United States", "Vietnam", "Yemen",
];

/** "Plot 12, Sample Nagar, Nabarangpur - 764059, Odisha, India" → { city, state, country } */
export function parseIndianLocation(raw: string | null | undefined): { city: string | null; state: string | null; country: string | null } {
  const out = { city: null as string | null, state: null as string | null, country: null as string | null };
  if (!raw) return out;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return out;
  const last = parts[parts.length - 1]!;
  if (/^india$/i.test(last)) {
    out.country = "India";
    parts.pop();
  } else if (parts.length === 1 && !INDIAN_STATES.has(last.toLowerCase()) && !INDIAN_STATE_CODES[last.toUpperCase()]) {
    out.country = last; // e.g. "Lebanon"
    return out;
  }
  const st = parts[parts.length - 1];
  if (st && (INDIAN_STATES.has(st.toLowerCase()) || INDIAN_STATE_CODES[st.toUpperCase()])) {
    out.state = INDIAN_STATE_CODES[st.toUpperCase()] ?? titleCase(st);
    out.country ??= "India";
    parts.pop();
  }
  const cityPart = parts[parts.length - 1];
  if (cityPart) out.city = cityPart.replace(/\s*-\s*\d{6}\s*$/, "").trim() || null;
  return out;
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
