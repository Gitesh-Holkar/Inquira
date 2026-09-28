import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// The cloud build image ships a Chromium that may not match this Playwright version.
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:54322/inquira_e2e",
      AUTH_MODE: "dev",
      APP_URL: `http://localhost:${PORT}`,
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      CRON_SECRET: "e2e-cron-secret-0123456789",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
});
