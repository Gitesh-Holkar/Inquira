import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Normalises a phone number to E.164 (+919876543210). Indian formats seen in lead emails:
 * "+91-9876543210", "09876543210", "9876543210", "+91 98765 43210". Returns null if invalid.
 */
export function toE164(raw: string | null | undefined, defaultCountry: CountryCode = "IN"): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[^\d+]/g, (ch) => (ch === "+" ? "+" : ""));
  if (/^00\d/.test(s)) s = "+" + s.slice(2);
  // "+91-" prefixed Indian numbers and bare 10-digit mobiles.
  const p = parsePhoneNumberFromString(s, defaultCountry);
  if (p && p.isValid()) return p.number;
  // Numbers like "+961-79159918" may fail strict validation but are still usable contacts.
  if (p && p.isPossible()) return p.number;
  return null;
}

/** "+919876543210" → "+91 98765 43210"; other countries use international format. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const p = parsePhoneNumberFromString(e164);
  if (!p) return e164;
  if (p.countryCallingCode === "91" && p.nationalNumber.length === 10) {
    const n = p.nationalNumber;
    return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
  }
  return p.formatInternational();
}

/** Country (ISO-2) implied by a phone number, if any. */
export function phoneCountry(e164: string | null | undefined): string | null {
  if (!e164) return null;
  return parsePhoneNumberFromString(e164)?.country ?? null;
}

/** wa.me wants the number without "+" (brief §7.3). */
export function whatsappUrl(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).trim().toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : null;
}
