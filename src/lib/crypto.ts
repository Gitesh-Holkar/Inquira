import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new AppError("INTEGRATION", "APP_ENCRYPTION_KEY is not set. Run `npm run gen:keys` and add it to your environment.");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new AppError("INTEGRATION", "APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return buf;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptJson<T = unknown>(blob: string): T {
  const [v, ivB, tagB, ctB] = blob.split(".");
  if (v !== "v1" || !ivB || !tagB || !ctB) throw new AppError("INTEGRATION", "Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Random opaque token with a readable prefix, e.g. inq_mcp_<43 chars>. */
export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
