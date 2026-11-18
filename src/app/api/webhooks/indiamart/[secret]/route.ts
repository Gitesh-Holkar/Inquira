/**
 * IndiaMART Push API endpoint (GOAL G-SRC-1): POST /api/webhooks/indiamart/<secret>.
 * IndiaMART sends one lead as JSON ({ CODE, STATUS, RESPONSE: { UNIQUE_QUERY_ID, … } }) and treats HTTP 200
 * as delivered; anything else is retried, and after 48 hours of refusals IndiaMART switches the push off.
 * So: 200 once the lead is stored (also when it was already there), 404 for an unknown secret, 400 for a
 * request without a lead, 413 for an oversized body, 429 when one address sends too fast, 500 if storing failed.
 */
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { receiveIndiaMartPush } from "@/modules/sources/indiamart/service";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (!rateLimit(`indiamart-push:${clientIp(req)}`, { capacity: 120, refillPerMinute: 120 })) return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "Too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "Not JSON" }, { status: 400 });
  }
  try {
    const r = await receiveIndiaMartPush(secret, body);
    if (!r) return NextResponse.json({ ok: false, error: "Unknown address" }, { status: 404 });
    return NextResponse.json({ ok: true, created: r.created });
  } catch (e) {
    if (e instanceof AppError && e.code === "VALIDATION") return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    console.error("IndiaMART push could not be stored:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Could not store the lead; please retry" }, { status: 500 });
  }
}
