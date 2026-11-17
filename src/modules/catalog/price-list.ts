/**
 * Price list import, pure part (GOAL G-KB-6): read a company's price list, match each line to a
 * catalogue product and grade, and work out what would change. Nothing here touches the database;
 * `planPriceListImport` / `applyPriceListImport` in service.ts do.
 *
 * A price list is plain text, one item per line: "<name> - <price> Rs/Kg", optionally followed by a
 * qualifier in brackets, grouped under headings that end with ":". A "GST Rates" section may follow.
 * Nothing is guessed: a line that cannot be read is reported, and GST, pack size and MOQ come only
 * from the company's mapping file or from the grade's current rate.
 */
import { z } from "zod";

export type PriceListLine = {
  /** The heading the line sits under, without the colon. */
  category: string | null;
  /** The product name exactly as printed (brackets inside the name are kept). */
  name: string;
  /** Text in () or {} after the price, e.g. "Cold Water Soluble". */
  qualifier: string | null;
  /** Rupees per kg as printed, digits only. */
  pricePerKg: string;
  /** The whole paragraph the line came from. */
  rawLine: string;
  warnings: string[];
};
export type ParsedPriceList = { lines: PriceListLine[]; footer: string[]; unparsed: string[] };

// "<name> - <price> [Rs]/Kg[s] [(qualifier)]". Case is spelled out instead of using the i flag so that
// "Rs/KgInulin Powder" (two items typed without a line break) still ends the first item at "Kg".
const ITEM = /(.+?)\s*[-–—]\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:[Rr][Ss]\.?)?\s*\/\s*[Kk][Gg](?:[Ss]\b|(?![a-z]))\.?[ \t]*(\([^)]*\)|\{[^}]*\})?/g;
/** A price inside what was read as a name means the line was not understood. */
const PRICE_IN_NAME = /\d\s*(?:rs\.?)?\s*\/\s*kg/i;
const HEADING = /^([A-Za-z][A-Za-z0-9 /&,-]{1,60}):\s*/;

/** Reads the text of a price list. Lines it cannot read end up in `unparsed`, never dropped. */
export function parsePriceList(text: string): ParsedPriceList {
  const out: ParsedPriceList = { lines: [], footer: [], unparsed: [] };
  let category: string | null = null;
  let inFooter = false;
  for (const paragraph of text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (inFooter || /^GST Rates\b/i.test(paragraph)) {
      inFooter = true;
      out.footer.push(paragraph);
      continue;
    }
    let rest = paragraph;
    const warnings: string[] = [];
    const heading = rest.match(HEADING);
    if (heading) {
      category = heading[1]!.trim();
      rest = rest.slice(heading[0].length);
      if (!rest) continue;
      warnings.push("A heading and an item share one paragraph");
    }
    const items = [...rest.matchAll(ITEM)];
    if (!items.length || items.some((m) => PRICE_IN_NAME.test(m[1]!))) {
      out.unparsed.push(paragraph);
      continue;
    }
    if (items.length > 1) warnings.push("Two items share one paragraph");
    const consumed = items.reduce((n, m) => n + m[0].length, 0);
    if (rest.length - consumed > 2) warnings.push("Part of this paragraph could not be read");
    for (const m of items) {
      out.lines.push({
        category, name: m[1]!.trim(), qualifier: m[3] ? m[3].slice(1, -1).trim() || null : null,
        pricePerKg: m[2]!.replace(/,/g, ""), rawLine: paragraph, warnings: [...warnings],
      });
    }
  }
  return out;
}

/** Key for comparing names: lower case, one kind of dash, single spaces. */
export function normalizeListName(name: string, qualifier?: string | null): string {
  const n = name.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  return qualifier ? `${n} {${qualifier.toLowerCase().replace(/\s+/g, " ").trim()}}` : n;
}

/**
 * The company's own reading of its price list: which line is which product and grade, and the GST,
 * pack size and other terms per heading. It is data (kept with the company's seed files), never code.
 */
export const priceListMapSchema = z.object({
  /** Terms that apply to every line unless a category or product says otherwise. */
  terms: z.object({ price_basis: z.string().optional(), moq_kg: z.number().positive().nullable().optional() }).default({}),
  /** Heading on the list → terms and the catalogue category for new products. */
  categories: z.record(z.string(), z.object({
    gst_percent: z.number().min(0).max(28), pack_size: z.string(), catalog_category: z.string().optional(), needs_confirmation: z.string().optional(),
  })).default({}),
  /** Product name → terms that differ from its category. */
  product_overrides: z.record(z.string(), z.object({ gst_percent: z.number().min(0).max(28).optional(), pack_size: z.string().optional() })).default({}),
  /** Normalised list name (see normalizeListName) → the catalogue product and grade it means. */
  lines: z.record(z.string(), z.object({
    product: z.string(), grade: z.string(),
    /** The grade's current name, when the list renamed it. */
    was_grade: z.string().optional(),
    /** Why a person should check this rate; shows the "Confirm" badge on the Rates screen. */
    needs_confirmation: z.string().optional(),
    /** Other spellings buyers use for this product (lower case). Added to the product's aliases. */
    aliases: z.array(z.string().trim().toLowerCase().min(2).max(120)).max(20).optional(),
  })).default({}),
  /** The list's GST section this mapping was written for; a different footer is reported. */
  footer: z.array(z.string()).default([]),
});
export type PriceListMap = z.infer<typeof priceListMapSchema>;

export type CatalogForImport = {
  id: string; name: string; aliases: string[];
  /** The product's own GST % and pack size, used when neither the mapping nor a current rate gives them. */
  defaultGstPercent?: string | null; defaultPackSize?: string | null;
  grades: { id: string; name: string; current: RateTerms | null }[];
}[];
export type RateTerms = { pricePerKgInr: string; gstPercent: string; moqKg: string | null; packSize: string | null; priceBasis: string; needsConfirmation: boolean };

export type PlanRow = {
  line: PriceListLine;
  product: string;
  grade: string;
  productId: string | null;
  gradeId: string | null;
  renameGradeFrom: string | null;
  resolvedBy: "map" | "catalogue" | "new";
  /** Spellings to add to the product's aliases (from the mapping). */
  aliases: string[];
  kind: "unchanged" | "price_change" | "terms_change" | "new_rate" | "new_grade" | "new_product";
  current: RateTerms | null;
  next: (RateTerms & { note: string }) | null;
  /** Catalogue category for a product that will be created. */
  catalogCategory: string | null;
  /** Reasons the row cannot be written (for example no GST rate known). */
  problems: string[];
};
export type ImportPlan = {
  rows: PlanRow[];
  /** Grades with a current rate that the list does not mention. They are kept and reported, never removed. */
  notOnList: { product: string; grade: string; pricePerKgInr: string }[];
  unparsed: string[];
  footerChanged: boolean;
};

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const sameNum = (a: string | number | null | undefined, b: string | number | null | undefined) => num(a) === num(b);

function resolve(line: PriceListLine, catalog: CatalogForImport, map: PriceListMap): Pick<PlanRow, "product" | "grade" | "productId" | "gradeId" | "renameGradeFrom" | "resolvedBy"> {
  const byName = (name: string) => catalog.find((p) => normalizeListName(p.name) === normalizeListName(name));
  const gradeOf = (p: CatalogForImport[number] | undefined, grade: string) => p?.grades.find((g) => g.name.toLowerCase() === grade.toLowerCase());

  const decided = map.lines[normalizeListName(line.name, line.qualifier)];
  if (decided) {
    const p = byName(decided.product);
    const g = gradeOf(p, decided.grade);
    const old = !g && decided.was_grade ? gradeOf(p, decided.was_grade) : undefined;
    return { product: p?.name ?? decided.product, grade: decided.grade, productId: p?.id ?? null, gradeId: (g ?? old)?.id ?? null, renameGradeFrom: old ? old.name : null, resolvedBy: "map" };
  }

  // Without a decision: the catalogue's own names and aliases, compared exactly.
  const named = (n: string) => catalog.find((p) => [p.name, ...p.aliases].some((a) => normalizeListName(a) === n));
  const pick = (p: CatalogForImport[number], grade: string | null) => {
    const g = grade ? gradeOf(p, grade) : (gradeOf(p, "Standard") ?? (p.grades.length === 1 ? p.grades[0] : undefined));
    return { product: p.name, grade: g?.name ?? grade ?? "Standard", productId: p.id, gradeId: g?.id ?? null, renameGradeFrom: null, resolvedBy: "catalogue" as const };
  };
  const n = normalizeListName(line.name);
  const whole = named(n);
  if (whole) return pick(whole, line.qualifier);
  if (!line.qualifier) {
    // "Potato Starch (Native)" or "Potato Fiber Soluble": the end of the name may be a grade of a known product.
    const bracket = line.name.match(/^(.*\S)\s*\(([^)]+)\)$/);
    if (bracket) {
      const p = named(normalizeListName(bracket[1]!));
      if (p && gradeOf(p, bracket[2]!)) return pick(p, bracket[2]!);
    }
    const words = line.name.split(" ");
    for (let k = 1; k <= 3 && k < words.length; k++) {
      const p = named(normalizeListName(words.slice(0, -k).join(" ")));
      const tail = words.slice(-k).join(" ");
      if (p && gradeOf(p, tail)) return pick(p, tail);
    }
  }
  return { product: line.name, grade: line.qualifier ?? "Standard", productId: null, gradeId: null, renameGradeFrom: null, resolvedBy: "new" };
}

/**
 * Works out what importing `parsed` would do to `catalog`. Pure: the same inputs give the same plan.
 * Terms come from the mapping (category, then product override), else from the grade's current rate.
 */
export function planImport(parsed: ParsedPriceList, catalog: CatalogForImport, rawMap?: unknown, defaults: { priceBasis?: string | null; removedNames?: string[] } = {}): ImportPlan {
  const removed = new Set((defaults.removedNames ?? []).map((n) => normalizeListName(n)));
  const map = priceListMapSchema.parse(rawMap ?? {});
  const seen = new Set<string>();
  const rows: PlanRow[] = parsed.lines.map((line) => {
    const r = resolve(line, catalog, map);
    const problems: string[] = [];
    const product = catalog.find((p) => p.id === r.productId);
    const current = product?.grades.find((g) => g.id === r.gradeId)?.current ?? null;
    const cat = line.category ? map.categories[line.category] : undefined;
    const over = map.product_overrides[r.product];
    const gst = over?.gst_percent ?? cat?.gst_percent ?? num(current?.gstPercent) ?? num(product?.defaultGstPercent);
    const pack = over?.pack_size ?? cat?.pack_size ?? current?.packSize ?? product?.defaultPackSize ?? null;
    const moq = map.terms.moq_kg !== undefined ? map.terms.moq_kg : num(current?.moqKg);
    const basis = map.terms.price_basis ?? current?.priceBasis ?? defaults.priceBasis ?? null;
    if (gst === null) problems.push(r.productId ? "No GST rate is known for this product. Enter its rate once on the Rates screen, then import again" : "This product is not in the catalogue and no GST rate is known for it. Add the product and its rate on the Rates screen");
    if (!basis) problems.push("No price basis is known for this line");
    const key = `${r.product.toLowerCase()}|${r.grade.toLowerCase()}`;
    if (seen.has(key)) problems.push("Another line on this list maps to the same product and grade");
    if (!r.productId && removed.has(normalizeListName(r.product))) problems.push("This product was removed from the catalogue. Restore it under Rates → Removed products, then import again");
    seen.add(key);

    const decided = map.lines[normalizeListName(line.name, line.qualifier)];
    const flag = decided?.needs_confirmation ?? cat?.needs_confirmation ?? null;
    // A "check this" mark is cleared only when the mapping covers the line; otherwise it is carried over.
    const flagged = flag ? true : decided || cat ? false : (current?.needsConfirmation ?? false);
    const notes = [...line.warnings, ...(flag ? [flag] : [])];
    const next = gst === null || !basis ? null : {
      pricePerKgInr: line.pricePerKg, gstPercent: String(gst), moqKg: moq === null ? null : String(moq), packSize: pack, priceBasis: basis,
      needsConfirmation: flagged, note: `${notes.length ? notes.join(". ") + ". " : ""}Price list: "${line.rawLine}"`,
    };
    let kind: PlanRow["kind"];
    if (!r.productId) kind = "new_product";
    else if (!r.gradeId) kind = "new_grade";
    else if (!current) kind = "new_rate";
    else if (!next || !sameNum(current.pricePerKgInr, next.pricePerKgInr)) kind = "price_change";
    else if (!sameNum(current.gstPercent, next.gstPercent) || !sameNum(current.moqKg, next.moqKg) || (current.packSize ?? null) !== (next.packSize ?? null)
      || current.priceBasis !== next.priceBasis || current.needsConfirmation !== next.needsConfirmation || r.renameGradeFrom) kind = "terms_change";
    else kind = "unchanged";
    return { line, ...r, aliases: decided?.aliases ?? [], kind, current, next, catalogCategory: cat?.catalog_category ?? line.category, problems };
  });

  const onList = new Set(rows.map((r) => r.gradeId).filter(Boolean));
  const notOnList = catalog.flatMap((p) => p.grades.filter((g) => g.current && !onList.has(g.id)).map((g) => ({ product: p.name, grade: g.name, pricePerKgInr: g.current!.pricePerKgInr })));
  // Only a list that has a GST section can disagree with the saved one; a partial list has none.
  const footerChanged = map.footer.length > 0 && parsed.footer.length > 0 && JSON.stringify(map.footer) !== JSON.stringify(parsed.footer);
  return { rows, notOnList, unparsed: parsed.unparsed, footerChanged };
}

export type PlanSection = { title: string; lines: string[]; /** Background detail: screens show it folded. */ folded?: boolean };

/**
 * A plan as headed lists, in the order a person should read them. The Rates import screen and the
 * `rates:import` command both show exactly this, so the owner confirms the same thing either way.
 */
export function planSections(plan: ImportPlan): PlanSection[] {
  const label = (r: PlanRow) => `${r.product}${r.grade !== "Standard" ? ` (${r.grade})` : ""}`;
  const rupee = (v: string | null | undefined) => (v === null || v === undefined ? "—" : `₹${Number(v)}`);
  const of = (k: PlanRow["kind"]) => plan.rows.filter((r) => r.kind === k && !r.problems.length);
  const terms = (r: PlanRow) => `₹${Number(r.next!.pricePerKgInr)}/kg, GST ${Number(r.next!.gstPercent)}%, pack ${r.next!.packSize ?? "—"}, MOQ ${r.next!.moqKg ? Number(r.next!.moqKg) + " kg" : "—"}`;
  // The list's own wording is shown only when it differs from the catalogue name it was matched to.
  const listed = (r: PlanRow) => ([r.product, `${r.product} ${r.grade}`, `${r.product} (${r.grade})`].some((n) => normalizeListName(n) === normalizeListName(r.line.name)) ? "" : `   (on the list: "${r.line.name}")`);

  const termRows = of("terms_change");
  const what = new Set<string>();
  for (const r of termRows) {
    if (!sameNum(r.current?.moqKg, r.next?.moqKg)) what.add(r.next?.moqKg ? `MOQ becomes ${Number(r.next.moqKg)} kg` : "MOQ removed");
    if (!sameNum(r.current?.gstPercent, r.next?.gstPercent)) what.add("GST % changes");
    if ((r.current?.packSize ?? null) !== (r.next?.packSize ?? null)) what.add("pack size changes");
    if (r.current?.priceBasis !== r.next?.priceBasis) what.add("price basis changes");
    if (r.current?.needsConfirmation !== r.next?.needsConfirmation) what.add("the “check” mark changes");
  }
  // One line per reason, not one per product: thirteen identical sentences help nobody.
  const toCheck = new Map<string, string[]>();
  for (const r of plan.rows) {
    if (!r.next?.needsConfirmation || r.problems.length) continue;
    const reason = r.next.note.includes('. Price list: "') ? r.next.note.split('. Price list: "')[0]! : "Marked earlier and still to be checked";
    toCheck.set(reason, [...(toCheck.get(reason) ?? []), label(r)]);
  }
  const warned = new Map<string, string[]>();
  for (const r of plan.rows) for (const w of r.line.warnings) warned.set(w, [...(warned.get(w) ?? []), label(r)]);

  const sections: PlanSection[] = [
    { title: "New products", lines: of("new_product").map((r) => `${label(r)}: ${terms(r)}${listed(r)}`) },
    { title: "New grades and first rates for products already in the catalogue", lines: [...of("new_grade"), ...of("new_rate")].map((r) => `${label(r)}: ${terms(r)}${listed(r)}`) },
    { title: "Grades renamed to match the list", lines: plan.rows.filter((r) => r.renameGradeFrom && !r.problems.length).map((r) => `${r.product}: "${r.renameGradeFrom}" becomes "${r.grade}"`) },
    { title: "Price changes", lines: of("price_change").map((r) => `${label(r)}: ${rupee(r.current?.pricePerKgInr)} → ${rupee(r.next?.pricePerKgInr)}`) },
    { title: "Same price, other terms change", lines: termRows.length ? [`${termRows.length} rates: ${[...what].join(", ")}`] : [] },
    { title: "Has a rate today but is not on this list (kept as it is)", folded: true, lines: plan.notOnList.map((g) => `${g.product}${g.grade !== "Standard" ? ` (${g.grade})` : ""}: ${rupee(g.pricePerKgInr)}`) },
    { title: "Marked for you to check", lines: [...toCheck].map(([reason, names]) => `${reason}: ${names.join(", ")}`) },
    { title: "Read with a warning", lines: [...warned].map(([w, names]) => `${w}: ${names.join(", ")}`) },
    { title: "Will NOT be written", lines: plan.rows.filter((r) => r.problems.length).map((r) => `${label(r)}: ${r.problems.join("; ")}`) },
    { title: "Lines that could not be read", lines: plan.unparsed },
    { title: "GST section", lines: plan.footerChanged ? ["The GST section of this list differs from the one saved for this company. Check GST rates and pack sizes before applying."] : [] },
  ];
  return sections.filter((s) => s.lines.length);
}

/** How many rows of a plan would be written. */
export function planCounts(plan: ImportPlan) {
  const writable = plan.rows.filter((r) => !r.problems.length && r.next && r.kind !== "unchanged");
  return { read: plan.rows.length, toWrite: writable.length, unchanged: plan.rows.filter((r) => r.kind === "unchanged" && !r.problems.length).length, problems: plan.rows.filter((r) => r.problems.length).length + plan.unparsed.length };
}

/** A plain-text report of a plan, for the owner to read before anything is written. */
export function describePlan(plan: ImportPlan): string {
  const c = planCounts(plan);
  return [
    `${c.read} lines read: ${c.toWrite} to write, ${c.unchanged} unchanged, ${c.problems} with a problem.`,
    ...planSections(plan).map((s) => `\n${s.title} (${s.lines.length})\n${s.lines.map((l) => `  ${l}`).join("\n")}`),
  ].join("\n");
}
