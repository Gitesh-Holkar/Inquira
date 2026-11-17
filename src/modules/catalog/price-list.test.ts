/** Price list import, pure part (GOAL G-KB-6): reading the text, matching lines, and planning the changes. */
import { describe, expect, it } from "vitest";
import { describePlan, normalizeListName, parsePriceList, planCounts, planImport, planSections, type CatalogForImport, type RateTerms } from "./price-list";

const rate = (price: string, over: Partial<RateTerms> = {}): RateTerms => ({ pricePerKgInr: price, gstPercent: "18.00", moqKg: null, packSize: "20 Kg", priceBasis: "Ex-factory", needsConfirmation: false, ...over });
const catalog: CatalogForImport = [
  { id: "p1", name: "Alpha Protein Isolate", aliases: ["alpha isolate protein"], grades: [{ id: "g1", name: "Standard", current: rate("350.00") }] },
  { id: "p2", name: "Beta Starch", aliases: [], grades: [{ id: "g2", name: "Native", current: rate("50.00", { gstPercent: "5.00", packSize: "25 Kg" }) }, { id: "g3", name: "Waxy", current: rate("60.00", { gstPercent: "5.00", packSize: "25 Kg" }) }] },
  { id: "p3", name: "Gamma Fiber", aliases: [], grades: [{ id: "g4", name: "Standard", current: rate("275.00", { gstPercent: "5.00", packSize: "25 Kg", needsConfirmation: true }) }, { id: "g5", name: "Insoluble", current: rate("140.00", { gstPercent: "5.00", packSize: "25 Kg" }) }] },
  { id: "p4", name: "Delta Lecithin", aliases: [], defaultGstPercent: "18.00", defaultPackSize: "25 Kg", grades: [{ id: "g6", name: "30%", current: null }] },
];
const plan = (text: string, map?: unknown, defaults = { priceBasis: "Ex-factory" }) => planImport(parsePriceList(text), catalog, map, defaults);

describe("parsePriceList", () => {
  it("reads every way a price is typed, keeps headings and qualifiers, and keeps the raw line", () => {
    const p = parsePriceList(["Proteins:", "Alpha Isolate Protein - 350 Rs/Kg", "Beta Protein – 485 Rs/Kg (White)", "Gamma - 485/kgs", "Delta - 1,250.50 Rs/kg", "Starches:", "E1442 Epsilon - 275 Rs/Kg {Cold Water Soluble}", "Zeta Starch (Native) — 60 Rs/Kg"].join("\r\n"));
    expect(p.unparsed).toEqual([]);
    expect(p.lines.map((l) => [l.category, l.name, l.pricePerKg, l.qualifier])).toEqual([
      ["Proteins", "Alpha Isolate Protein", "350", null], ["Proteins", "Beta Protein", "485", "White"], ["Proteins", "Gamma", "485", null], ["Proteins", "Delta", "1250.50", null],
      ["Starches", "E1442 Epsilon", "275", "Cold Water Soluble"], ["Starches", "Zeta Starch (Native)", "60", null],
    ]);
    expect(p.lines[1]!.rawLine).toBe("Beta Protein – 485 Rs/Kg (White)");
  });

  it("separates two items typed without a line break, and a heading typed on the item's line, with a warning", () => {
    const p = parsePriceList("Saccharides:Alpha Powder - 700 Rs/Kg\nBeta Powder – 350 Rs/KgGamma Powder – 450 Rs/Kg");
    expect(p.lines.map((l) => [l.category, l.name, l.pricePerKg])).toEqual([["Saccharides", "Alpha Powder", "700"], ["Saccharides", "Beta Powder", "350"], ["Saccharides", "Gamma Powder", "450"]]);
    expect(p.lines[0]!.warnings).toEqual(["A heading and an item share one paragraph"]);
    expect(p.lines[2]!.warnings).toEqual(["Two items share one paragraph"]);
  });

  it("never drops or mis-reads a line it does not understand", () => {
    const p = parsePriceList("Alpha - call for price\nBeta 350 Rs/Kg - Gamma - 450 Rs/Kg\nDelta - 10 Rs/Kg");
    expect(p.unparsed).toEqual(["Alpha - call for price", "Beta 350 Rs/Kg - Gamma - 450 Rs/Kg"]);
    expect(p.lines.map((l) => l.name)).toEqual(["Delta"]);
  });

  it("keeps the GST section apart from the items", () => {
    const p = parsePriceList("Alpha - 10 Rs/Kg\nGST Rates\n18%\nProtein Derivatives – 20 Kg");
    expect(p.lines).toHaveLength(1);
    expect(p.footer).toEqual(["GST Rates", "18%", "Protein Derivatives – 20 Kg"]);
  });
});

describe("planImport", () => {
  it("matches by name, alias, a grade in brackets, a grade at the end of the name and a qualifier", () => {
    const r = plan("Alpha Isolate Protein - 350 Rs/Kg\nBeta Starch (Waxy) - 95 Rs/Kg\nGamma Fiber Insoluble - 140 Rs/Kg\nBeta Starch - 60 Rs/Kg (Native)").rows;
    expect(r.map((x) => [x.product, x.grade, x.gradeId, x.kind])).toEqual([
      ["Alpha Protein Isolate", "Standard", "g1", "unchanged"], ["Beta Starch", "Waxy", "g3", "price_change"], ["Gamma Fiber", "Insoluble", "g5", "unchanged"], ["Beta Starch", "Native", "g2", "price_change"],
    ]);
  });

  it("keeps GST, pack size, MOQ and the check mark of the current rate when no mapping covers the line", () => {
    const [row] = plan("Gamma Fiber - 300 Rs/Kg").rows;
    expect(row!.next).toMatchObject({ pricePerKgInr: "300", gstPercent: "5", packSize: "25 Kg", moqKg: null, priceBasis: "Ex-factory", needsConfirmation: true, note: 'Price list: "Gamma Fiber - 300 Rs/Kg"' });
  });

  it("uses the product's own GST and pack size for a first rate, and the company's price basis", () => {
    const [row] = plan("Delta Lecithin 30% - 650 Rs/Kg", undefined, { priceBasis: "FOR destination" }).rows;
    expect(row).toMatchObject({ kind: "new_rate", gradeId: "g6", problems: [] });
    expect(row!.next).toMatchObject({ gstPercent: "18", packSize: "25 Kg", priceBasis: "FOR destination" });
  });

  it("does not invent a GST rate: an unknown product without a mapping is reported and not written", () => {
    const p = plan("Omega Powder - 99 Rs/Kg");
    expect(p.rows[0]).toMatchObject({ kind: "new_product", next: null });
    expect(p.rows[0]!.problems[0]).toMatch(/no GST rate is known/);
    expect(planCounts(p)).toEqual({ read: 1, toWrite: 0, unchanged: 0, problems: 1 });
  });

  it("applies the company's mapping: heading terms, product overrides, named lines, renames and reasons to check", () => {
    const map = {
      terms: { price_basis: "Ex-factory", moq_kg: 100 },
      categories: { Fibers: { gst_percent: 5, pack_size: "25 Kg", catalog_category: "Fiber" }, Lecithin: { gst_percent: 18, pack_size: "25 Kg", needs_confirmation: "GST to confirm" } },
      product_overrides: { "Omega Flour": { pack_size: "25/50 Kg" } },
      lines: { "gamma fiber soluble": { product: "Gamma Fiber", grade: "Soluble", was_grade: "Standard", aliases: ["Gamma Fibre"] }, "omega flour": { product: "Omega Flour", grade: "Standard" } },
    };
    const p = plan("Fibers:\nGamma Fiber Soluble - 275 Rs/Kg\nOmega Flour - 95 Rs/Kg\nLecithin:\nDelta Lecithin 30% - 650 Rs/Kg", map);
    const [renamed, created, lecithin] = p.rows;
    expect(renamed).toMatchObject({ gradeId: "g4", grade: "Soluble", renameGradeFrom: "Standard", kind: "terms_change", aliases: ["gamma fibre"], resolvedBy: "map" });
    expect(renamed!.next).toMatchObject({ moqKg: "100", needsConfirmation: false }); // the mapping covers the line, so the old mark is cleared
    expect(created).toMatchObject({ kind: "new_product", product: "Omega Flour", catalogCategory: "Fiber", problems: [] });
    expect(created!.next).toMatchObject({ gstPercent: "5", packSize: "25/50 Kg", moqKg: "100" });
    expect(lecithin!.next).toMatchObject({ needsConfirmation: true, note: 'GST to confirm. Price list: "Delta Lecithin 30% - 650 Rs/Kg"' });
    expect(planCounts(p)).toMatchObject({ toWrite: 3, problems: 0 });
  });

  it("reports rates that are not on the list instead of removing them, and two lines for one grade", () => {
    const p = plan("Alpha Isolate Protein - 350 Rs/Kg\nAlpha Protein Isolate - 360 Rs/Kg");
    expect(p.rows[1]!.problems).toEqual(["Another line on this list maps to the same product and grade"]);
    expect(p.notOnList.map((g) => `${g.product}/${g.grade}`)).toEqual(["Beta Starch/Native", "Beta Starch/Waxy", "Gamma Fiber/Standard", "Gamma Fiber/Insoluble"]);
  });

  it("says when the list's GST section is not the one the mapping was written for", () => {
    const map = { footer: ["GST Rates", "18%"] };
    expect(plan("Alpha Isolate Protein - 350 Rs/Kg\nGST Rates\n18%", map).footerChanged).toBe(false);
    expect(plan("Alpha Isolate Protein - 350 Rs/Kg\nGST Rates\n12%", map).footerChanged).toBe(true);
    expect(plan("Alpha Isolate Protein - 350 Rs/Kg", map).footerChanged).toBe(false); // a partial list has no GST section to compare
  });

  it("rejects a mapping with a wrong shape", () => {
    expect(() => plan("Alpha - 1 Rs/Kg", { categories: { Proteins: { gst_percent: 40, pack_size: "20 Kg" } } })).toThrow();
  });
});

describe("the report the owner confirms", () => {
  it("lists changes under plain headings and groups one reason into one line", () => {
    const map = { categories: { Lecithin: { gst_percent: 18, pack_size: "25 Kg", needs_confirmation: "GST to confirm" } } };
    const p = plan("Beta Starch (Native) - 60 Rs/Kg\nOmega Powder - 9 Rs/Kg\nLecithin:\nDelta Lecithin 30% - 650 Rs/Kg\nnot a price line", map);
    const sections = Object.fromEntries(planSections(p).map((s) => [s.title, s.lines]));
    expect(sections["Price changes"]).toEqual(["Beta Starch (Native): ₹50 → ₹60"]);
    expect(sections["New grades and first rates for products already in the catalogue"]).toEqual(["Delta Lecithin (30%): ₹650/kg, GST 18%, pack 25 Kg, MOQ —"]);
    expect(sections["Marked for you to check"]).toEqual(["GST to confirm: Delta Lecithin (30%)"]);
    expect(sections["Will NOT be written"]![0]).toMatch(/^Omega Powder: /);
    expect(sections["Lines that could not be read"]).toEqual(["not a price line"]);
    expect(describePlan(p)).toMatch(/^3 lines read: 2 to write, 0 unchanged, 2 with a problem\./);
  });

  it("normalises names the same way for the mapping and the list", () => {
    expect(normalizeListName("  E1442  Hydroxypropyl – Starch ", "Cold  Water Soluble")).toBe("e1442 hydroxypropyl - starch {cold water soluble}");
  });
});
