import { createHmac } from "node:crypto";
import { safeEqual } from "./crypto";

export const DEV_COOKIE = "inquira_dev_session";

function secret() {
  return process.env.APP_ENCRYPTION_KEY || process.env.CRON_SECRET || "dev-only-secret";
}

export function signDevSession(userId: string) {
  const mac = createHmac("sha256", secret()).update(userId).digest("base64url");
  return `${userId}.${mac}`;
}

export function verifyDevSession(value: string | undefined | null): string | null {
  if (!value) return null;
  const [userId, mac] = value.split(".");
  if (!userId || !mac) return null;
  return safeEqual(mac, createHmac("sha256", secret()).update(userId).digest("base64url")) ? userId : null;
}
