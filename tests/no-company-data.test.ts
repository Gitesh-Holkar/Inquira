/**
 * AGENTS.md rule 6 and GOAL P6 / G-OSS-2: no company data in code. The first company appears only in its
 * seed folder (seed/<company>/), never in src/. Add other company names here when a company is added.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const NAMES = [/\bstdm\b/i, /stdmfood/i, /STDM Food/i];
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(tsx?|mjs|css|sql)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

describe("no company data in code", () => {
  it("nothing under src/, scripts/ or drizzle/ names a company", () => {
    const hits = ["src", "scripts", "drizzle"].flatMap((d) => files(path.join(process.cwd(), d)))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f: path.relative(process.cwd(), f), i: i + 1, line })))
      .filter(({ line }) => NAMES.some((re) => re.test(line)));
    expect(hits.map((h) => `${h.f}:${h.i}: ${h.line.trim().slice(0, 120)}`)).toEqual([]);
  });
});
