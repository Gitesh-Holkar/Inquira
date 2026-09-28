/**
 * Small in-memory token bucket for public endpoints (DCR, OAuth token, MCP, cron).
 * Per serverless instance only — good enough to blunt abuse; see docs/SECURITY.md for limits.
 */
const buckets = new Map<string, { tokens: number; updated: number }>();

export function rateLimit(key: string, opts: { capacity: number; refillPerMinute: number }): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: opts.capacity, updated: now };
  b.tokens = Math.min(opts.capacity, b.tokens + ((now - b.updated) / 60_000) * opts.refillPerMinute);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) for (const k of [...buckets.keys()].slice(0, 5000)) buckets.delete(k);
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
