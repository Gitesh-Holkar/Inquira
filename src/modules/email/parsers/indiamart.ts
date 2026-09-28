import { bestText, clean, FOREIGN_COUNTRIES, INDIAN_STATE_CODES, lines, parseIndianLocation } from "./text";
import type { EmailInput, ParseResult } from "./types";

export function isIndiaMart(m: EmailInput): boolean {
  return /@indiamart\.com$/i.test(extractAddress(m.from));
}

export function extractAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1]! : from).trim().toLowerCase();
}

const REQ_KEYS = [
  "Quantity", "Quantity Unit", "Packaging Size", "Packaging Type", "Protein Form", "Protein Content %", "Protein Content",
  "Organic Status", "Probable Order Value", "Probable Requirement Type", "Grade", "Application", "Usage/Application", "Type",
  "Type of Requirement", "Purity", "Form", "Physical Form", "Color", "Brand", "Shelf Life", "Buyer Filled Details", "Packaging",
];

/** "Quantity : 25 Kg Protein Form : Concentrate ..." → { Quantity: "25 Kg", "Protein Form": "Concentrate", ... } */
export function parseInlineKv(s: string): Record<string, string> {
  const keys = [...REQ_KEYS].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\/%]/g, "\\$&"));
  const re = new RegExp(`(?:^|\\s)(${keys.join("|")})\\s*:\\s*`, "g");
  const out: Record<string, string> = {};
  const hits = [...s.matchAll(re)];
  hits.forEach((h, i) => {
    const start = h.index! + h[0].length;
    const end = i + 1 < hits.length ? hits[i + 1]!.index! : s.length;
    const v = s.slice(start, end).trim();
    if (v) out[h[1]!] = v;
  });
  return out;
}

/** Requirements rendered as "Label" / ":" / "value" on separate lines (text part) or "Label : value". */
function parseRequirementLines(ls: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!;
    if (/^(call|chat|regards,?)$/i.test(l)) break;
    if (ls[i + 1] === ":" && ls[i + 2] !== undefined) {
      out[l] = ls[i + 2]!;
      i += 2;
    } else {
      const m = l.match(/^([A-Za-z][A-Za-z %/&()]{1,40}?)\s*:\s*(.+)$/);
      if (m) out[m[1]!.trim()] = m[2]!.trim();
    }
  }
  return out;
}

function reqMessage(req: Record<string, string>): string | null {
  const parts = Object.entries(req).map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join("; ") : null;
}

function parseEnquiry(m: EmailInput): ParseResult | null {
  const subject = m.subject.trim();
  let product: string | null = null;
  let country: string | null = null;
  let firstName: string | null = null;
  let mm: RegExpMatchArray | null;
  if ((mm = subject.match(/^Export Enquiry for (.+) from (.+?), ([^,]+?) via IndiaMART$/i))) {
    [product, firstName, country] = [mm[1]!, mm[2]!, mm[3]!];
  } else if ((mm = subject.match(/^Enquiry for (.+) from (.+?) via IndiaMART$/i))) {
    [product, firstName] = [mm[1]!, mm[2]!];
  } else if ((mm = subject.match(/^(.+?) Enquiry by Phone on /i))) {
    product = mm[1]!;
  } else if (!/^(re:|fwd?:)/i.test(subject) && /enquiry|inquiry/i.test(subject)) {
    // unknown IndiaMART enquiry subject; still try the body
  } else return null;

  const ls = lines(bestText(m));
  // Body product ("I am looking for X ." / "I need X .") beats the subject (subjects get truncated).
  const joined = ls.join(" ");
  const bodyProduct = joined.match(/I am looking for (.+?) \.(?:\s|$)/)?.[1] ?? joined.match(/I need (.+?) \.(?:\s|$)/)?.[1];
  if (bodyProduct) product = bodyProduct.trim();

  const reqStart = ls.findIndex((l) => /^Below are my requirements:?$/i.test(l));
  const req = reqStart >= 0 ? parseRequirementLines(ls.slice(reqStart + 1)) : {};

  const regIdx = ls.findIndex((l) => /^Regards,?$/i.test(l));
  const callIdx = ls.findIndex((l, i) => i > regIdx && /^Click to call:?/i.test(l));
  const addlIdx = ls.findIndex((l, i) => i > regIdx && /^Additional details about me:?/i.test(l));
  if (regIdx < 0 || callIdx < 0) return null;

  const who = ls.slice(regIdx + 1, callIdx);
  const contactName = clean(who[0]);
  const companyName = clean(who.slice(1).join(" ").replace(/\(GST verified by IndiaMART\)/i, ""));
  const afterCall = ls.slice(callIdx, addlIdx > 0 ? addlIdx : undefined);
  const phone = afterCall.join(" ").match(/\+?\d[\d\s-]{7,}\d/)?.[0] ?? null;
  const emailLine = afterCall.findIndex((l) => /^Email:?/i.test(l));
  let email: string | null = null;
  let locLine: string | null = null;
  if (emailLine >= 0) {
    const inline = afterCall[emailLine]!.replace(/^Email:?\s*/i, "");
    email = clean(inline && inline.includes("@") ? inline : afterCall[emailLine + 1] ?? null);
    if (email && !email.includes("@")) email = null;
    const rest = afterCall.slice(emailLine + (inline && inline.includes("@") ? 1 : 2)).filter((l) => !/^\(Please call buyer/i.test(l));
    locLine = rest[rest.length - 1] ?? null;
  }
  const loc = parseIndianLocation(locLine);
  if (country) loc.country = country;
  const international = !!loc.country && !/^india$/i.test(loc.country);

  const extras: Record<string, string> = {};
  for (const l of ls.slice(addlIdx > 0 ? addlIdx + 1 : ls.length)) {
    const kv = l.match(/^(Interested Products|Requirements till date|Member since)\s*:\s*(.+)$/i);
    if (kv) extras[kv[1]!] = kv[2]!;
    else if (/^I deal in/i.test(l)) extras["Deals in"] = l.replace(/^I deal in\s*/i, "");
  }

  return {
    format: "indiamart.enquiry",
    source: "indiamart",
    kind: "enquiry",
    sourceRef: null,
    international,
    confidence: contactName && (phone || email) && product ? "high" : "medium",
    fields: {
      contactName: contactName ?? clean(firstName), companyName, phone, email,
      city: loc.city, state: loc.state, country: loc.country ?? "India",
      productText: clean(product), quantityText: clean(req["Quantity"]), message: reqMessage(req),
    },
    extras,
  };
}

const COMPANY_WORDS = /\b(pvt|private|ltd|limited|llp|foods?|products?|industries|traders?|trading|enterprises?|mills?|plant|agro|pharma|co|company|corporation|exports?|impex|solutions|nutrition|organics?|overseas|international|store|mart|centre|center|labs?|sciences?)\b/i;

/** "Kavya Rao Hilltop Food Products Dimapur - 797112, NL" → name/company/city/state (best effort). */
export function splitBuyleadIdentity(line: string): { name: string | null; company: string | null; city: string | null; state: string | null } {
  let s = line.trim();
  let state: string | null = null;
  let city: string | null = null;
  const st = s.match(/,\s*([A-Z]{2})\s*$/);
  if (st && INDIAN_STATE_CODES[st[1]!]) {
    state = INDIAN_STATE_CODES[st[1]!]!;
    s = s.slice(0, st.index).trim();
    // "... Dimapur - 797112" → the word before the PIN is the city.
    const pin = s.match(/^(.*?)\s*([A-Za-z][A-Za-z.]*)\s*-\s*\d{6}$/);
    if (pin) {
      city = pin[2]!;
      s = pin[1]!.trim();
    } else {
      const lastComma = s.lastIndexOf(",");
      if (lastComma >= 0) {
        city = s.slice(lastComma + 1).trim() || null;
        s = s.slice(0, lastComma).trim();
      }
    }
  }
  // Address-like tails after the first comma belong to the address, not the name/company.
  const firstComma = s.indexOf(",");
  if (firstComma >= 0) s = s.slice(0, firstComma).trim();
  s = s.replace(/\s*,\s*$/, "").trim();
  if (!s) return { name: null, company: null, city, state };
  const words = s.split(/\s+/);
  if (words.length <= 2 || (words.length === 3 && !COMPANY_WORDS.test(s))) return { name: s, company: null, city, state };
  return { name: words.slice(0, 2).join(" "), company: words.slice(2).join(" "), city, state };
}

function parseBuylead(m: EmailInput): ParseResult | null {
  const subj = m.subject.match(/^Buyer Details for (.+)$/i);
  if (!subj) return null;
  const ls = lines(bestText(m));
  const start = ls.findIndex((l) => /Buyer'?s Contact Details:?$/i.test(l));
  if (start < 0) return null;
  let i = start + 1;
  if (ls[i] && /✓/.test(ls[i]!)) i++; // verification ticks
  const identity = ls[i] ?? "";
  const phoneLine = ls.slice(i, i + 4).find((l) => /^\+?\d[\d\s-]{7,}$/.test(l));
  const email = ls.slice(i, i + 6).map((l) => l.match(/^E-?mail:\s*(\S+@\S+)/i)?.[1]).find(Boolean) ?? null;
  const detailsIdx = ls.findIndex((l) => /^Buylead Details:/i.test(l));
  const product = detailsIdx >= 0 ? ls[detailsIdx]!.replace(/^Buylead Details:\s*/i, "") : subj[1]!;
  const kvLine = detailsIdx >= 0 ? ls.slice(detailsIdx + 1, detailsIdx + 4).filter((l) => !/^Reply To This Message/i.test(l) && !/^IndiaMART recommends/i.test(l)).join(" ") : "";
  const kv = parseInlineKv(kvLine);
  const id = splitBuyleadIdentity(identity === phoneLine ? "" : identity);
  const sells = ls.find((l) => /^Sells:/i.test(l));
  const msgParts = [`Buyer line: ${identity}`];
  if (kvLine) msgParts.push(kvLine);
  if (sells) msgParts.push(sells);
  return {
    format: "indiamart.buylead",
    source: "indiamart",
    kind: "buylead",
    sourceRef: null,
    international: false,
    confidence: id.company ? "medium" : "high",
    fields: {
      contactName: id.name, companyName: id.company, phone: phoneLine ?? null, email,
      city: id.city, state: id.state, country: "India", productText: clean(product), quantityText: clean(kv["Quantity"]),
      message: msgParts.join("\n"),
    },
    extras: kv,
  };
}

function parseReply(m: EmailInput): ParseResult | null {
  const text = bestText(m);
  const ls = lines(text);
  const intro = ls.find((l) => /^You have (?:a|\d+) new messages? from /i.test(l));
  if (!intro && !/via IndiaMART/i.test(m.subject)) return null;
  const im = intro?.match(/from (.+?)\s*,\s*(.+?) regarding (.+)$/i) ?? intro?.match(/from (.+?) regarding (.+)$/i);
  let name: string | null = null, company: string | null = null, product: string | null = null;
  if (im && im.length === 4) [name, company, product] = [im[1]!, im[2]!, im[3]!];
  else if (im) [name, product] = [im[1]!, im[2]!];
  const phone = text.match(/\+\d{1,3}-\d{6,12}/)?.[0] ?? null;
  const email = text.match(/[\w.+-]+@(?!indiamart\.com)[\w-]+\.[\w.]+/i)?.[0] ?? null;
  const start = ls.findIndex((l) => l === intro);
  const end = ls.findIndex((l, i) => i > start && /^(Call|Chat|Regards,?)$/i.test(l));
  const messages = start >= 0 ? ls.slice(start + 1, end > 0 ? end : undefined).join("\n") : null;
  return {
    format: "indiamart.reply",
    source: "indiamart",
    kind: "reply",
    sourceRef: null,
    international: false,
    confidence: phone || email ? "high" : "low",
    fields: { contactName: clean(name), companyName: clean(company), phone, email, productText: clean(product), message: clean(messages) },
  };
}

export function parseIndiaMart(m: EmailInput): ParseResult | null {
  if (!isIndiaMart(m)) return null;
  const addr = extractAddress(m.from);
  if (addr.startsWith("buyleads@")) return parseBuylead(m);
  if (addr.includes("+reply@") || /new messages? for .* via IndiaMART/i.test(m.subject)) return parseReply(m);
  if (addr.includes("+enq@") || /enquiry/i.test(m.subject)) return parseEnquiry(m);
  return null;
}

export function mentionsForeignCountry(text: string): string | null {
  for (const c of FOREIGN_COUNTRIES) {
    if (new RegExp(`\\b${c.replace(/ /g, "\\s+")}\\b`, c.length <= 3 ? "" : "i").test(text)) return c;
  }
  return null;
}
