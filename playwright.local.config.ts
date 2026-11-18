import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * Local mode check (GOAL G-PLT-5) against a running install, for example a fresh `docker compose up`:
 *   docker compose down -v && docker compose up -d --build && npm run test:e2e:local
 * It creates the owner account, so it needs an install nobody has signed in to yet.
 */
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "e2e",
  testMatch: "local-mode.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.LOCAL_URL ?? "http://localhost:3000", trace: "retain-on-failure", launchOptions: executablePath ? { executablePath } : {} },
  projects: [{ name: "local", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } }],
});
