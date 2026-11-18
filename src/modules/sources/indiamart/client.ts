/**
 * IndiaMART Lead Manager Pull API (GOAL G-SRC-2), as documented on help.indiamart.com
 * ("Integration of IndiaMART's Lead Manager Pull API with Third Party CRMs", checked 18 Nov 2026):
 *   GET https://mapi.indiamart.com/wservce/crm/crmListing/v2/?glusr_crm_key=KEY&start_time=…&end_time=…
 * Times are IST, written `DD-Mon-YYYYHH:MM:SS` (for example 01-Jan-202209:00:00). One call covers at most
 * 7 days; at most one call per 5 minutes; more than 5 calls in a minute blocks the key for 15 minutes;
 * an unused key expires after 7 days. Every reply is JSON with CODE, STATUS, MESSAGE, TOTAL_RECORDS and
 * RESPONSE (the leads). The key is part of the URL, so the URL is never logged or shown.
 */
import { AppError } from "@/lib/errors";

export const PULL_URL = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/";
export const MIN_CALL_INTERVAL_MS = 5 * 60_000;
export const MAX_WINDOW_MS = 7 * 86400_000;

export type IndiaMartLead = Record<string, unknown>;

export class IndiaMartAuthError extends AppError {
  constructor(message: string) {
    super("INTEGRATION", `IndiaMART refused the key: ${message} Generate a new key in IndiaMART's Lead Manager and paste it in Settings.`);
  }
}
export class IndiaMartRateLimited extends AppError {
  constructor(message: string) {
    super("RATE_LIMITED", `IndiaMART asked to wait: ${message}`);
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `DD-Mon-YYYYHH:MM:SS` in IST. */
export function indiaMartTime(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(ist.getUTCDate())}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()}${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`;
}

export class IndiaMartClient {
  constructor(private key: string, private f: typeof fetch = fetch) {}

  url(from: Date, to: Date): string {
    const q = new URLSearchParams({ glusr_crm_key: this.key, start_time: indiaMartTime(from), end_time: indiaMartTime(to) });
    return `${PULL_URL}?${q}`;
  }

  /** Leads created between `from` and `to` (at most 7 days apart). "No leads" (CODE 204) is an empty list. */
  async list(from: Date, to: Date): Promise<IndiaMartLead[]> {
    if (to.getTime() - from.getTime() > MAX_WINDOW_MS) throw new AppError("VALIDATION", "IndiaMART allows at most 7 days per call.");
    let res: Response;
    try {
      res = await this.f(this.url(from, to), { headers: { Accept: "application/json" } });
    } catch {
      throw new AppError("INTEGRATION", "IndiaMART could not be reached. It will be tried again on the next run.");
    }
    const body = (await res.json().catch(() => null)) as { CODE?: number | string; MESSAGE?: string; RESPONSE?: unknown } | null;
    const code = Number(body?.CODE ?? res.status);
    const message = String(body?.MESSAGE ?? "").slice(0, 200) || `HTTP ${res.status}`;
    if (code === 200) return Array.isArray(body?.RESPONSE) ? (body!.RESPONSE as IndiaMartLead[]) : [];
    if (code === 204) return [];
    if (code === 401) throw new IndiaMartAuthError(message);
    if (code === 429) throw new IndiaMartRateLimited(message);
    throw new AppError("INTEGRATION", `IndiaMART answered ${code}: ${message}`);
  }
}
