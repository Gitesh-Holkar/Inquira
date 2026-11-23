import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { AppError, notFound } from "@/lib/errors";
import { todayIST } from "@/lib/format";
import { audit, emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { priceEntries, productGrades, products } from "./schema";
import { updateRatesInput, type CurrentRate } from "./types";
import { addProductTermsInternal, dropProductTermsInternal } from "@/modules/buyleads/service";

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
      validTo: latest.validTo,
      floorPerKgInr: latest.floorPerKgInr,
      ceilingPerKgInr: latest.ceilingPerKgInr,
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
    validTo: r.validTo,
    floorPerKgInr: r.floorPerKgInr,
    ceilingPerKgInr: r.ceilingPerKgInr,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
  }));
}

/**
 * MOQ per product: the smallest MOQ among its grades' current rates (GOAL G-UND-4). A product whose
 * rates carry no MOQ is missing from the map, so "below MOQ" stays unknown rather than guessed.
 */
export async function moqByProductInternal(tx: Tx, orgId: string, productIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!productIds.length) return out;
  for (const r of await currentRatesInternal(tx, orgId, { productIds })) {
    if (r.moqKg === null || r.moqKg === undefined) continue;
    const m = Number(r.moqKg);
    if (!out.has(r.productId) || m < out.get(r.productId)!) out.set(r.productId, m);
  }
  return out;
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

/**
 * Adds new price rows (never overwrites) and audits each one. Shared by the Rates screen and the
 * price list import. Fails if a grade is not in this company or `validFrom` is in the past.
 */
export async function insertRatesInternal(tx: Tx, ctx: Ctx, input: z.output<typeof updateRatesInput>) {
  const validFrom = input.validFrom ?? todayIST();
  if (input.validTo && input.validTo < validFrom) {
    throw new AppError("VALIDATION", "“Valid until” must be on or after “Valid from”.", { fieldErrors: { validTo: ["Use a date on or after Valid from"] } });
  }
  // A back-dated entry would never become current (a newer valid_from already exists), so it would be
  // saved but silently ignored by quotes. History is append-only; corrections start today.
  if (validFrom < todayIST()) {
    throw new AppError("VALIDATION", "“Valid from” can't be in the past. Use today's date; the old rate stays in history.", { fieldErrors: { validFrom: ["Use today or a later date"] } });
  }
  const gradeIds = [...new Set(input.items.map((i) => i.gradeId))];
  const grades = await tx
    .select({ id: productGrades.id, name: productGrades.name, productName: products.name })
    .from(productGrades)
    .innerJoin(products, eq(products.id, productGrades.productId))
    .where(and(eq(productGrades.orgId, ctx.orgId), inArray(productGrades.id, gradeIds), isNull(productGrades.deletedAt)));
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
      validTo: input.validTo ?? null,
      // Not given (price list import): keep the grade's range while the new price still sits inside it.
      floorPerKgInr: i.floorPerKgInr !== undefined ? i.floorPerKgInr : keepRange(before.get(i.gradeId)?.floorPerKgInr, (f) => f <= Number(i.pricePerKgInr)),
      ceilingPerKgInr: i.ceilingPerKgInr !== undefined ? i.ceilingPerKgInr : keepRange(before.get(i.gradeId)?.ceilingPerKgInr, (c) => c >= Number(i.pricePerKgInr)),
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
}

function keepRange(v: string | null | undefined, ok: (n: number) => boolean): string | null {
  return v !== null && v !== undefined && ok(Number(v)) ? v : null;
}

/** Adds new price rows (never overwrites). Only changed rates should be sent by the UI. */
export const updateRates = defineService({
  name: "catalog.updateRates",
  input: updateRatesInput,
  permission: "rates.write",
  handler: (ctx, input, tx) => insertRatesInternal(tx, ctx, input),
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

/** A product name is unique in a company (also among removed products), so say so instead of failing on the index. */
async function assertNameFree(tx: Tx, orgId: string, name: string) {
  const [clash] = await tx.select({ id: products.id, deletedAt: products.deletedAt }).from(products).where(and(eq(products.orgId, orgId), eq(products.name, name)));
  if (clash?.deletedAt) throw new AppError("VALIDATION", "A removed product has this name. Restore it under Rates → Removed products instead", { fieldErrors: { name: ["Used by a removed product"] } });
  if (clash) throw new AppError("VALIDATION", "A product with this name already exists", { fieldErrors: { name: ["Already used by another product"] } });
}

/**
 * Takes a product out of the catalogue (discontinued, or added by mistake). It no longer appears on the
 * Rates screen, in quotations, in lead matching or in Buy Lead suggestions. Nothing is deleted: its
 * grades, rates and history stay, leads keep their link, and `restoreProduct` brings it back as it was.
 */
export const removeProduct = defineService({
  name: "catalog.removeProduct",
  input: z.object({ productId: z.string().uuid() }),
  permission: "catalog.write",
  handler: async (ctx, input, tx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, input.productId), isNull(products.deletedAt)));
    if (!p) throw notFound("Product");
    await tx.update(products).set({ deletedAt: new Date() }).where(eq(products.id, p.id));
    const buyleadTerms = await dropProductTermsInternal(tx, ctx, p.id);
    await audit(tx, ctx, { action: "product.remove", entityType: "product", entityId: p.id, changes: { name: p.name, buyleadTermsRemoved: buyleadTerms } });
    await emit(tx, ctx, { type: "product.removed", entityType: "product", entityId: p.id, payload: { name: p.name } });
    return { ok: true };
  },
});

/** Brings a removed product back with its grades and rates, and its Buy Lead match terms. */
export const restoreProduct = defineService({
  name: "catalog.restoreProduct",
  input: z.object({ productId: z.string().uuid() }),
  permission: "catalog.write",
  handler: async (ctx, input, tx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, input.productId)));
    if (!p) throw notFound("Product");
    if (!p.deletedAt) return { ok: true };
    await tx.update(products).set({ deletedAt: null }).where(eq(products.id, p.id));
    await addProductTermsInternal(tx, ctx, p);
    await audit(tx, ctx, { action: "product.restore", entityType: "product", entityId: p.id, changes: { name: p.name } });
    await emit(tx, ctx, { type: "product.restored", entityType: "product", entityId: p.id, payload: { name: p.name } });
    return { ok: true };
  },
});

/** Removed products, newest first, for Rates → Removed products. */
export const listRemovedProducts = defineService({
  name: "catalog.listRemovedProducts",
  input: z.object({}).default({}),
  permission: "catalog.read",
  handler: (ctx, _i, tx) =>
    tx.select({ id: products.id, name: products.name, category: products.category, removedAt: products.deletedAt }).from(products)
      .where(and(eq(products.orgId, ctx.orgId), isNotNull(products.deletedAt))).orderBy(desc(products.deletedAt)),
});

export const createProduct = defineService({
  name: "catalog.createProduct",
  input: createProductInput,
  permission: "catalog.write",
  handler: async (ctx, input, tx) => {
    await assertNameFree(tx, ctx.orgId, input.name);
    return createProductInternal(tx, ctx, input);
  },
});

const updateProductInput = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(80).nullish(),
  /** Other names buyers use; lead matching and the price list import read them. */
  aliases: z.array(z.string().trim().toLowerCase().min(1).max(120)).max(30),
  /** Existing grades with the name each should have. */
  grades: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(60) })).max(40).default([]),
  newGrades: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  /** Grades to take off the product (no longer sold). Their rates stay in history; adding the same name again brings them back. */
  removeGrades: z.array(z.string().uuid()).max(40).default([]),
  /** Commercial terms (G-KB-2); `undefined` leaves a term as it is, "" or null clears it. */
  hsnCode: z.string().trim().max(12).regex(/^\d{0,10}$/, "HSN codes are digits only").nullish(),
  leadTime: z.string().trim().max(60).nullish(),
  paymentTerms: z.string().trim().max(200).nullish(),
  sampleAvailable: z.boolean().nullish(),
});

/**
 * Adds a grade to a product, or brings back a removed grade of the same name (with its rate history): grade
 * names stay reserved after removal. Used by Rates → Edit product and the price list import.
 */
export async function addOrRestoreGradeInternal(tx: Tx, ctx: Ctx, productId: string, name: string, sortOrder = 0) {
  const [gone] = await tx.select().from(productGrades)
    .where(and(eq(productGrades.orgId, ctx.orgId), eq(productGrades.productId, productId), isNotNull(productGrades.deletedAt), sql`lower(${productGrades.name}) = ${name.toLowerCase()}`));
  if (gone) {
    const [g] = await tx.update(productGrades).set({ deletedAt: null, name }).where(eq(productGrades.id, gone.id)).returning();
    return { grade: g!, restored: true };
  }
  const [g] = await tx.insert(productGrades).values({ orgId: ctx.orgId, productId, name, sortOrder, createdBy: actorString(ctx.actor) }).returning();
  return { grade: g!, restored: false };
}

/**
 * Corrects a product: name, category, other names, grade names, extra grades and grades no longer sold.
 * Rates are not touched (they hang on the grade's id), so a rename keeps the whole price history; a removed
 * grade disappears from rates and quotations but keeps its history.
 */
export const updateProduct = defineService({
  name: "catalog.updateProduct",
  input: updateProductInput,
  permission: "catalog.write",
  handler: async (ctx, input, tx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, input.productId), isNull(products.deletedAt)));
    if (!p) throw notFound("Product");
    const existing = await tx.select().from(productGrades)
      .where(and(eq(productGrades.orgId, ctx.orgId), eq(productGrades.productId, p.id), isNull(productGrades.deletedAt))).orderBy(asc(productGrades.sortOrder));
    const removeIds = new Set(input.removeGrades);
    for (const id of removeIds) if (!existing.some((g) => g.id === id)) throw notFound("Grade");
    const kept = existing.filter((g) => !removeIds.has(g.id));
    const wanted = new Map(input.grades.filter((g) => !removeIds.has(g.id)).map((g) => [g.id, g.name]));
    for (const id of wanted.keys()) if (!existing.some((g) => g.id === id)) throw notFound("Grade");
    if (kept.length + input.newGrades.length === 0) {
      throw new AppError("VALIDATION", "A product needs at least one grade. To stop selling it, delete the product instead.", { fieldErrors: { grades: ["Keep at least one grade"] } });
    }
    const finalNames = [...kept.map((g) => wanted.get(g.id) ?? g.name), ...input.newGrades].map((n) => n.toLowerCase());
    if (new Set(finalNames).size !== finalNames.length) throw new AppError("VALIDATION", "Two grades of this product would have the same name", { fieldErrors: { grades: ["Give each grade a different name"] } });
    const removedBefore = (await tx.select({ name: productGrades.name }).from(productGrades)
      .where(and(eq(productGrades.orgId, ctx.orgId), eq(productGrades.productId, p.id), isNotNull(productGrades.deletedAt)))).map((g) => g.name.toLowerCase());
    const renamedOntoRemoved = kept.find((g) => wanted.has(g.id) && wanted.get(g.id) !== g.name && removedBefore.includes(wanted.get(g.id)!.toLowerCase()));
    if (renamedOntoRemoved) {
      throw new AppError("VALIDATION", `A removed grade is called “${wanted.get(renamedOntoRemoved.id)}”. Add it under “Add grades” to bring it back with its rates.`, { fieldErrors: { grades: ["That name belongs to a removed grade"] } });
    }
    if (input.name !== p.name) await assertNameFree(tx, ctx.orgId, input.name);

    const aliases = [...new Set(input.aliases)];
    const terms: Partial<typeof products.$inferInsert> = {};
    if (input.hsnCode !== undefined) terms.hsnCode = input.hsnCode || null;
    if (input.leadTime !== undefined) terms.leadTime = input.leadTime || null;
    if (input.paymentTerms !== undefined) terms.paymentTerms = input.paymentTerms || null;
    if (input.sampleAvailable !== undefined) terms.sampleAvailable = input.sampleAvailable;
    await tx.update(products).set({ name: input.name, category: input.category || null, aliases, ...terms }).where(eq(products.id, p.id));
    const renames = kept.filter((g) => wanted.has(g.id) && wanted.get(g.id) !== g.name);
    const removed = existing.filter((g) => removeIds.has(g.id));
    if (removed.length) await tx.update(productGrades).set({ deletedAt: new Date() }).where(and(eq(productGrades.orgId, ctx.orgId), inArray(productGrades.id, removed.map((g) => g.id))));
    // Two steps, so that swapping two names never trips the unique index half-way.
    for (const g of renames) await tx.update(productGrades).set({ name: `~${g.id}` }).where(eq(productGrades.id, g.id));
    for (const g of renames) await tx.update(productGrades).set({ name: wanted.get(g.id)! }).where(eq(productGrades.id, g.id));
    const restored: string[] = [];
    for (const [i, name] of input.newGrades.entries()) {
      const r = await addOrRestoreGradeInternal(tx, ctx, p.id, name, existing.length + i);
      if (r.restored) restored.push(name);
    }
    const changes = {
      ...(input.name !== p.name ? { name: [p.name, input.name] } : {}),
      ...((input.category || null) !== p.category ? { category: [p.category, input.category || null] } : {}),
      ...(JSON.stringify(aliases) !== JSON.stringify(p.aliases) ? { aliases: [p.aliases, aliases] } : {}),
      ...(renames.length ? { gradesRenamed: renames.map((g) => [g.name, wanted.get(g.id)!]) } : {}),
      ...(input.newGrades.length ? { gradesAdded: input.newGrades } : {}),
      ...(restored.length ? { gradesRestored: restored } : {}),
      ...(removed.length ? { gradesRemoved: removed.map((g) => g.name) } : {}),
      ...Object.fromEntries(Object.entries(terms).filter(([k, v]) => (p as Record<string, unknown>)[k] !== v).map(([k, v]) => [k, [(p as Record<string, unknown>)[k], v]])),
    };
    await audit(tx, ctx, { action: "product.update", entityType: "product", entityId: p.id, changes });
    await emit(tx, ctx, { type: "product.updated", entityType: "product", entityId: p.id, payload: { name: input.name } });
    return { ok: true, changed: Object.keys(changes).length > 0 };
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
  return (await productInfoById(tx, orgId, id))?.name ?? null;
}

/** Name and whether the product was removed from the catalogue (leads keep pointing at removed products). */
export async function productInfoById(tx: Tx, orgId: string, id: string): Promise<{ name: string; removed: boolean } | null> {
  const [p] = await tx.select({ name: products.name, deletedAt: products.deletedAt }).from(products).where(and(eq(products.orgId, orgId), eq(products.id, id)));
  return p ? { name: p.name, removed: !!p.deletedAt } : null;
}

/** Every product's name and whether it was removed, for screens that show products by id (documents). */
export async function productNamesInternal(tx: Tx, orgId: string): Promise<Map<string, { name: string; removed: boolean }>> {
  const rows = await tx.select({ id: products.id, name: products.name, deletedAt: products.deletedAt }).from(products).where(eq(products.orgId, orgId));
  return new Map(rows.map((r) => [r.id, { name: r.name, removed: !!r.deletedAt }]));
}

/** Names of removed products, so an import or a new product with the same name is explained instead of failing. */
export async function removedProductNamesInternal(tx: Tx, orgId: string): Promise<string[]> {
  return (await tx.select({ name: products.name }).from(products).where(and(eq(products.orgId, orgId), isNotNull(products.deletedAt)))).map((r) => r.name);
}

export async function countProducts(tx: Tx, orgId: string) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(products).where(and(eq(products.orgId, orgId), isNull(products.deletedAt)));
  return r?.n ?? 0;
}

/** A product's commercial terms (G-KB-2) for templates and hold rules; payment terms fall back to the company's. */
export async function productTermsInternal(tx: Tx, orgId: string, productId: string) {
  const [p] = await tx.select({ name: products.name, hsnCode: products.hsnCode, leadTime: products.leadTime, paymentTerms: products.paymentTerms, sampleAvailable: products.sampleAvailable })
    .from(products).where(and(eq(products.orgId, orgId), eq(products.id, productId), isNull(products.deletedAt)));
  return p ?? null;
}

