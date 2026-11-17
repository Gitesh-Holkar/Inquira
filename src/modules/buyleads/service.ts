import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { startOfTodayIST } from "@/lib/format";
import { audit, emit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { buyleadDecisions, buyleadRules } from "./schema";

/**
 * IndiaMART Buy Leads: suggestions only (GOAL G-SRC-8, ADR-020). An assistant reads the rules, says
 * which Buy Leads match, and logs each suggestion or skip. A person chooses and clicks on IndiaMART;
 * no code and no agent task buys a Buy Lead. Bought Buy Leads come back as leads through email sync.
 *
 * Stored values keep their first names: decision `would_contact` means "suggested". `contacted` and
 * the `test_mode` columns are kept for old rows only; nothing writes `contacted` any more.
 */
export type BuyleadRules = typeof buyleadRules.$inferSelect;

export async function getRulesInternal(tx: Tx, ctx: Ctx): Promise<BuyleadRules> {
  const [r] = await tx.select().from(buyleadRules).where(eq(buyleadRules.orgId, ctx.orgId));
  if (r) return r;
  const [created] = await tx.insert(buyleadRules).values({ orgId: ctx.orgId, createdBy: actorString(ctx.actor) }).onConflictDoNothing().returning();
  if (created) {
    await audit(tx, ctx, { action: "buylead.rules_create", entityType: "buylead_rules", entityId: created.id });
    return created;
  }
  return (await tx.select().from(buyleadRules).where(eq(buyleadRules.orgId, ctx.orgId)))[0]!;
}

const termsSchema = z.array(z.object({
  productId: z.string().uuid().nullable(),
  productName: z.string().trim().min(1).max(120),
  terms: z.array(z.string().trim().toLowerCase().min(2).max(80)).max(30),
})).max(200);

export const rulesInput = z.object({
  productTerms: termsSchema,
  excludedTerms: z.array(z.string().trim().toLowerCase().min(2).max(80)).max(100),
  allowedCountries: z.array(z.string().trim().min(2).max(60)).max(20),
  allowedStates: z.array(z.string().trim().min(2).max(60)).max(40),
  excludedStates: z.array(z.string().trim().min(2).max(60)).max(40),
  minQuantityKg: z.union([z.number().nonnegative(), z.null()]),
  maxQuantityKg: z.union([z.number().positive(), z.null()]),
  /** The most Buy Leads to suggest in a day, so following every suggestion cannot overspend credits. */
  dailyCap: z.number().int().min(0).max(200),
}).refine((r) => r.minQuantityKg === null || r.maxQuantityKg === null || r.minQuantityKg <= r.maxQuantityKg, {
  message: "Minimum quantity must be less than maximum", path: ["minQuantityKg"],
});

export const updateBuyleadRules = defineService({
  name: "buyleads.updateRules",
  input: rulesInput,
  permission: "buylead.rules.write",
  handler: async (ctx, input, tx) => {
    const before = await getRulesInternal(tx, ctx);
    const [after] = await tx.update(buyleadRules).set({
      ...input,
      testMode: true, // suggestions only (ADR-020)
      minQuantityKg: input.minQuantityKg === null ? null : String(input.minQuantityKg),
      maxQuantityKg: input.maxQuantityKg === null ? null : String(input.maxQuantityKg),
    }).where(eq(buyleadRules.id, before.id)).returning();
    await audit(tx, ctx, { action: "buylead.rules_update", entityType: "buylead_rules", entityId: before.id, changes: { dailyCap: [before.dailyCap, input.dailyCap], products: input.productTerms.length } });
    return after!;
  },
});

/** Full rules for the Settings screen. */
export const getBuyleadRules = defineService({
  name: "buyleads.getRules",
  input: z.object({}).default({}),
  permission: "buylead.rules.read",
  handler: (ctx, _i, tx) => getRulesInternal(tx, ctx),
});

export async function todayDecisionCountsInternal(tx: Tx, orgId: string) {
  return todayCounts(tx, orgId);
}

async function todayCounts(tx: Tx, orgId: string) {
  const since = startOfTodayIST();
  const rows = await tx.select({ decision: buyleadDecisions.decision, n: sql<number>`count(*)::int` })
    .from(buyleadDecisions).where(and(eq(buyleadDecisions.orgId, orgId), gte(buyleadDecisions.decidedAt, since)))
    .groupBy(buyleadDecisions.decision);
  const c = { contacted: 0, skipped: 0, would_contact: 0 };
  for (const r of rows) c[r.decision] = r.n;
  return c;
}

/** Compact rules for an assistant over MCP (token-light). `remaining_today` is how many more it may suggest today. */
export const getBuyleadRulesCompact = defineService({
  name: "buyleads.getRulesCompact",
  input: z.object({}).default({}),
  permission: "buylead.rules.read",
  handler: async (ctx, _i, tx) => {
    const r = await getRulesInternal(tx, ctx);
    const c = await todayCounts(tx, ctx.orgId);
    return {
      mode: "suggest_only" as const,
      daily_cap: r.dailyCap,
      remaining_today: Math.max(0, r.dailyCap - c.would_contact),
      products: r.productTerms.map((p) => ({ name: p.productName, match: p.terms })),
      exclude: r.excludedTerms,
      countries: r.allowedCountries,
      states_allowed: r.allowedStates,
      states_excluded: r.excludedStates,
      qty_kg: { min: r.minQuantityKg === null ? null : Number(r.minQuantityKg), max: r.maxQuantityKg === null ? null : Number(r.maxQuantityKg) },
    };
  },
});

export const logBuyleadDecision = defineService({
  name: "buyleads.logDecision",
  input: z.object({
    lead_title: z.string().trim().min(1).max(300),
    product: z.string().trim().max(200).optional(),
    location: z.string().trim().max(200).optional(),
    quantity: z.string().trim().max(100).optional(),
    /** `would_contact` = suggested to the team. There is no value for "bought": software never buys (ADR-020). */
    decision: z.enum(["skipped", "would_contact"]),
    reason: z.string().trim().min(1).max(500),
    timestamp: z.string().datetime({ offset: true }).optional(),
  }),
  permission: "buylead.decisions.write",
  handler: async (ctx, input, tx) => {
    const r = await getRulesInternal(tx, ctx);
    const c = await todayCounts(tx, ctx.orgId);
    // The daily limit is enforced here too: a suggestion beyond it is still logged, but flagged.
    const overCap = input.decision === "would_contact" && c.would_contact >= r.dailyCap;
    const [row] = await tx.insert(buyleadDecisions).values({
      orgId: ctx.orgId, leadTitle: input.lead_title, product: input.product ?? null, location: input.location ?? null,
      quantity: input.quantity ?? null, decision: input.decision, reason: input.reason,
      decidedAt: input.timestamp ? new Date(input.timestamp) : new Date(), testMode: true,
      meta: overCap ? { over_cap: true } : {}, createdBy: actorString(ctx.actor),
    }).returning();
    await audit(tx, ctx, { action: "buylead.decision", entityType: "buylead_decision", entityId: row!.id, changes: { decision: input.decision, overCap } });
    await emit(tx, ctx, { type: "buylead.decision_logged", entityType: "buylead_decision", entityId: row!.id, payload: { decision: input.decision } });
    const used = c.would_contact + (input.decision === "would_contact" ? 1 : 0);
    return { id: row!.id, remaining_today: Math.max(0, r.dailyCap - used), over_cap: overCap };
  },
});

export const getBuyleadSummary = defineService({
  name: "buyleads.summary",
  input: z.object({}).default({}),
  permission: "buylead.decisions.read",
  handler: async (ctx, _i, tx) => {
    const r = await getRulesInternal(tx, ctx);
    const c = await todayCounts(tx, ctx.orgId);
    return { date: new Date().toISOString(), mode: "suggest_only" as const, daily_cap: r.dailyCap, remaining_today: Math.max(0, r.dailyCap - c.would_contact), ...c };
  },
});

export const listBuyleadDecisions = defineService({
  name: "buyleads.listDecisions",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50), sinceDays: z.number().int().min(1).max(90).default(7) }),
  permission: "buylead.decisions.read",
  handler: (ctx, input, tx) =>
    tx.select().from(buyleadDecisions)
      .where(and(eq(buyleadDecisions.orgId, ctx.orgId), gte(buyleadDecisions.decidedAt, new Date(Date.now() - input.sinceDays * 86400_000))))
      .orderBy(desc(buyleadDecisions.decidedAt)).limit(input.limit),
});

/** Seeds matching terms from catalog names + aliases. */
export async function seedRulesFromCatalogInternal(tx: Tx, ctx: Ctx, catalog: { id: string; name: string; aliases: string[] }[]) {
  const r = await getRulesInternal(tx, ctx);
  if (r.productTerms.length) return r;
  const productTerms = catalog.map((p) => ({ productId: p.id, productName: p.name, terms: [...new Set([p.name.toLowerCase().replace(/\s*\([^)]*\)/g, ""), ...p.aliases.map((a) => a.toLowerCase())])] }));
  const [after] = await tx.update(buyleadRules).set({ productTerms, excludedTerms: ["machine", "plant", "production plant", "equipment", "sample only"] }).where(eq(buyleadRules.id, r.id)).returning();
  await audit(tx, ctx, { action: "buylead.rules_seed", entityType: "buylead_rules", entityId: r.id, changes: { products: productTerms.length } });
  return after!;
}

/** A product left the catalogue: its Buy Lead match terms go too, so nothing is suggested for it. Returns how many entries were removed. */
export async function dropProductTermsInternal(tx: Tx, ctx: Ctx, productId: string): Promise<number> {
  const r = await getRulesInternal(tx, ctx);
  const kept = r.productTerms.filter((t) => t.productId !== productId);
  if (kept.length === r.productTerms.length) return 0;
  await tx.update(buyleadRules).set({ productTerms: kept }).where(eq(buyleadRules.id, r.id));
  await audit(tx, ctx, { action: "buylead.rules_product_removed", entityType: "buylead_rules", entityId: r.id, changes: { productId } });
  return r.productTerms.length - kept.length;
}

/** A product came back: match terms from its name and other names, unless it already has an entry. */
export async function addProductTermsInternal(tx: Tx, ctx: Ctx, product: { id: string; name: string; aliases: string[] }) {
  const r = await getRulesInternal(tx, ctx);
  if (r.productTerms.some((t) => t.productId === product.id)) return;
  const terms = [...new Set([product.name.toLowerCase().replace(/\s*\([^)]*\)/g, ""), ...product.aliases.map((a) => a.toLowerCase())])];
  await tx.update(buyleadRules).set({ productTerms: [...r.productTerms, { productId: product.id, productName: product.name, terms }] }).where(eq(buyleadRules.id, r.id));
  await audit(tx, ctx, { action: "buylead.rules_product_added", entityType: "buylead_rules", entityId: r.id, changes: { productId: product.id } });
}

