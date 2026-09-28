// Per-worker setup: point the app at the test database before any module reads env.
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]+$/, "/inquira_test");
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.CRON_SECRET ??= "test-cron-secret";
process.env.APP_URL ??= "http://localhost:3000";
process.env.DB_POOL_MAX ??= "3";
