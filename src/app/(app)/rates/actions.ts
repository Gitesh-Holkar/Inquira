"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { createProduct, rateHistory, removeProduct, restoreProduct, updateProduct, updateRates } from "@/modules/catalog/service";
import { planCounts, planSections, type PlanSection } from "@/modules/catalog/price-list";
import { applyPriceListImport, planPriceListImport, savePriceListMap } from "@/modules/catalog/price-list-service";

export type RateChange = { gradeId: string; pricePerKgInr: string; gstPercent: string; priceBasis: string; moqKg: string | null; packSize: string | null; needsConfirmation: boolean };

export async function saveRatesAction(items: RateChange[], validFrom: string) {
  const s = await requireSession("rates.write");
  const r = await runAction(() => updateRates(s.ctx, { validFrom, items }));
  revalidatePath("/rates");
  return r;
}

export async function rateHistoryAction(gradeId: string) {
  const s = await requireSession("catalog.read");
  const r = await runAction(() => rateHistory(s.ctx, { gradeId, limit: 50 }));
  if (!r.ok) return r;
  return { ok: true as const, data: r.data.map((h) => ({ id: h.id, price: h.pricePerKgInr, gst: h.gstPercent, moq: h.moqKg, basis: h.priceBasis, pack: h.packSize, validFrom: h.validFrom, by: h.createdBy, at: h.createdAt.toISOString(), note: h.note, confirm: h.needsConfirmation })) };
}

export async function addProductAction(input: { name: string; category: string; grades: string; aliases: string }) {
  const s = await requireSession("catalog.write");
  const r = await runAction(() => createProduct(s.ctx, {
    name: input.name, category: input.category || null,
    grades: input.grades.split(",").map((g) => g.trim()).filter(Boolean).length ? input.grades.split(",").map((g) => g.trim()).filter(Boolean) : ["Standard"],
    aliases: input.aliases.split(",").map((g) => g.trim().toLowerCase()).filter(Boolean),
  }));
  revalidatePath("/rates");
  return r.ok ? { ok: true as const } : r;
}

export type PriceListPreview = { counts: ReturnType<typeof planCounts>; sections: PlanSection[] };

/** Reads a pasted price list and returns what it would change. Writes nothing. */
export async function planPriceListAction(text: string) {
  const s = await requireSession("rates.write");
  const r = await runAction(() => planPriceListImport(s.ctx, { text }));
  if (!r.ok) return r;
  return { ok: true as const, data: { counts: planCounts(r.data), sections: planSections(r.data) } satisfies PriceListPreview };
}

/** Writes the changes of a pasted price list (the service re-reads the list, so it applies what the preview showed). */
export async function applyPriceListAction(text: string) {
  const s = await requireSession("rates.write");
  const r = await runAction(() => applyPriceListImport(s.ctx, { text }));
  revalidatePath("/rates");
  return r.ok ? { ok: true as const, data: r.data.counts } : r;
}

/** Saves the company's price list mapping from its JSON text (Rates → Import price list → mapping). */
export async function savePriceListMapAction(json: string) {
  const s = await requireSession("catalog.write");
  let map: unknown;
  try {
    map = JSON.parse(json);
  } catch {
    return { ok: false as const, error: "The mapping could not be read. Paste it again exactly as it was given to you." };
  }
  const r = await runAction(() => savePriceListMap(s.ctx, { map }));
  revalidatePath("/rates/import");
  return r;
}

export type ProductEdit = { productId: string; name: string; category: string; aliases: string; grades: { id: string; name: string }[]; newGrades: string };

/** Corrects a product's name, category, other names and grades (Rates → Edit product). */
export async function updateProductAction(input: ProductEdit) {
  const s = await requireSession("catalog.write");
  const split = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
  const r = await runAction(() => updateProduct(s.ctx, {
    productId: input.productId, name: input.name, category: input.category || null,
    aliases: split(input.aliases).map((a) => a.toLowerCase()), grades: input.grades, newGrades: split(input.newGrades),
  }));
  revalidatePath("/rates");
  return r.ok ? { ok: true as const } : r;
}

/** Takes a product out of the catalogue; its rates and history are kept (Rates → Edit product → Remove). */
export async function removeProductAction(productId: string) {
  const s = await requireSession("catalog.write");
  const r = await runAction(() => removeProduct(s.ctx, { productId }));
  revalidatePath("/rates");
  return r.ok ? { ok: true as const } : r;
}

/** Brings a removed product back (Rates → Removed products). */
export async function restoreProductAction(productId: string) {
  const s = await requireSession("catalog.write");
  const r = await runAction(() => restoreProduct(s.ctx, { productId }));
  revalidatePath("/rates");
  return r.ok ? { ok: true as const } : r;
}
