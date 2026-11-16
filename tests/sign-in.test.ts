/**
 * GOAL G-PLT-1 / AGENTS.md rule 5: sign-in is always on. No constant, flag or environment variable
 * may make a visitor a signed-in user in a deployed build. These tests fail if an unauthenticated
 * request reaches a signed-in page, a server action, the OAuth consent action or a protected API
 * route, in any environment combination.
 *
 * History: commit 4a2a5eb set `SIGN_IN_OFF = true` and `signedIn = true` for testing. With that
 * bypass, anyone could register an OAuth client and approve their own connector token.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { resetEnvCache } from "@/lib/env";
import { resetDb, setupOrgWithUser } from "./helpers/db";

// The request has no cookies and no headers unless a test puts a cookie in the jar.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
// If a bypass let an action run, it must fail the test by returning, not by a Next runtime error.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const APP_DIR = path.join(process.cwd(), "src/app");
const UUID = "00000000-0000-4000-8000-000000000000";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** Where a thrown Next redirect points, or null if the call did not redirect. */
async function redirectTarget(run: () => unknown): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? "");
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2] ?? "";
  }
}

/** Environments a deployed build can be in, plus every switch name someone might be tempted to add. */
const DEPLOYED: Record<string, string>[] = [
  { NODE_ENV: "production" },
  { NODE_ENV: "production", AUTH_MODE: "dev" },
  { NODE_ENV: "development", VERCEL: "1", AUTH_MODE: "dev" },
  { NODE_ENV: "production", VERCEL: "1", AUTH_MODE: "dev", INQUIRA_ALLOW_DEV_AUTH_IN_PROD_BUILD: "1" },
  { NODE_ENV: "production", AUTH_DISABLED: "1", SIGN_IN_OFF: "true", TEST_LOGIN_PASSWORD: "x" },
  { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
];

function setEnv(vars: Record<string, string>) {
  vi.unstubAllEnvs();
  for (const k of ["VERCEL", "AUTH_MODE", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  resetEnvCache();
}

beforeEach(async () => {
  jar.clear();
  await resetDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});
afterAll(closeDb);

describe("sign-in is always on (G-PLT-1)", () => {
  it("development sign-in works only in local development, never in a deployed build", async () => {
    const { getSessionUser } = await import("@/lib/auth");
    const { DEV_COOKIE, signDevSession } = await import("@/lib/dev-auth");
    const { user } = await setupOrgWithUser("owner");

    // Sanity: in local development a validly signed cookie is a session (so this test can see one).
    setEnv({ NODE_ENV: "development", AUTH_MODE: "dev" });
    jar.set(DEV_COOKIE, signDevSession(user.id));
    expect(await getSessionUser()).toMatchObject({ id: user.id });
    jar.set(DEV_COOKIE, `${user.id}.forged`);
    expect(await getSessionUser()).toBeNull();

    // The same valid cookie is worth nothing in any deployed build.
    for (const vars of DEPLOYED) {
      setEnv(vars);
      jar.set(DEV_COOKIE, signDevSession(user.id));
      expect(await getSessionUser(), JSON.stringify(vars)).toBeNull();
    }
  });

  it("a visitor with no credentials is never a user, whatever the environment says", async () => {
    const { getSessionUser, getAppSession } = await import("@/lib/auth");
    await setupOrgWithUser("owner"); // an owner exists; a bypass would pick them
    for (const vars of [...DEPLOYED, { NODE_ENV: "development", AUTH_MODE: "dev" }, { NODE_ENV: "test" }]) {
      setEnv(vars);
      expect(await getSessionUser(), JSON.stringify(vars)).toBeNull();
      expect(await getAppSession(), JSON.stringify(vars)).toBeNull();
    }
  });

  it("the proxy sends every unauthenticated page request to /login", async () => {
    const { proxy, config } = await import("@/proxy");
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    const pages = ["/", "/leads", `/leads/${UUID}`, "/review", "/rates", "/templates", "/indiamart", "/settings", "/oauth/authorize", "/anything-else"];
    for (const vars of DEPLOYED) {
      setEnv(vars);
      for (const p of pages) {
        expect(matcher.test(p), `${p} must go through the proxy`).toBe(true);
        const res = await proxy(new NextRequest(`https://app.example${p}`));
        expect(res.status, `${p} ${JSON.stringify(vars)}`).toBe(307);
        expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
      }
    }
  });

  it("every signed-in page and layout redirects an unauthenticated visitor to /login", async () => {
    setEnv({ NODE_ENV: "production" });
    await setupOrgWithUser("owner"); // an owner exists; a bypass would render the page as them
    const files = [...walk(path.join(APP_DIR, "(app)")).filter((f) => /[\\/](page|layout)\.tsx$/.test(f)), path.join(APP_DIR, "oauth/authorize/page.tsx")];
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const file of files) {
      const mod = (await import(file)) as { default: (props: unknown) => unknown };
      const target = await redirectTarget(() =>
        mod.default({ params: Promise.resolve({ id: UUID }), searchParams: Promise.resolve({ client_id: "x", redirect_uri: "https://claude.ai/api/mcp/auth_callback" }), children: null }),
      );
      expect(target, `${path.relative(APP_DIR, file)} rendered without a session`).toMatch(/^\/login/);
    }
  });

  it("every server action redirects an unauthenticated caller to /login before doing anything", async () => {
    setEnv({ NODE_ENV: "production" });
    await setupOrgWithUser("owner");
    // src/app/login/actions.ts is the sign-in form itself and is public by design.
    const files = walk(APP_DIR).filter((f) => /[\\/]actions\.ts$/.test(f) && !f.includes(`${path.sep}login${path.sep}`));
    expect(files.length).toBeGreaterThanOrEqual(6);
    let checked = 0;
    for (const file of files) {
      const mod = (await import(file)) as Record<string, unknown>;
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn !== "function") continue;
        const target = await redirectTarget(() => (fn as (...a: unknown[]) => unknown)(UUID, {}, {}, {}));
        expect(target, `${path.relative(APP_DIR, file)} ${name}() ran without a session`).toBe("/login");
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(25);
    const [{ n }] = (await getDb().execute<{ n: number }>(sql`select count(*)::int as n from app.audit_logs`)) as unknown as [{ n: number }];
    expect(n, "an unauthenticated action wrote to the database").toBe(0);
  });

  it("an unauthenticated visitor cannot approve their own connector token", async () => {
    setEnv({ NODE_ENV: "production" });
    await setupOrgWithUser("owner");
    const { registerOAuthClient } = await import("@/modules/mcp/service");
    const { approveAction, denyAction } = await import("@/app/oauth/authorize/actions");
    // Registering a client is public by protocol; approving it must need a signed-in owner or admin.
    const client = await registerOAuthClient({ redirect_uris: ["https://attacker.example/cb"], client_name: "x" });
    const params = { response_type: "code", client_id: client.client_id, redirect_uri: "https://attacker.example/cb", code_challenge: "a".repeat(43), code_challenge_method: "S256" };
    expect(await redirectTarget(() => approveAction(params))).toBe("/login");
    expect(await redirectTarget(() => denyAction(params))).toBe("/login");
    const [{ codes, tokens }] = (await getDb().execute<{ codes: number; tokens: number }>(
      sql`select (select count(*)::int from app.oauth_codes) as codes, (select count(*)::int from app.mcp_tokens) as tokens`,
    )) as unknown as [{ codes: number; tokens: number }];
    expect({ codes, tokens }).toEqual({ codes: 0, tokens: 0 });
  });

  it("protected API routes refuse requests without their own credentials", async () => {
    setEnv({ NODE_ENV: "production" });
    await setupOrgWithUser("owner");
    const cron = await import("@/app/api/cron/tick/route");
    expect((await cron.POST(new Request("https://app.example/api/cron/tick", { method: "POST" }))).status).toBe(401);
    expect((await cron.POST(new Request("https://app.example/api/cron/tick", { method: "POST", headers: { "x-cron-secret": "wrong-secret-value-123" } }))).status).toBe(401);
    const mcp = await import("@/app/api/mcp/route");
    expect((await mcp.POST(new Request("https://app.example/api/mcp", { method: "POST", body: "{}" }))).status).toBe(401);
    const gmail = await import("@/app/api/integrations/gmail/callback/route");
    const res = await gmail.GET(new Request("https://app.example/api/integrations/gmail/callback?code=abcdef&state=0123456789abc"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});
