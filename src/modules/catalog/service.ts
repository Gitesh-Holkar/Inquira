import { and, asc, desc, eq, inArray, isNull, lte, or, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { notFound } from "@/lib/errors";
import { todayIST } from "@/lib/format";
import { audit, emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { priceEntries, productGrades, products } from "./schema";
import { updateRatesInput, type CurrentRate } from "./types";

/** Current rate per grade: newest entry valid today (append-only book, ADR-006). */
export async function currentRatesInternal(tx: Tx, orgId: string, opts: { productIds?: string[]; asOf?: string } = {}): Promise<CurrentRate[]> {
  const asOf = opts.asOf ?? todayIST();
  const latest = tx
    .selectDistinctOn([priceEntries.gradeId])
    .from(priceEntries)
    .where(and(
      eq(priceEntries.orgId, orgId),
      lte(priceEntries.validFrom, asOf),
      or(isNull(priceEntries.validTo), gte(priceEntries.validTo, asOf)),
    ))
    .orderBy(priceEntries.gradeId, desc(priceEntries.validFrom), desc(priceEntries.createdAt))
    .as("latest");

  const rows = await tx
    .select({
      productId: products.id,
      productName: products.name,
      category: products.category,
      productSort: products.sortOrder,
      gradeId: productGrades.id,
      gradeName: productGrades.name,
      gradeSort: productGrades.sortOrder,
      priceEntryId: latest.id,
      pricePerKgInr: latest.pricePerKgInr,
      gstPercent: latest.gstPercent,
      gstInclusive: latest.gstInclusive,
      priceBasis: latest.priceBasis,
      moqKg: latest.moqKg,
      packSize: latest.packSize,
      validFrom: latest.validFrom,
      needsConfirmation: latest.needsConfirmation,
      updatedBy: latest.createdBy,
      updatedAt: latest.createdAt,
    })
    .from(productGrades)
    .innerJoin(products, eq(products.id, productGrades.productId))
    .leftJoin(latest, eq(latest.gradeId, productGrades.id))
    .where(and(
      eq(productGrades.orgId, orgId),
      isNull(productGrades.deletedAt),
      isNull(products.deletedAt),
      opts.productIds?.length ? inArray(products.id, opts.productIds) : undefined,
    ))
    .orderBy(asc(products.sortOrder), asc(products.name), asc(productGrades.sortOrder), asc(productGrades.name));

  return rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    category: r.category,
    gradeId: r.gradeId,
    gradeName: r.gradeName,
    priceEntryId: r.priceEntryId,
    pricePerKgInr: r.pricePerKgInr,
    gstPercent: r.gstPercent,
    gstInclusive: r.gstInclusive ?? false,
    priceBasis: r.priceBasis,
    moqKg: r.moqKg,
    packSize: r.packSize,
    validFrom: r.validFrom,
    needsConfirmation: r.needsConfirmation ?? false,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
  }));
}

export const getCurrentRates = defineService({
  name: "catalog.getCurrentRates",
  input: z.object({ productIds: z.array(z.string().uuid()).optional(), query: z.string().trim().max(100).optional() }),
  permission: "catalog.read",
  handler: async (ctx, input, tx) => {
    const rates = await currentRatesInternal(tx, ctx.orgId, { productIds: input.productIds });
    if (!input.query) return rates;
    const q = input.query.toLowerCase();
    return rates.filter((r) => r.productName.toLowerCase().includes(q) || r.gradeName.toLowerCase().includes(q));
  },
});

export const rateHistory = defineService({
  name: "catalog.rateHistory",
  input: z.object({ gradeId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }),
  permission: "catalog.read",
  handler: async (ctx, input, tx) => {
    return tx
      .select()
      .from(priceEntries)
      .where(and(eq(priceEntries.orgId, ctx.orgId), eq(priceEntries.gradeId, input.gradeId)))
      .orderBy(desc(priceEntries.validFrom), desc(priceEntries.createdAt))
      .limit(input.limit);
  },
});

/** Adds new price rows (never overwrites). Only changed rates should be sent by the UI. */
export const updateRates = defineService({
  name: "catalog.updateRates",
  input: updateRatesInput,
  permission: "rates.write",
  handler: async (ctx, input, tx) => {
    const validFrom = input.validFrom ?? todayIST();
    const gradeIds = [...new Set(input.items.map((i) => i.gradeId))];
    const grades = await tx
      .select({ id: productGrades.id, name: productGrades.name, productName: products.name })
      .from(productGrades)
      .innerJoin(products, eq(products.id, productGrades.productId))
      .where(and(eq(productGrades.orgId, ctx.orgId), inArray(productGrades.id, gradeIds)));
    const byId = new Map(grades.map((g) => [g.id, g]));
    for (const id of gradeIds) if (!byId.has(id)) throw notFound(`Grade ${id}`);

    const before = new Map((await currentRatesInternal(tx, ctx.orgId)).map((r) => [r.gradeId, r]));
    const inserted = await tx
      .insert(priceEntries)
      .values(input.items.map((i) => ({
        orgId: ctx.orgId,
        gradeId: i.gradeId,
        pricePerKgInr: i.pricePerKgInr,
        gstPercent: i.gstPercent,
        priceBasis: i.priceBasis,
        moqKg: i.moqKg,
        packSize: i.packSize,
        needsConfirmation: i.needsConfirmation,
        note: i.note,
        validFrom,
        createdBy: actorString(ctx.actor),
      })))
      .returning();

    for (const row of inserted) {
      const prev = before.get(row.gradeId);
      const g = byId.get(row.gradeId)!;
      const changes = {
        product: g.productName,
        grade: g.name,
        pricePerKgInr: [prev?.pricePerKgInr ?? null, row.pricePerKgInr],
        gstPercent: [prev?.gstPercent ?? null, row.gstPercent],
        moqKg: [prev?.moqKg ?? null, row.moqKg],
        validFrom,
      };
      await audit(tx, ctx, { action: "rate.update", entityType: "price_entry", entityId: row.id, changes });
      await emit(tx, ctx, { type: "rate.updated", entityType: "product_grade", entityId: row.gradeId, payload: changes });
    }
    return { count: inserted.length, validFrom };
  },
});

export const listProducts = defineService({
  name: "catalog.listProducts",
  input: z.object({}).default({}),
  permission: "catalog.read",
  handler: async (ctx, _input, tx) => {
    return tx.select().from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.deletedAt))).orderBy(asc(products.sortOrder), asc(products.name));
  },
});

const createProductInput = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(80).nullish(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  grades: z.array(z.string().trim().min(1).max(60)).min(1).max(20).default(["Standard"]),
  defaultGstPercent: z.string().nullish(),
  defaultPackSize: z.string().nullish(),
  websiteUrl: z.string().url().nullish(),
});

export async function createProductInternal(tx: Tx, ctx: Ctx, input: z.output<typeof createProductInput> & { sortOrder?: number; notes?: string | null }) {
  const by = actorString(ctx.actor);
  const [p] = await tx
    .insert(products)
    .values({
      orgId: ctx.orgId, name: input.name, category: input.category ?? null, aliases: input.aliases,
      defaultGstPercent: input.defaultGstPercent ?? null, defaultPackSize: input.defaultPackSize ?? null,
      websiteUrl: input.websiteUrl ?? null, sortOrder: input.sortOrder ?? 0, notes: input.notes ?? null, createdBy: by,
    })
    .returning();
  const grades = await tx
    .insert(productGrades)
    .values(input.grades.map((name, i) => ({ orgId: ctx.orgId, productId: p!.id, name, sortOrder: i, createdBy: by })))
    .returning();
  await audit(tx, ctx, { action: "product.create", entityType: "product", entityId: p!.id, changes: { name: p!.name, grades: input.grades } });
  await emit(tx, ctx, { type: "product.created", entityType: "product", entityId: p!.id, payload: { name: p!.name } });
  return { product: p!, grades };
}

export const createProduct = defineService({
  name: "catalog.createProduct",
  input: createProductInput,
  permission: "catalog.write",
  handler: (ctx, input, tx) => createProductInternal(tx, ctx, input),
});

export const addGrade = defineService({
  name: "catalog.addGrade",
  input: z.object({ productId: z.string().uuid(), name: z.string().trim().min(1).max(60) }),
  permission: "catalog.write",
  handler: async (ctx, input, tx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.id, input.productId), eq(products.orgId, ctx.orgId)));
    if (!p) throw notFound("Product");
    const [g] = await tx.insert(productGrades).values({ orgId: ctx.orgId, productId: p.id, name: input.name, createdBy: actorString(ctx.actor) }).returning();
    await audit(tx, ctx, { action: "grade.create", entityType: "product_grade", entityId: g!.id, changes: { product: p.name, grade: g!.name } });
    return g!;
  },
});

// ---------- product matching (used by leads, buy-lead rules, quotes) ----------

export type ProductMatcherEntry = { id: string; name: string; aliases: string[] };

export function normalizeProductText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bsoy\b/g, "soya")
    .replace(/\bproteins\b/g, "protein")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic best-effort match of free text ("Soy Protein Isolate Powder") to a catalog
 * product. Scores exact name/alias containment, then token overlap. Returns null if unsure.
 */
export function matchProduct(text: string | null | undefined, catalog: ProductMatcherEntry[]): { id: string; name: string; score: number } | null {
  if (!text) return null;
  const t = ` ${normalizeProductText(text)} `;
  const tTokens = new Set(t.trim().split(" ").filter((w) => w.length > 1 && !STOP.has(w)));
  let best: { id: string; name: string; score: number } | null = null;
  for (const p of catalog) {
    for (const cand of [p.name, ...p.aliases]) {
      const c = normalizeProductText(cand.replace(/\([^)]*\)/g, " "));
      if (!c) continue;
      let score = 0;
      if (t.includes(` ${c} `)) score = 100 + c.length; // whole phrase present
      else {
        const cTokens = c.split(" ").filter((w) => w.length > 1 && !STOP.has(w));
        if (!cTokens.length) continue;
        const hit = cTokens.filter((w) => tTokens.has(w)).length;
        if (hit === cTokens.length) score = 60 + hit * 5; // all tokens, any order ("isolate protein" vs "protein isolate")
        else if (hit / cTokens.length >= 0.67 && hit >= 2) score = 30 + hit * 5;
      }
      if (score && (!best || score > best.score)) best = { id: p.id, name: p.name, score };
    }
  }
  return best && best.score >= 40 ? best : null;
}
const STOP = new Set(["powder", "food", "grade", "the", "of", "for", "and", "kg", "bulk", "pure", "natural"]);

export async function productMatcherCatalog(tx: Tx, orgId: string): Promise<ProductMatcherEntry[]> {
  const rows = await tx
    .select({ id: products.id, name: products.name, aliases: products.aliases })
    .from(products)
    .where(and(eq(products.orgId, orgId), isNull(products.deletedAt)));
  return rows;
}

export async function productNameById(tx: Tx, orgId: string, id: string): Promise<string | null> {
  const [p] = await tx.select({ name: products.name }).from(products).where(and(eq(products.orgId, orgId), eq(products.id, id)));
  return p?.name ?? null;
}

export async function countProducts(tx: Tx, orgId: string) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(products).where(and(eq(products.orgId, orgId), isNull(products.deletedAt)));
  return r?.n ?? 0;
}
