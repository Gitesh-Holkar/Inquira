import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@127.0.0.1:54322/postgres"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  AUTH_MODE: z.enum(["supabase", "dev"]).optional(),
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

/** Dev auth is for local development and tests only and is refused in production (ADR-011). */
export function isDevAuth(): boolean {
  const e = env();
  if (e.AUTH_MODE !== "dev") return false;
  if (e.NODE_ENV === "production" && process.env.INQUIRA_ALLOW_DEV_AUTH_IN_PROD_BUILD !== "1") return false;
  if (e.VERCEL) return false;
  return true;
}

export function appUrl(): string {
  return env().APP_URL.replace(/\/$/, "");
}
