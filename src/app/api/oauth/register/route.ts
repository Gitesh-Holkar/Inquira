import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { OAuthError, registerOAuthClient } from "@/modules/mcp/service";

export const dynamic = "force-dynamic";

/** RFC 7591 Dynamic Client Registration (JSON). Public, rate limited. */
export async function POST(req: Request) {
  if (!rateLimit(`dcr:${clientIp(req)}`, { capacity: 10, refillPerMinute: 5 })) return NextResponse.json({ error: "slow_down" }, { status: 429 });
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json(await registerOAuthClient(body), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OAuthError) return NextResponse.json({ error: e.error, error_description: e.description }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
