import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { OAuthError, tokenEndpoint } from "@/modules/mcp/service";

export const dynamic = "force-dynamic";

/** OAuth token endpoint (application/x-www-form-urlencoded, RFC 6749). Errors use RFC codes (invalid_grant, ...). */
export async function POST(req: Request) {
  if (!rateLimit(`tok:${clientIp(req)}`, { capacity: 30, refillPerMinute: 30 })) return NextResponse.json({ error: "slow_down" }, { status: 429 });
  try {
    const ct = req.headers.get("content-type") ?? "";
    const form = ct.includes("application/json") ? new URLSearchParams((await req.json()) as Record<string, string>) : new URLSearchParams(await req.text());
    let basic: { clientId: string; clientSecret: string } | null = null;
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Basic ")) {
      const [id, secret] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":");
      if (id) basic = { clientId: decodeURIComponent(id), clientSecret: decodeURIComponent(secret ?? "") };
    }
    const tokens = await tokenEndpoint(form, basic);
    return NextResponse.json(tokens, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (e) {
    if (e instanceof OAuthError) return NextResponse.json({ error: e.error, error_description: e.description }, { status: e.status, headers: { "Cache-Control": "no-store" } });
    console.error(e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
