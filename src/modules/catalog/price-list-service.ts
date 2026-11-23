/**
 * Price list import, database part (GOAL G-KB-6). `planPriceListImport` only reads and returns the
 * diff. `applyPriceListImport` writes it: new products and grades, renamed grades, list names saved
 * as aliases, and new rate-book entries. Old rates stay in the append-only history; nothing is
 * overwritten or removed. Used by `npm run rates:import` (scripts/rates-import.ts).
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { AppError } from "@/lib/errors";
import { audit } from "@/modules/core/audit";
import { authorize } from "@/modules/core/permissions";
import { getOrgSettingsInternal, setPriceListMapInternal } from "@/modules/core/service";
import { defineService, parseInput } from "@/modules/core/service-kit";
import type { Ctx } from "@/modules/core/types";
import { productGrades, products } from "./schema";
import { addOrRestoreGradeInternal, createProductInternal, currentRatesInternal, insertRatesInternal, removedProductNamesInternal } from "./service";
import { parsePriceList, planImport, priceListMapSchema, type CatalogForImport, type ImportPlan } from "./price-list";
import { updateRatesInput } from "./types";

const importInput = z.object({
  /** The price list as text, one item per line. */
  text: z.string().min(1).max(200_000),
  /** A mapping to use instead of the one saved for the company (see priceListMapSchema). */
  map: z.unknown().optional(),
});

/** The catalogue with each grade's current rate, in the shape planImport needs. */
export async function catalogForImportInternal(tx: Tx, orgId: string): Promise<CatalogForImport> {
  const ps = await tx.select({ id: products.id, name: products.name, aliases: products.aliases, defaultGstPercent: products.defaultGstPercent, defaultPackSize: products.defaultPackSize }).from(products)
    .where(and(eq(products.orgId, orgId), isNull(products.deletedAt)));
  const rates = await currentRatesInternal(tx, orgId);
  return ps.map((p) => ({
    ...p,
    grades: rates.filter((r) => r.productId === p.id).map((r) => ({
      id: r.gradeId, name: r.gradeName,
      current: r.pricePerKgInr === null ? null : {
        pricePerKgInr: r.pricePerKgInr, gstPercent: r.gstPercent!, moqKg: r.moqKg, packSize: r.packSize, priceBasis: r.priceBasis ?? "", needsConfirmation: r.needsConfirmation,
      },
    })),
  }));
}

async function plan(tx: Tx, ctx: Ctx, input: z.output<typeof importInput>): Promise<ImportPlan> {
  const settings = await getOrgSettingsInternal(tx, ctx.orgId);
  try {
    return planImport(parsePriceList(input.text), await catalogForImportInternal(tx, ctx.orgId), input.map ?? settings.priceListMap ?? {}, { priceBasis: settings.defaultPriceBasis, removedNames: await removedProductNamesInternal(tx, ctx.orgId) });
  } catch (e) {
    if (e instanceof z.ZodError) throw new AppError("VALIDATION", "The price list mapping file is not valid", z.flattenError(e));
    throw e;
  }
}

/** Saves the company's price list mapping after checking its shape. Used by the seed and `rates:import --save-map`. */
export const savePriceListMap = defineService({
  name: "catalog.savePriceListMap",
  input: z.object({ map: z.unknown() }),
  permission: "catalog.write",
  handler: async (ctx, input, tx) => {
    const parsed = priceListMapSchema.safeParse(input.map);
    if (!parsed.success) throw new AppError("VALIDATION", "The price list mapping file is not valid", z.flattenError(parsed.error));
    await setPriceListMapInternal(tx, ctx, input.map, { headings: Object.keys(parsed.data.categories).length, lines: Object.keys(parsed.data.lines).length });
    return { headings: Object.keys(parsed.data.categories).length, lines: Object.keys(parsed.data.lines).length };
  },
});

/** What importing this price list would change. Reads only. */
export const planPriceListImport = defineService({
  name: "catalog.planPriceListImport",
  input: importInput,
  permission: "catalog.read",
  handler: (ctx, input, tx) => plan(tx, ctx, input),
});

/**
 * Writes the plan in one transaction. Rows with problems and unchanged rows are skipped; everything
 * written is audited. Returns the plan that was applied and the counts.
 */
export const applyPriceListImport = defineService({
  name: "catalog.applyPriceListImport",
  input: importInput,
  permission: "rates.write",
  handler: async (ctx, input, tx) => {
    authorize(ctx, "catalog.write");
    const p = await plan(tx, ctx, input);
    const counts = { productsCreated: 0, gradesCreated: 0, gradesRenamed: 0, ratesWritten: 0, skipped: 0 };
    const items: { gradeId: string; pricePerKgInr: string; gstPercent: string; priceBasis: string; moqKg: string | null; packSize: string | null; needsConfirmation: boolean; note: string }[] = [];
    const createdProducts = new Map<string, string>(); // product name → id, for lists with several grades of a new product

    for (const row of p.rows) {
      if (row.problems.length || !row.next || row.kind === "unchanged") {
        counts.skipped++;
        continue;
      }
      let productId = row.productId ?? createdProducts.get(row.product) ?? null;
      let gradeId = row.gradeId;
      if (!productId) {
        const created = await createProductInternal(tx, ctx, {
          name: row.product, category: row.catalogCategory, grades: [row.grade], aliases: row.aliases,
          defaultGstPercent: row.next.gstPercent, defaultPackSize: row.next.packSize,
        });
        productId = created.product.id;
        gradeId = created.grades[0]!.id;
        createdProducts.set(row.product, productId);
        counts.productsCreated++;
      } else if (!gradeId) {
        // A grade removed earlier and back on the list returns with its history.
        const { grade: g, restored } = await addOrRestoreGradeInternal(tx, ctx, productId, row.grade);
        await audit(tx, ctx, { action: restored ? "grade.restore" : "grade.create", entityType: "product_grade", entityId: g.id, changes: { product: row.product, grade: row.grade, source: "price list" } });
        gradeId = g.id;
        counts.gradesCreated++;
      } else if (row.renameGradeFrom) {
        await tx.update(productGrades).set({ name: row.grade }).where(and(eq(productGrades.id, gradeId), eq(productGrades.orgId, ctx.orgId)));
        await audit(tx, ctx, { action: "grade.rename", entityType: "product_grade", entityId: gradeId, changes: { product: row.product, name: [row.renameGradeFrom, row.grade], source: "price list" } });
        counts.gradesRenamed++;
      }
      // Spelling variants the mapping lists for this product help match buyers' wording to it.
      if (row.productId && row.aliases.length) {
        const [prod] = await tx.select({ aliases: products.aliases }).from(products).where(and(eq(products.id, productId), eq(products.orgId, ctx.orgId)));
        const missing = row.aliases.filter((a) => !prod?.aliases.includes(a));
        if (prod && missing.length) {
          await tx.update(products).set({ aliases: [...prod.aliases, ...missing] }).where(and(eq(products.id, productId), eq(products.orgId, ctx.orgId)));
          await audit(tx, ctx, { action: "product.alias_add", entityType: "product", entityId: productId, changes: { aliases: missing, source: "price list" } });
        }
      }
      items.push({ gradeId: gradeId!, ...row.next });
    }
    if (items.length) {
      await insertRatesInternal(tx, ctx, parseInput(updateRatesInput, { items }));
      counts.ratesWritten = items.length;
    }
    await audit(tx, ctx, { action: "price_list.import", entityType: "organization", entityId: ctx.orgId, changes: counts });
    return { plan: p, counts };
  },
});
