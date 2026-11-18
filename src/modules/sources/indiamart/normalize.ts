/**
 * IndiaMART lead → NormalizedLead. Field names are those of the Push API page on help.indiamart.com
 * (checked 18 Nov 2026); the Pull API page names the same core fields, and is assumed to use the same set
 * (QUESTIONS.md Q-019). The raw lead is always kept on the lead.
 *
 * QUERY_TYPE: W direct enquiry, B Buy Lead (consumed), P phone call, BIZ catalogue view, WA WhatsApp.
 * The channel is `indiamart_api_<type>`, so the lead page and the API-versus-email counts can tell them apart.
 */
import type { NormalizedLead } from "@/modules/leads/types";
import type { IndiaMartLead } from "./client";

export const INDIAMART_TYPES = ["W", "B", "P", "BIZ", "WA"] as const;

function str(raw: IndiaMartLead, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s && s.toLowerCase() !== "null") return s;
  }
  return null;
}

/** "2024-04-10 11:17:14" in IST. Falls back to now when missing or unreadable. */
export function indiaMartQueryTime(raw: IndiaMartLead, now = new Date()): Date {
  const t = str(raw, "QUERY_TIME");
  const m = t?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return now;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`);
  return Number.isNaN(d.getTime()) ? now : d;
}

export function normalizeIndiaMart(raw: IndiaMartLead): NormalizedLead | null {
  const id = str(raw, "UNIQUE_QUERY_ID");
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const type = (str(raw, "QUERY_TYPE") ?? "W").toUpperCase();
  const known = (INDIAMART_TYPES as readonly string[]).includes(type);
  const country = str(raw, "SENDER_COUNTRY_ISO");
  const name = str(raw, "SENDER_NAME");
  const phone = str(raw, "SENDER_MOBILE", "SENDER_MOBILE_ALT", "SENDER_PHONE", "SENDER_PHONE_ALT");
  const duration = str(raw, "CALL_DURATION");
  return {
    source: "indiamart",
    sourceRef: id,
    channel: known ? `indiamart_api_${type.toLowerCase()}` : "indiamart_api",
    contactName: name && name.toLowerCase() !== "indiamart buyer" ? name : null, // IndiaMART's placeholder when the name is unknown
    companyName: str(raw, "SENDER_COMPANY"),
    phone: phone ? phone.replace(/(?<=^\+\d{1,3})-/, "").replace(/[\s-]/g, "") : null,
    email: str(raw, "SENDER_EMAIL", "SENDER_EMAIL_ALT"),
    city: str(raw, "SENDER_CITY"),
    state: str(raw, "SENDER_STATE"),
    country: !country ? null : /^in(d)?$/i.test(country) ? "India" : country.toUpperCase(),
    productText: str(raw, "QUERY_PRODUCT_NAME", "QUERY_MCAT_NAME", "SUBJECT"),
    quantityText: null,
    message: str(raw, "QUERY_MESSAGE") ?? (type === "P" && duration ? `Phone call through IndiaMART (${duration} s)` : null),
    rawPayload: raw,
    receivedAt: indiaMartQueryTime(raw),
    isInternational: !!country && !/^in(d)?$/i.test(country),
  };
}
