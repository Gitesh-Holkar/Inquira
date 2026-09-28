import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/** RFC 9728 protected resource metadata. `resource` must equal the MCP URL users paste into Claude. */
export function GET() {
  const base = appUrl();
  return NextResponse.json(
    { resource: `${base}/api/mcp`, authorization_servers: [base], scopes_supported: ["mcp"], bearer_methods_supported: ["header"], resource_name: "Inquira" },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
