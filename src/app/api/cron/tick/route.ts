import { NextResponse } from "next/server";
import { checkCronSecret, errorResponse } from "@/lib/http";
import { tick } from "@/modules/sources/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Triggered every 10 minutes by Supabase pg_cron + pg_net (docs/SETUP.md §8). */
export async function POST(req: Request) {
  if (!checkCronSecret(req)) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Bad cron secret" } }, { status: 401 });
  try {
    return NextResponse.json(await tick());
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = POST;
