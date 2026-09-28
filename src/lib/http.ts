import { NextResponse } from "next/server";
import { safeEqual } from "./crypto";
import { AppError, publicMessage } from "./errors";

const STATUS: Record<string, number> = {
  VALIDATION: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, RATE_LIMITED: 429, INTEGRATION: 502, INTERNAL: 500,
};

export function errorResponse(e: unknown) {
  const p = publicMessage(e);
  if (!(e instanceof AppError)) console.error(e);
  return NextResponse.json({ error: p }, { status: STATUS[p.code] ?? 500 });
}

/** Cron endpoints require the x-cron-secret header (or Authorization: Bearer, for Vercel Cron). */
export function checkCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return safeEqual(given, secret);
}
