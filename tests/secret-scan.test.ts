/**
 * Secret and personal-data scan (GOAL G-OSS-4, AGENTS.md rules 2 and 3). Reads every file git tracks or would add, and fails on
 * anything that looks like a real key, token, private key or database password, on a tracked `.env` file, and on
 * an Indian mobile number outside the made-up ranges the fixtures use. Fakes in tests stay short or obviously fake
 * (for example "GOCSPX-secret-123"), so they do not match the real formats below.
 *
 * If this fails on a real secret: remove it, rotate the key at its provider (it is in git history now), and keep
 * the new one in `.env.local` or the host's environment settings.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Tracked files plus new ones not ignored yet (what the next commit can contain). */
const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);

function textOf(file: string): string | null {
  try {
    const buf = readFileSync(file);
    return buf.includes(0) ? null : buf.toString("utf8"); // skip images and other binary files
  } catch {
    return null; // listed by git but deleted in the working tree
  }
}

const files = tracked.map((f) => ({ f, text: textOf(f) })).filter((x): x is { f: string; text: string } => x.text !== null);

/** Real formats, with their real lengths. */
const SECRET_PATTERNS: [string, RegExp][] = [
  ["private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Google OAuth client secret", /\bGOCSPX-[0-9A-Za-z_-]{28}\b/],
  ["Google refresh token", /\b1\/\/0[0-9A-Za-z_-]{40,}/],
  ["Google access token", /\bya29\.[0-9A-Za-z_-]{30,}/],
  ["Anthropic key", /\bsk-ant-[0-9A-Za-z_-]{30,}/],
  ["OpenAI-style key", /\bsk-(?:proj-)?[0-9A-Za-z_-]{40,}/],
  ["GitHub token", /\b(?:gh[pousr]_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{40,})\b/],
  ["Supabase access token", /\bsbp_[0-9a-f]{40}\b/],
  ["Supabase secret key", /\bsb_secret_[0-9A-Za-z_-]{20,}/],
  ["signed JWT (for example a Supabase service-role key)", /\beyJ[0-9A-Za-z_-]{15,}\.eyJ[0-9A-Za-z_-]{15,}\.[0-9A-Za-z_-]{20,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[0-9A-Za-z-]{20,}/],
  ["Inquira MCP token", /\binq_mcp_[0-9A-Za-z_-]{20,}/],
];

/** Database URLs may only carry the local development passwords or a placeholder. */
const DB_URL = /\bpostgres(?:ql)?:\/\/[^:/\s"'`]+:([^@\s"'`]+)@/g;
const OK_DB_PASSWORDS = new Set(["postgres", "inquira-local", "YOUR-PASSWORD", "password"]);

/** Made-up Indian mobile numbers: 90000 xxxxx, 79000 xxxxx, 98765 43210, or one digit repeated. */
const PHONE = /\+91[ .-]?([6-9]\d{4})[ -]?(\d{5})\b/g;
const isFakePhone = (n: string) => /^(?:90000|79000)/.test(n) || n === "9876543210" || /^\d(\d)\1{8}$/.test(n);

describe("secret scan over every tracked file", () => {
  it("tracks no .env file other than .env.example, and no key files", () => {
    const bad = tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example") || /\.(pem|p12|pfx|key)$/i.test(f));
    expect(bad).toEqual([]);
  });

  it("contains no real-looking keys or tokens", () => {
    const hits = files.flatMap(({ f, text }) => SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => `${f}: ${name}`));
    expect(hits).toEqual([]);
  });

  it("database URLs carry only local or placeholder passwords", () => {
    const hits = files.flatMap(({ f, text }) => [...text.matchAll(DB_URL)]
      .filter((m) => !OK_DB_PASSWORDS.has(m[1]!) && !/[${]/.test(m[1]!))
      .map(() => `${f}: database URL with a password`));
    expect(hits).toEqual([]);
  });

  it("phone numbers are the made-up ones (no real buyer data)", () => {
    const hits = files.flatMap(({ f, text }) => [...text.matchAll(PHONE)]
      .filter((m) => !isFakePhone(m[1]! + m[2]!))
      .map((m) => `${f}: +91 ${m[1]!.slice(0, 2)}… (use +91 90000 xxxxx in fixtures)`));
    expect(hits).toEqual([]);
  });

  it("would catch a real key (the scan itself works)", () => {
    const sample = ["AIza", "Sy", "A".repeat(33)].join("");
    expect(SECRET_PATTERNS.some(([, re]) => re.test(sample))).toBe(true);
    expect(isFakePhone("9812345678")).toBe(false);
    expect(isFakePhone("9000012345")).toBe(true);
  });
});
