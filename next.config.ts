import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import postgres from "postgres";

/**
 * Stops a hosted build when the database is behind the code (ADR-026). A stopped build never
 * replaces the running site, so the live version keeps working until the migrations are applied.
 * Reads only: it compares `drizzle/meta/_journal.json` with `drizzle.__drizzle_migrations`.
 * Runs on Vercel builds, or anywhere with CHECK_MIGRATIONS=1. Any failure to check also stops the build.
 */
async function assertDatabaseIsMigrated() {
  if (process.env.INQUIRA_MIGRATIONS_CHECKED === "1") return; // build workers load this file again
  const stop = (why: string) => new Error(`Inquira build stopped: ${why} The live site keeps running on its current version. See docs/SETUP.md, "Database changes".`);
  const url = process.env.DATABASE_URL;
  if (!url) throw stop("DATABASE_URL is not available to the build, so the database could not be checked.");
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 20, onnotice: () => {} });
  let applied: Set<string>;
  try {
    applied = new Set((await sql<{ hash: string }[]>`select hash from drizzle.__drizzle_migrations`).map((r) => r.hash));
  } catch (e) {
    throw stop(`the database's migration record could not be read (${e instanceof Error ? e.message : "unknown error"}).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
  const missing = journal.entries.filter((e) => !applied.has(createHash("sha256").update(readFileSync(`drizzle/${e.tag}.sql`, "utf8")).digest("hex"))).map((e) => e.tag);
  if (missing.length) throw stop(`the database is missing ${missing.length} migration(s): ${missing.join(", ")}.`);
  process.env.INQUIRA_MIGRATIONS_CHECKED = "1";
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js hydration uses inline scripts; no third-party scripts are loaded.
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      // OAuth consent redirects back to the MCP client (claude.ai or a loopback Claude Code callback).
      "form-action 'self' https: http://localhost:* http://127.0.0.1:*",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // Dev only: let the dev server be opened via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
  serverExternalPackages: ["postgres"],
  // Documents are uploaded through a server action: 4 MB files plus form overhead (src/modules/documents/types.ts).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  async rewrites() {
    // Serve RFC 9728 / 8414 discovery documents from route handlers.
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/well-known/oauth-protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/well-known/oauth-protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/well-known/oauth-authorization-server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/well-known/oauth-authorization-server" },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default async function config(phase: string): Promise<NextConfig> {
  if (phase === PHASE_PRODUCTION_BUILD && (process.env.VERCEL || process.env.CHECK_MIGRATIONS === "1")) await assertDatabaseIsMigrated();
  return nextConfig;
}
