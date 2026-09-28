const TZ = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrPlain = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123456 → "₹1,23,456.00" (Indian digit grouping). */
export function formatINR(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "";
  return inr.format(n);
}

/** 123456 → "1,23,456.00" (no symbol, for templates like "Rs. {{price_per_kg}}/kg"). */
export function formatAmount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? inrPlain.format(n) : "";
}

/** "18.00" → "18" ; "5.5" → "5.5" */
export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

// Numeric parts + our own month names: ICU versions disagree on "Sep" vs "Sept".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
});
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric" });

function parts(fmt: Intl.DateTimeFormat, d: Date) {
  const o: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) o[p.type] = p.value;
  if (o.month && /^\d+$/.test(o.month)) o.month = MONTHS[Number(o.month) - 1] ?? o.month;
  return o;
}

/** "29 Sep 2026, 4:10 PM" in IST. */
export function formatDateTime(input: Date | string | null | undefined): string {
  if (!input) return "";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  const p = parts(dateTimeFmt, d);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toUpperCase()}`;
}

/** "29 Sep 2026" in IST. Accepts "YYYY-MM-DD" (treated as a calendar date). */
export function formatDate(input: Date | string | null | undefined): string {
  if (!input) return "";
  const d = typeof input === "string" ? (/^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T12:00:00+05:30`) : new Date(input)) : input;
  if (Number.isNaN(d.getTime())) return "";
  const p = parts(dateFmt, d);
  return `${p.day} ${p.month} ${p.year}`;
}

/** "2h ago", "5m ago", "3d ago", "just now"; older than 30 days → date. */
export function formatRelative(input: Date | string | null | undefined, now: Date = new Date()): string {
  if (!input) return "";
  const d = typeof input === "string" ? new Date(input) : input;
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days <= 30) return `${days}d ago`;
  return formatDate(d);
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Start of today in IST as a Date (UTC instant). */
export function startOfTodayIST(now: Date = new Date()): Date {
  return new Date(`${todayIST(now)}T00:00:00+05:30`);
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
