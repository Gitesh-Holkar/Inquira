import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { appUrl } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { authenticateBearer } from "@/modules/mcp/service";
import { buildMcpServer } from "@/modules/mcp/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized(message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      // Claude starts OAuth only from a 401 carrying resource_metadata (claude.com/docs/connectors/building/authentication).
      "WWW-Authenticate": `Bearer resource_metadata="${appUrl()}/.well-known/oauth-protected-resource", scope="mcp"`,
    },
  });
}

async function handle(req: Request) {
  if (!rateLimit(`mcp:${clientIp(req)}`, { capacity: 120, refillPerMinute: 120 })) {
    return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "Retry-After": "30" } });
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return unauthorized("Authentication required");
  const ctx = await authenticateBearer(token);
  if (!ctx) return unauthorized("Invalid or expired token");

  // Stateless per request: serverless-friendly, no in-memory sessions.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildMcpServer(ctx);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
