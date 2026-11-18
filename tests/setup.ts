// Per-worker setup: point the app at the test database before any module reads env.
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]+$/, "/inquira_test");
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.CRON_SECRET ??= "test-cron-secret";
process.env.APP_URL ??= "http://localhost:3000";
process.env.DB_POOL_MAX ??= "3";
// Uploaded documents go to a throwaway folder (src/modules/documents/storage.ts).
process.env.FILE_STORAGE ??= "disk";
process.env.FILE_STORAGE_DIR ??= `${process.env.TMPDIR ?? "/tmp"}/inquira-test-files`;

// No test may reach a live service (AGENTS rule 13): only local addresses go through the real fetch.
// Tests pass fakes (tests/helpers/) to the code they call; anything else fails loudly here.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error(`Test tried to reach ${url.origin}`);
  return realFetch(input, init);
}) as typeof fetch;
