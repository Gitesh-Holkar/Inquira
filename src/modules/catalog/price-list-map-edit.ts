/**
 * The price list mapping as form rows and back (Rates → Import price list → mapping form). Pure: the form
 * component and its tests use it. `toMap` returns the first problem a person must fix, in plain words.
 */
import { normalizeListName, priceListMapSchema, type PriceListMap } from "./price-list";

export type Heading = { key: string; heading: string; gst: string; pack: string; category: string; check?: string };
export type Override = { key: string; product: string; gst: string; pack: string };
export type Line = { key: string; name: string; product: string; grade: string; aliases: string; wasGrade?: string; check?: string };
export type State = { basis: string; moq: string; headings: Heading[]; overrides: Override[]; lines: Line[]; footer: string };

let seq = 0;
/** A key for a row added in the browser (saved rows get keys from their position, the same on server and browser). */
export const newRowKey = () => `n${++seq}`;

/** The saved mapping (any shape) as form rows; an unreadable one starts empty. */
export function fromMap(raw: unknown): State {
  const p = priceListMapSchema.safeParse(raw ?? {});
  const m: PriceListMap = p.success ? p.data : priceListMapSchema.parse({});
  return {
    basis: m.terms.price_basis ?? "",
    moq: m.terms.moq_kg ? String(m.terms.moq_kg) : "",
    headings: Object.entries(m.categories).map(([heading, c], i) => ({ key: `h${i}`, heading, gst: String(c.gst_percent), pack: c.pack_size, category: c.catalog_category ?? "", check: c.needs_confirmation })),
    overrides: Object.entries(m.product_overrides).map(([product, o], i) => ({ key: `o${i}`, product, gst: o.gst_percent === undefined ? "" : String(o.gst_percent), pack: o.pack_size ?? "" })),
    lines: Object.entries(m.lines).map(([name, l], i) => ({ key: `l${i}`, name, product: l.product, grade: l.grade, aliases: (l.aliases ?? []).join(", "), wasGrade: l.was_grade, check: l.needs_confirmation })),
    footer: m.footer.join("\n"),
  };
}

/** Form rows back to the mapping, or the first problem a person must fix. */
export function toMap(s: State): { map: Record<string, unknown> } | { error: string } {
  const num = (v: string) => Number(v.trim());
  const isGst = (v: string) => /^\d{1,2}(\.\d{1,2})?$/.test(v.trim()) && num(v) <= 28;
  if (s.moq.trim() && !(num(s.moq) > 0)) return { error: "MOQ must be a number of kg above 0, or empty." };
  const dupe = (names: string[]) => names.find((n, i) => n && names.indexOf(n) !== i);
  const d1 = dupe(s.headings.map((h) => h.heading.trim().toLowerCase()));
  if (d1) return { error: `The heading “${d1}” is listed twice.` };
  const d2 = dupe(s.overrides.map((o) => o.product.trim().toLowerCase()));
  if (d2) return { error: `“${d2}” has two product exceptions.` };
  const d3 = dupe(s.lines.map((l) => normalizeListName(l.name)));
  if (d3) return { error: `The name “${d3}” is listed twice.` };
  const categories: Record<string, unknown> = {};
  for (const h of s.headings) {
    if (!h.heading.trim()) return { error: "Each heading needs its text, as it appears on your list (without the colon)." };
    if (!isGst(h.gst)) return { error: `GST % for “${h.heading}” must be a number between 0 and 28.` };
    if (!h.pack.trim()) return { error: `Enter the pack size for “${h.heading}”, for example 25 Kg.` };
    categories[h.heading.trim()] = { gst_percent: num(h.gst), pack_size: h.pack.trim(), ...(h.category.trim() ? { catalog_category: h.category.trim() } : {}), ...(h.check ? { needs_confirmation: h.check } : {}) };
  }
  const product_overrides: Record<string, unknown> = {};
  for (const o of s.overrides) {
    if (!o.product.trim()) return { error: "Each product exception needs a product name." };
    if (o.gst.trim() && !isGst(o.gst)) return { error: `GST % for “${o.product}” must be a number between 0 and 28, or empty.` };
    if (!o.gst.trim() && !o.pack.trim()) return { error: `Give “${o.product}” a GST % or a pack size, or remove the row.` };
    product_overrides[o.product.trim()] = { ...(o.gst.trim() ? { gst_percent: num(o.gst) } : {}), ...(o.pack.trim() ? { pack_size: o.pack.trim() } : {}) };
  }
  const lines: Record<string, unknown> = {};
  for (const l of s.lines) {
    if (!l.name.trim() || !l.product.trim() || !l.grade.trim()) return { error: "Each name on the list needs the name, the product and the grade (use Standard when there is one grade)." };
    const aliases = l.aliases.split(",").map((a) => a.trim().toLowerCase()).filter((a) => a.length >= 2);
    lines[normalizeListName(l.name)] = {
      product: l.product.trim(), grade: l.grade.trim(),
      ...(l.wasGrade ? { was_grade: l.wasGrade } : {}), ...(l.check ? { needs_confirmation: l.check } : {}), ...(aliases.length ? { aliases } : {}),
    };
  }
  const map = {
    terms: { ...(s.basis.trim() ? { price_basis: s.basis.trim() } : {}), ...(s.moq.trim() ? { moq_kg: num(s.moq) } : {}) },
    categories, product_overrides, lines,
    footer: s.footer.split("\n").map((x) => x.trim()).filter(Boolean),
  };
  const ok = priceListMapSchema.safeParse(map);
  return ok.success ? { map } : { error: "Something in the mapping is not valid. Check the numbers and names." };
}

