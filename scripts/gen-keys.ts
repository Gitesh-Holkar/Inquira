import { randomBytes } from "node:crypto";
console.log("APP_ENCRYPTION_KEY=" + randomBytes(32).toString("base64"));
console.log("CRON_SECRET=" + randomBytes(24).toString("base64url"));
