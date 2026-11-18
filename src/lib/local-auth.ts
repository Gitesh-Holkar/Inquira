/**
 * Local sign-in (AUTH_MODE=local, GOAL G-PLT-5): email and password checked by Inquira itself, for running
 * on your own computer without Supabase. Accounts live in the local `auth.users` table
 * (scripts/local-db/supabase-shim.sql): the password as a scrypt hash in `encrypted_password`, and one-time
 * sign-in links as a SHA-256 hash with an expiry.
 *
 * The session cookie is `<user id>.<expiry>.<mac>`, signed with APP_ENCRYPTION_KEY. The signature also covers
 * a fingerprint of the password hash, so changing a password signs out every other browser.
 * Nobody is ever signed in without a password; the only account created without one is the first owner on a
 * fresh install, who sets it on the same screen (`createFirstOwner`).
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { AppError } from "./errors";
import { env } from "./env";
import { safeEqual } from "./crypto";

export const SESSION_COOKIE = "inquira_session";
export const SESSION_DAYS = 30;
export const SETUP_LINK_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 10;

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (e, k) => (e ? reject(e) : resolve(k))));
const SCRYPT = { N: 16384, r: 8, p: 1 };

/** `scrypt$N$r$p$<salt>$<hash>` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AppError("VALIDATION", `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash!, "base64url");
  const key = await scrypt(password, Buffer.from(salt!, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return expected.length === key.length && timingSafeEqual(expected, key);
}

function sessionKey(): string {
  const k = env().APP_ENCRYPTION_KEY;
  if (!k) throw new AppError("INTERNAL", "APP_ENCRYPTION_KEY is not set, so local sign-in cannot sign sessions.");
  return k;
}
const fingerprint = (passwordHash: string) => createHash("sha256").update(passwordHash).digest("base64url").slice(0, 16);
const mac = (payload: string) => createHmac("sha256", sessionKey()).update(payload).digest("base64url");

export function signSession(userId: string, passwordHash: string, now = Date.now()): { value: string; expires: Date } {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  return { value: `${userId}.${exp}.${mac(`${userId}.${exp}.${fingerprint(passwordHash)}`)}`, expires: new Date(exp * 1000) };
}

/** The user id in a valid, unexpired cookie whose password has not changed since; otherwise null. */
export async function verifySession(value: string | null | undefined, now = Date.now()): Promise<{ id: string; email: string } | null> {
  const [id, exp, sig] = (value ?? "").split(".");
  if (!id || !exp || !sig || !/^[0-9a-f-]{36}$/.test(id) || !/^\d+$/.test(exp) || Number(exp) * 1000 <= now) return null;
  const user = await findLocalUserById(id);
  if (!user?.passwordHash) return null;
  return safeEqual(sig, mac(`${id}.${exp}.${fingerprint(user.passwordHash)}`)) ? { id, email: user.email } : null;
}

type LocalUser = { id: string; email: string; passwordHash: string | null };
export async function findLocalUserById(id: string): Promise<LocalUser | null> {
  const [r] = await getDb().execute<{ id: string; email: string; encrypted_password: string | null }>(sql`select id, email, encrypted_password from auth.users where id = ${id}`);
  return r ? { id: r.id, email: r.email, passwordHash: r.encrypted_password } : null;
}
export async function findLocalUserByEmail(email: string): Promise<LocalUser | null> {
  const [r] = await getDb().execute<{ id: string; email: string; encrypted_password: string | null }>(sql`select id, email, encrypted_password from auth.users where lower(email) = ${email.trim().toLowerCase()}`);
  return r ? { id: r.id, email: r.email, passwordHash: r.encrypted_password } : null;
}

/** Sets a password and ends any open sign-in link. Returns the new hash (for signing the session). */
export async function setLocalPassword(userId: string, password: string): Promise<string> {
  const hash = await hashPassword(password);
  await getDb().execute(sql`update auth.users set encrypted_password = ${hash}, setup_token_hash = null, setup_token_expires_at = null where id = ${userId}`);
  return hash;
}

/** A one-time link to set a password (new member, or a forgotten password). Replaces any earlier link. */
export async function createSetupLink(userId: string, baseUrl: string, now = Date.now()): Promise<{ url: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now + SETUP_LINK_DAYS * 86400_000);
  await getDb().execute(sql`update auth.users set setup_token_hash = ${createHash("sha256").update(token).digest("hex")}, setup_token_expires_at = ${expires.toISOString()}::timestamptz where id = ${userId}`);
  return { url: `${baseUrl.replace(/\/$/, "")}/login/set-password?token=${token}`, expires };
}

/** Uses a sign-in link once: sets the password and returns the user, or null if the link is unknown, used or expired. */
export async function redeemSetupLink(token: string, password: string, now = Date.now()): Promise<{ id: string; email: string; passwordHash: string } | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const hashToken = createHash("sha256").update(token).digest("hex");
  const [r] = await getDb().execute<{ id: string; email: string; setup_token_expires_at: Date | null }>(
    sql`select id, email, setup_token_expires_at from auth.users where setup_token_hash = ${hashToken}`);
  if (!r || !r.setup_token_expires_at || new Date(r.setup_token_expires_at).getTime() <= now) return null;
  const passwordHash = await setLocalPassword(r.id, password);
  return { id: r.id, email: r.email, passwordHash };
}
