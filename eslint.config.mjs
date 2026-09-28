import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const MODULES = ["core", "contacts", "leads", "sources", "email", "catalog", "templates", "quotes", "mcp", "buyleads", "dashboard"];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Module boundaries (brief §6.1): a module may call another module's services, never query its tables.
  ...MODULES.map((m) => ({
    files: [`src/modules/${m}/**/*.ts`, `src/modules/${m}/**/*.tsx`],
    ignores: [`src/modules/${m}/schema.ts`, "**/*.test.ts"], // FK references in schema files; tests assert on tables
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: MODULES.filter((x) => x !== m).map((x) => `@/modules/${x}/schema`), message: "Call that module's service instead of querying its tables." }] }],
    },
  })),
  // The UI goes through services only.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/modules/*/schema", "@/db/*"], message: "UI code must call services, not the database." }] }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "drizzle/**", ".pgdata/**"]),
]);
