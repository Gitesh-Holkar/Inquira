"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { createProduct, rateHistory, updateRates } from "@/modules/catalog/service";

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
