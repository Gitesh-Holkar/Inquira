import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/modules/*/schema.ts",
  casing: "snake_case",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres" },
  schemaFilter: ["app"],
  strict: true,
  verbose: true,
});
