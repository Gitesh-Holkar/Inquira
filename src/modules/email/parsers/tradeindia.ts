import { bestText, clean, htmlToText } from "./text";
import { extractAddress } from "./indiamart";
import type { EmailInput, ParseResult } from "./types";

export function isTradeIndia(m: EmailInput): boolean {
  return /@([a-z0-9-]+\.)*tradeindia\.com$/i.test(extractAddress(m.from));
}

/**
 * TradeIndia's inquiry id (rfi_id). The "check inquiry" link carries ext=<base64 of
 * "rfi_id=<id>&amp;section=Inbox#myReply">; the HTML read-pixel carries rfi_id=<id>.
 * "__RFI_ID__" is a placeholder meaning "no id" (RFI/buy-lead mails).
 */
export function extractRfiId(raw: string): string | null {
  for (const m of raw.matchAll(/[?&]ext=([A-Za-z0-9+/=_-]+)/g)) {
    try {
      const decoded = Buffer.from(m[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      const id = decoded.match(/rfi_id=(\d+)/)?.[1];
      if (id) return id;
    } catch {
      /* not base64 */
    }
  }
  return raw.match(/rfi_id=(\d{5,})/)?.[1] ?? null;
}

function between(s: string, start: RegExp, ends: RegExp[]): string | null {
  const m = s.match(start);
  if (!m) return null;
  const from = m.index! + m[0].length;
  let to = s.length;
  for (const e of ends) {
    const re = new RegExp(e.source, e.flags.includes("g") ? e.flags : e.flags + "g");
    re.lastIndex = from;
    const hit = re.exec(s);
    if (hit && hit.index < to) to = hit.index;
  }
  return s.slice(from, to).trim();
}

export function parseTradeIndia(m: EmailInput): ParseResult | null {
  if (!isTradeIndia(m)) return null;
  const raw = `${m.text ?? ""}\n${m.html ?? ""}`;
  const text = bestText(m);
  const flat = text.replace(/\s+/g, " ");
  if (!/Sender Name:|Buyer Details:|Details of the sender/i.test(flat)) return null;

  const senderName = clean(between(flat, /Sender Name:\s*/i, [/\*\s*Product Details:/i, /Product Details:/i]));
  const productDetails = clean(between(flat, /Product Details:\s*/i, [/\*\s*Requirement Details:/i, /Requirement Details:/i]));
  const requirement = between(flat, /Requirement Details:\s*/i, [/\*\s*Buyer Details:/i, /Buyer Details:/i, /Click here to check inquiry/i]) ?? "";
  const buyer = between(flat, /Buyer Details:\s*/i, [/Click here to check inquiry/i, /How to convert inquiry/i]) ?? "";

  // Standard layout: "Name - X Email - Y Mobile - Z city - C state - S country - IN"
  const dash = (label: string) => clean(buyer.match(new RegExp(`${label}\\s*-\\s*(.*?)(?=\\s+(?:Name|Email|Mobile|city|state|country)\\s*-|$)`, "i"))?.[1]);
  // Website layout ("Details of the sender" / "Name : X ... Mobile No : ... IP/Country : 1.2.3.4/India")
  const htmlText = m.html ? htmlToText(m.html) : text;
  const colon = (label: string) => clean(htmlText.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"))?.[1]);

  let contactName = dash("Name") ?? colon("Name") ?? senderName;
  let email = dash("Email") ?? colon("Email");
  let phone = dash("Mobile") ?? colon("Mobile No\\.?");
  let city = dash("city") ?? colon("City");
  let state = dash("state") ?? colon("State");
  let country = dash("country");
  const ipCountry = colon("IP/Country");
  if (!country && ipCountry) country = clean(ipCountry.split("/").pop());
  let companyName = colon("Company") ?? clean(requirement.match(/Company Name:\s*(.*?)\s+Mobile:/i)?.[1]);
  if (companyName && /^New Company-/i.test(companyName)) companyName = null;
  if (!phone) phone = clean(requirement.match(/Mobile:\s*(\+?\d{8,15})/i)?.[1]);
  if (!country) country = clean(requirement.match(/Country:\s*([A-Za-z ]{2,30}?)(?:\s+Need more help|\s*$)/i)?.[1]);

  // Multi-value fields ("a@x.com b@y.com", "+91.. +91..") → first value.
  email = email?.split(/\s+/).find((e) => e.includes("@")) ?? null;
  if (email && /(^no-?reply@|@([a-z0-9-]+\.)*tradeindia\.com$)/i.test(email)) email = null; // TradeIndia placeholder, not the buyer
  phone = phone?.split(/\s+/)[0] ?? null;
  if (contactName && /^Mr\.?$|^Ms\.?$/i.test(contactName)) contactName = senderName;
  city = city?.replace(/\s*\(.*\)$/, "") ?? null;
  state = state ?? null;

  // Free-text message: strip TradeIndia boilerplate from the requirement.
  let message = requirement
    .replace(/New Inquiry Alert!.*?(?=Need more help|$)/i, "")
    .replace(/Need more help\?.*$/i, "")
    .replace(/-{5,}[\s\S]*$/, "")
    .replace(/Thank you,\s*.*$/i, "")
    .trim();
  if (!message) message = requirement.match(/inquiry for (.+?) from:/i)?.[1] ?? "";

  const rfi = extractRfiId(raw);
  const subjectProduct = m.subject.match(/^(.+?) Inquiry from /i)?.[1] ?? m.subject.match(/^Looking for suppliers of (.+)$/i)?.[1] ?? null;
  const product = productDetails ?? (subjectProduct && !/^\+?\d+$/.test(subjectProduct) ? subjectProduct : null);
  const international = !!country && !/^(in|ind|india)$/i.test(country);

  return {
    format: "tradeindia.inquiry",
    source: "tradeindia",
    kind: "inquiry",
    sourceRef: rfi,
    international,
    confidence: contactName && phone ? "high" : phone || email ? "medium" : "low",
    fields: {
      contactName, companyName, phone, email, city, state, country: country === "IN" ? "India" : country,
      productText: clean(product), quantityText: clean(requirement.match(/Quantity\s*[:-]\s*([\d.,]+\s*[A-Za-z]+)/i)?.[1]),
      message: clean(message),
    },
    extras: { channel: /TI Whatsapp/i.test(m.subject) ? "whatsapp" : /^Looking for suppliers of/i.test(m.subject) ? "rfi" : /^Inquiry from \+?\d+/i.test(m.subject) ? "website" : "product_page" },
  };
}
