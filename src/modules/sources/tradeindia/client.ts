import { AppError } from "@/lib/errors";
import { todayIST } from "@/lib/format";

/** TradeIndia "My Inquiry API". See docs/TRADEINDIA_API.md for what is known and what is assumed. */
export const TRADEINDIA_ENDPOINT = "https://www.tradeindia.com/utils/my_inquiry.html";
export type TradeIndiaCredentials = { userId: string; profileId: string; key: string };
export type TradeIndiaInquiry = Record<string, unknown>;

export class TradeIndiaRateLimited extends AppError {
  constructor() {
    super("RATE_LIMITED", "TradeIndia rate limit hit; will retry later.");
  }
}
export class TradeIndiaAuthError extends AppError {
  constructor(msg: string) {
    super("INTEGRATION", `TradeIndia rejected the credentials: ${msg}`);
  }
}

/**
 * The calendar date in IST. TradeIndia is an Indian service and its `from_date` / `to_date` are assumed
 * to be IST dates (unverified; docs/INTEGRATIONS.md). A UTC date would end "yesterday" from 00:00 to 05:30 IST.
 */
export const tradeIndiaDay = (d: Date) => todayIST(d);

const WINDOW_DAYS = 7;
const DAY_MS = 86400_000;
export type InquiryWindow = { start: Date; end: Date };

/** Splits [from, to] into consecutive windows of at most 7 days (conservative; ADR-012). */
export function inquiryWindows(from: Date, to: Date): InquiryWindow[] {
  const out: InquiryWindow[] = [];
  for (let start = new Date(from); start <= to; start = new Date(start.getTime() + WINDOW_DAYS * DAY_MS)) {
    out.push({ start, end: new Date(Math.min(to.getTime(), start.getTime() + (WINDOW_DAYS - 1) * DAY_MS)) });
  }
  return out;
}

export class TradeIndiaClient {
  constructor(private creds: TradeIndiaCredentials, private f: typeof fetch = fetch, readonly pageSize = 50) {}

  url(from: Date, to: Date, page: number) {
    const p = new URLSearchParams({
      userid: this.creds.userId, profile_id: this.creds.profileId, key: this.creds.key,
      from_date: tradeIndiaDay(from), to_date: tradeIndiaDay(to), limit: String(this.pageSize), page_no: String(page),
    });
    return `${TRADEINDIA_ENDPOINT}?${p}`;
  }

  async page(from: Date, to: Date, page: number): Promise<TradeIndiaInquiry[]> {
    const res = await this.f(this.url(from, to, page), { headers: { Accept: "application/json", "User-Agent": "Inquira/1.0" } });
    if (res.status === 429) throw new TradeIndiaRateLimited();
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : [];
    } catch {
      throw new AppError("INTEGRATION", `TradeIndia returned non-JSON (HTTP ${res.status})`);
    }
    if (Array.isArray(body)) return body as TradeIndiaInquiry[];
    const obj = body as { success?: boolean; status?: string; message?: string; data?: unknown; inquiries?: unknown };
    if (Array.isArray(obj.data)) return obj.data as TradeIndiaInquiry[];
    if (Array.isArray(obj.inquiries)) return obj.inquiries as TradeIndiaInquiry[];
    const msg = obj.message ?? `HTTP ${res.status}`;
    if (/no (record|inquir|data)/i.test(msg)) return [];
    if (res.status === 401 || res.status === 403 || /invalid|unauthori[sz]ed|key|credential/i.test(msg)) throw new TradeIndiaAuthError(msg);
    throw new AppError("INTEGRATION", `TradeIndia error: ${msg}`);
  }
}
