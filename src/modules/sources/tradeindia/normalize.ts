import type { NormalizedLead } from "@/modules/leads/types";
import type { TradeIndiaInquiry } from "./client";

/** Field names vary between TradeIndia API versions/integrations; take the first present alias. */
const ALIASES = {
  id: ["rfi_id", "inquiry_id", "enquiry_id", "id"],
  name: ["sender_name", "name", "buyer_name"],
  company: ["sender_co", "sender_company", "company", "company_name"],
  mobile: ["sender_mobile", "mobile", "mobile_number", "sender_phone"],
  phone: ["landline_number", "sender_phone_no", "phone"],
  email: ["sender_email", "email"],
  city: ["sender_city", "city"],
  state: ["sender_state", "state"],
  country: ["sender_country", "country"],
  product: ["product_name", "product", "subject"],
  quantity: ["quantity", "qty", "order_quantity"],
  message: ["message", "enquiry_message", "inquiry_message", "requirement"],
  date: ["generated_date", "date", "created_date", "inquiry_date"],
  time: ["generated_time", "time"],
  epoch: ["generated", "timestamp"],
  type: ["inquiry_type", "type", "source"],
} as const;

function pick(raw: TradeIndiaInquiry, key: keyof typeof ALIASES): string | null {
  for (const k of ALIASES[key]) {
    const v = raw[k];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s && s !== "null" && s !== "0000-00-00") return s;
  }
  return null;
}

/** Parses "2026-09-27" + "15:30:13" (IST) or an epoch into a Date. */
export function tradeIndiaDate(raw: TradeIndiaInquiry): Date {
  const epoch = pick(raw, "epoch");
  if (epoch && /^\d{9,13}$/.test(epoch)) return new Date(Number(epoch) * (epoch.length > 10 ? 1 : 1000));
  const d = pick(raw, "date");
  const t = pick(raw, "time") ?? "00:00:00";
  if (d) {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? d.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
    if (m) {
      const [y, mo, da] = m[1]!.length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
      const dt = new Date(`${y}-${mo}-${da}T${/^\d{2}:\d{2}/.test(t) ? t.slice(0, 8).padEnd(8, ":00") : "00:00:00"}+05:30`);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
  }
  return new Date();
}

export function normalizeTradeIndia(raw: TradeIndiaInquiry): NormalizedLead | null {
  const id = pick(raw, "id");
  if (!id) return null;
  const country = pick(raw, "country");
  const intl = !!country && !/^(in|ind|india)$/i.test(country);
  return {
    source: "tradeindia",
    sourceRef: id,
    channel: "tradeindia_api",
    contactName: pick(raw, "name"),
    companyName: pick(raw, "company"),
    phone: pick(raw, "mobile") ?? pick(raw, "phone"),
    email: pick(raw, "email"),
    city: pick(raw, "city"),
    state: pick(raw, "state"),
    country: country && /^(in|ind)$/i.test(country) ? "India" : country,
    productText: pick(raw, "product"),
    quantityText: pick(raw, "quantity"),
    message: pick(raw, "message"),
    rawPayload: raw,
    receivedAt: tradeIndiaDate(raw),
    isInternational: intl,
  };
}
