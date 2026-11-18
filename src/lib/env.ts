import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@127.0.0.1:54322/postgres"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  /** supabase (cloud), local (own passwords, for running on your own computer), dev (local development and tests only). */
  AUTH_MODE: z.enum(["supabase", "local", "dev"]).optional(),
  /** Where uploaded documents are kept: Supabase Storage or a folder on disk (src/modules/documents/storage.ts). */
  FILE_STORAGE: z.enum(["supabase", "disk"]).optional(),
  FILE_STORAGE_DIR: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  NODE_ENV: z.string().default("development"),
  VERCEL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

/** Parsed lazily so `next build` doesn't need runtime secrets. */
export function env(): Env {
  if (!cached) {
    // Treat empty strings (common in dashboards and .env files) as "not set".
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
    cached = schema.parse(raw);
  }
  return cached;
}

export function resetEnvCache() {
  cached = null;
}

/**
 * Development sign-in (ADR-011) is for local development and tests only. It is refused in every
 * deployed build: a production build or any Vercel deployment. No other switch exists, and none may
 * be added (GOAL G-PLT-1, AGENTS.md rule 5); tests/sign-in.test.ts fails if one appears.
 */
export function isDevAuth(): boolean {
  const e = env();
  if (e.AUTH_MODE !== "dev") return false;
  if (e.NODE_ENV === "production") return false;
  if (e.VERCEL) return false;
  return true;
}

/** Local sign-in (src/lib/local-auth.ts): real passwords, allowed in any build. */
export function isLocalAuth(): boolean {
  return env().AUTH_MODE === "local";
}

export function appUrl(): string {
  return env().APP_URL.replace(/\/$/, "");
}
