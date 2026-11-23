import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { priceListMapSchema } from "./price-list";
import { fromMap, toMap } from "./price-list-map-edit";

describe("price list mapping form (G-KB-6)", () => {
  const folders = readdirSync(path.join(process.cwd(), "seed")).filter((d) => existsSync(path.join(process.cwd(), "seed", d, "price-list-map.json")));

  it("every seed folder's mapping survives the form unchanged", () => {
    for (const d of folders) {
      const raw = JSON.parse(readFileSync(path.join(process.cwd(), "seed", d, "price-list-map.json"), "utf8"));
      const r = toMap(fromMap(raw));
      expect("map" in r, d).toBe(true);
      expect(priceListMapSchema.parse((r as { map: unknown }).map), d).toEqual(priceListMapSchema.parse(raw));
    }
  });

  it("a new name on the list is stored the way the import looks it up; problems are explained", () => {
    const s = fromMap({});
    s.headings.push({ key: "a", heading: "Proteins", gst: "18", pack: "20 Kg", category: "" });
    s.lines.push({ key: "b", name: "  Pea  Isolate – 80% ", product: "Pea Protein Isolate", grade: "80%", aliases: "pea isolate, x" });
    const r = toMap(s) as { map: { lines: Record<string, unknown> } };
    expect(r.map.lines).toEqual({ "pea isolate - 80%": { product: "Pea Protein Isolate", grade: "80%", aliases: ["pea isolate"] } });
    expect(toMap({ ...s, headings: [{ ...s.headings[0]!, gst: "40" }] })).toEqual({ error: expect.stringMatching(/between 0 and 28/) });
    expect(toMap({ ...s, headings: [...s.headings, { ...s.headings[0]!, key: "c" }] })).toEqual({ error: expect.stringMatching(/twice/) });
    expect(toMap({ ...s, lines: [{ ...s.lines[0]!, grade: "" }] })).toEqual({ error: expect.stringMatching(/grade/) });
    expect(toMap({ ...s, moq: "-5" })).toEqual({ error: expect.stringMatching(/MOQ/) });
  });
});
