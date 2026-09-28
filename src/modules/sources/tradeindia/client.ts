import { AppError } from "@/lib/errors";

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

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export class TradeIndiaClient {
  constructor(private creds: TradeIndiaCredentials, private f: typeof fetch = fetch, private pageSize = 50) {}

  url(from: Date, to: Date, page: number) {
    const p = new URLSearchParams({
      userid: this.creds.userId, profile_id: this.creds.profileId, key: this.creds.key,
      from_date: ymd(from), to_date: ymd(to), limit: String(this.pageSize), page_no: String(page),
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

  /** Yields pages for [from, to] split into 7-day windows (conservative; ADR-012). */
  async *inquiries(from: Date, to: Date, opts: { delayMs?: number; maxPages?: number } = {}): AsyncGenerator<TradeIndiaInquiry[]> {
    const delay = opts.delayMs ?? 1500;
    let pages = 0;
    for (let start = new Date(from); start <= to; start = new Date(start.getTime() + 7 * 86400_000)) {
      const end = new Date(Math.min(to.getTime(), start.getTime() + 6 * 86400_000));
      for (let page = 1; ; page++) {
        if (opts.maxPages && pages >= opts.maxPages) return;
        const rows = await this.page(start, end, page);
        pages++;
        if (rows.length) yield rows;
        if (rows.length < this.pageSize) break;
        if (delay) await new Promise((r) => setTimeout(r, delay));
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
  }
}
