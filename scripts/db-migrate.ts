/**
 * Applies drizzle/ migrations using a direct Postgres connection (DATABASE_URL).
 * Use from your own machine, CI, or locally. For the cloud build container (no TCP egress)
 * use `npm run db:remote:apply` instead — it records migrations in the same table.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  console.log("Migrations applied to", url.replace(/:[^:@/]+@/, ":****@"));
} finally {
  await client.end();
}
