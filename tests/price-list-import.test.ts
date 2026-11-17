/**
 * Price list import against the database (GOAL G-KB-6): a new list becomes new rate-book entries,
 * old rates stay in history, nothing is overwritten, and every seed folder's own list imports cleanly.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { auditLogs, orgSettings } from "@/modules/core/schema";
import { priceEntries, productGrades, products } from "@/modules/catalog/schema";
import { createProduct, getCurrentRates, listProducts, listRemovedProducts, productMatcherCatalog, rateHistory, removeProduct, restoreProduct, updateProduct, updateRates } from "@/modules/catalog/service";
import { getBuyleadRules, getBuyleadRulesCompact, updateBuyleadRules } from "@/modules/buyleads/service";
import { createQuoteDraft } from "@/modules/quotes/service";
import { leads } from "@/modules/leads/schema";
import { withSystemTx } from "@/db/client";
import { planCounts } from "@/modules/catalog/price-list";
import { applyPriceListImport, planPriceListImport, savePriceListMap } from "@/modules/catalog/price-list-service";
import { seed } from "@/server/seed";
import { addMember, createUser, resetDb, setupOrgWithUser } from "./helpers/db";
import type { Ctx, Role } from "@/modules/core/types";

const human = (orgId: string, user: { id: string; email: string }, role: Role): Ctx => ({ orgId, actor: { kind: "human", userId: user.id, email: user.email, role } });
const MAP = {
  terms: { price_basis: "Ex-factory", moq_kg: 100 },
  categories: { Proteins: { gst_percent: 18, pack_size: "20 Kg" }, Fibers: { gst_percent: 5, pack_size: "25 Kg" } },
  lines: {
    "sample fiber soluble": { product: "Sample Fiber", grade: "Soluble", was_grade: "Standard", aliases: ["sample fibre"] },
    "sample fiber insoluble": { product: "Sample Fiber", grade: "Insoluble" },
  },
};
const LIST = "Proteins:\nSample Protein Isolate - 360 Rs/Kg\nNew Sample Protein - 500 Rs/Kg\nFibers:\nSample Fiber Soluble - 275 Rs/Kg\nSample Fiber Insoluble - 150 Rs/Kg\nthis line has no price";

/** An owner's company with two products, one of them with a rate, the way the Rates screen would leave it. */
async function company() {
  const { org, ctx, user } = await setupOrgWithUser("owner");
  const protein = await createProduct(ctx, { name: "Sample Protein Isolate", grades: ["Standard"] });
  const fiber = await createProduct(ctx, { name: "Sample Fiber", grades: ["Standard"] });
  await updateRates(ctx, { items: [
    { gradeId: protein.grades[0]!.id, pricePerKgInr: "350", gstPercent: "18", priceBasis: "Ex-factory", packSize: "20 Kg" },
    { gradeId: fiber.grades[0]!.id, pricePerKgInr: "275", gstPercent: "5", priceBasis: "Ex-factory", packSize: "25 Kg" },
  ] });
  await savePriceListMap(ctx, { map: MAP });
  return { org, ctx, user, protein, fiber };
}

describe("price list import (G-KB-6)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("shows the changes without writing anything", async () => {
    const { org, ctx } = await company();
    const before = await getDb().select().from(priceEntries).where(eq(priceEntries.orgId, org.id));
    const plan = await planPriceListImport(ctx, { text: LIST });
    expect(plan.rows.map((r) => r.kind)).toEqual(["price_change", "new_product", "terms_change", "new_grade"]);
    expect(plan.unparsed).toEqual(["this line has no price"]);
    expect(await getDb().select().from(priceEntries).where(eq(priceEntries.orgId, org.id))).toHaveLength(before.length);
    expect(await getDb().select().from(products).where(eq(products.orgId, org.id))).toHaveLength(2);
  });

  it("an owner applies it under row-level security: new rows are added, old rates stay in history, and it is audited", async () => {
    const { org, ctx, user, protein, fiber } = await company();
    const { counts } = await applyPriceListImport(ctx, { text: LIST });
    expect(counts).toEqual({ productsCreated: 1, gradesCreated: 1, gradesRenamed: 1, ratesWritten: 4, skipped: 0 });

    const current = await getCurrentRates(ctx, {});
    const byName = Object.fromEntries(current.map((r) => [`${r.productName}/${r.gradeName}`, r]));
    expect(byName["Sample Protein Isolate/Standard"]).toMatchObject({ pricePerKgInr: "360.00", gstPercent: "18.00", moqKg: "100.00", packSize: "20 Kg" });
    expect(byName["New Sample Protein/Standard"]).toMatchObject({ pricePerKgInr: "500.00", gstPercent: "18.00", moqKg: "100.00" });
    expect(byName["Sample Fiber/Soluble"]).toMatchObject({ pricePerKgInr: "275.00", gradeId: fiber.grades[0]!.id }); // renamed, not replaced
    expect(byName["Sample Fiber/Insoluble"]).toMatchObject({ pricePerKgInr: "150.00", gstPercent: "5.00" });
    expect(byName["Sample Fiber/Standard"]).toBeUndefined();

    // Nothing overwritten: the old 350 is still there, followed by the new 360 with the list's own line as its note.
    const history = await getDb().select().from(priceEntries).where(eq(priceEntries.gradeId, protein.grades[0]!.id)).orderBy(asc(priceEntries.createdAt));
    expect(history.map((h) => h.pricePerKgInr)).toEqual(["350.00", "360.00"]);
    expect(history[1]!.note).toBe('Price list: "Sample Protein Isolate - 360 Rs/Kg"');
    expect(history[1]!.createdBy).toBe(`human:${user.id}`);

    const [fiberRow] = await getDb().select().from(products).where(eq(products.id, fiber.product.id));
    expect(fiberRow!.aliases).toContain("sample fibre");
    const actions = (await getDb().select().from(auditLogs).where(eq(auditLogs.orgId, org.id))).filter((a) => a.actor === `human:${user.id}`).map((a) => a.action);
    for (const a of ["product.create", "grade.create", "grade.rename", "product.alias_add", "rate.update", "price_list.import", "settings.price_list_map"]) expect(actions).toContain(a);

    // The same list again changes nothing.
    const again = await planPriceListImport(ctx, { text: LIST });
    expect(planCounts(again)).toMatchObject({ toWrite: 0, unchanged: 4 });
    const second = await applyPriceListImport(ctx, { text: LIST });
    expect(second.counts.ratesWritten).toBe(0);
    expect(await getDb().select().from(priceEntries).where(eq(priceEntries.orgId, org.id))).toHaveLength(6);
  });

  it("leaves out a line it has no GST rate for, and writes the rest", async () => {
    const { ctx } = await company();
    const { counts, plan } = await applyPriceListImport(ctx, { text: "Sample Protein Isolate - 370 Rs/Kg\nUnknown Thing - 10 Rs/Kg" });
    expect(counts).toMatchObject({ ratesWritten: 1, productsCreated: 0, skipped: 1 });
    expect(plan.rows[1]!.problems[0]).toMatch(/no GST rate is known/);
    expect((await getCurrentRates(ctx, {})).map((r) => r.productName)).not.toContain("Unknown Thing");
  });

  it("sales and viewers can read the changes but cannot apply them or change the mapping", async () => {
    const { org } = await company();
    for (const role of ["sales", "viewer"] as const) {
      const u = await createUser();
      await addMember(org.id, u, role);
      const ctx = human(org.id, u, role);
      expect(planCounts(await planPriceListImport(ctx, { text: LIST })).toWrite).toBe(4);
      await expect(applyPriceListImport(ctx, { text: LIST })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(savePriceListMap(ctx, { map: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await getDb().select().from(priceEntries).where(eq(priceEntries.orgId, org.id))).toHaveLength(2);
  });

  it("refuses a mapping file with a wrong shape and keeps the saved one", async () => {
    const { org, ctx } = await company();
    await expect(savePriceListMap(ctx, { map: { categories: { Proteins: { gst_percent: "eighteen" } } } })).rejects.toMatchObject({ code: "VALIDATION" });
    const [s] = await getDb().select().from(orgSettings).where(eq(orgSettings.orgId, org.id));
    expect(s!.priceListMap).toEqual(MAP);
  });
});

describe("editing and removing a product (G-KB-1)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("an owner renames a product and its grades, adds names and a grade; rates and history stay; it is audited", async () => {
    const { org, ctx, user, protein, fiber } = await company();
    const gradeId = fiber.grades[0]!.id;
    const r = await updateProduct(ctx, { productId: fiber.product.id, name: "Sample Fibre", category: "Fibers", aliases: ["Sample Fiber", "sample fiber", "fibre"], grades: [{ id: gradeId, name: "Soluble" }], newGrades: ["Insoluble"] });
    expect(r).toEqual({ ok: true, changed: true });
    const [p] = (await listProducts(ctx, {})).filter((x) => x.id === fiber.product.id);
    expect(p).toMatchObject({ name: "Sample Fibre", category: "Fibers", aliases: ["sample fiber", "fibre"] });
    const rates = (await getCurrentRates(ctx, {})).filter((x) => x.productId === fiber.product.id);
    expect(rates.map((x) => [x.gradeName, x.pricePerKgInr])).toEqual([["Soluble", "275.00"], ["Insoluble", null]]);
    expect(await rateHistory(ctx, { gradeId })).toHaveLength(1); // the rename kept the price history
    const [a] = await getDb().select().from(auditLogs).where(eq(auditLogs.action, "product.update"));
    expect(a).toMatchObject({ actor: `human:${user.id}`, orgId: org.id });
    expect(a!.changes).toMatchObject({ name: ["Sample Fiber", "Sample Fibre"], gradesRenamed: [["Standard", "Soluble"]], gradesAdded: ["Insoluble"] });

    // Names stay unique, with a message a person can act on.
    await expect(updateProduct(ctx, { productId: fiber.product.id, name: "Sample Protein Isolate", aliases: [] })).rejects.toMatchObject({ code: "VALIDATION", message: "A product with this name already exists" });
    await expect(createProduct(ctx, { name: "Sample Protein Isolate" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateProduct(ctx, { productId: fiber.product.id, name: "Sample Fibre", aliases: [], grades: [{ id: gradeId, name: "insoluble" }] })).rejects.toMatchObject({ code: "VALIDATION" });
    // A grade of another product cannot be renamed through this one.
    await expect(updateProduct(ctx, { productId: fiber.product.id, name: "Sample Fibre", aliases: [], grades: [{ id: protein.grades[0]!.id, name: "X" }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("removing a discontinued product hides it everywhere and keeps its history; restoring brings it back as it was", async () => {
    const { org, ctx, user, fiber } = await company();
    await updateBuyleadRules(ctx, { productTerms: [{ productId: fiber.product.id, productName: "Sample Fiber", terms: ["sample fiber"] }], excludedTerms: [], allowedCountries: ["India"], allowedStates: [], excludedStates: [], minQuantityKg: null, maxQuantityKg: null, dailyCap: 5 });
    const [lead] = await getDb().insert(leads).values({ orgId: org.id, source: "manual", sourceRef: "m-rm", productText: "Sample Fiber", productId: fiber.product.id, createdBy: "system:test" }).returning();

    await removeProduct(ctx, { productId: fiber.product.id });
    expect((await getCurrentRates(ctx, {})).map((r) => r.productName)).not.toContain("Sample Fiber");
    expect((await withSystemTx((tx) => productMatcherCatalog(tx, org.id))).map((p) => p.name)).not.toContain("Sample Fiber");
    expect((await getBuyleadRulesCompact(ctx, {})).products).toEqual([]); // no Buy Lead suggestions for it
    expect((await listRemovedProducts(ctx, {})).map((p) => p.name)).toEqual(["Sample Fiber"]);
    // A quote for a lead still linked to it says what happened instead of "no rate".
    await expect(createQuoteDraft(ctx, { leadId: lead!.id })).rejects.toThrow(/was removed from the catalogue/);
    // The same name cannot be added again by mistake, and a price list line for it is explained, not crashed on.
    await expect(createProduct(ctx, { name: "Sample Fiber" })).rejects.toThrow(/removed product has this name/);
    const plan = await planPriceListImport(ctx, { text: "Sample Fiber - 300 Rs/Kg", map: { categories: {}, lines: { "sample fiber": { product: "Sample Fiber", grade: "Standard" } } } });
    expect(plan.rows[0]!.problems.join(" ")).toMatch(/was removed from the catalogue/);

    await restoreProduct(ctx, { productId: fiber.product.id });
    const back = (await getCurrentRates(ctx, {})).find((r) => r.productId === fiber.product.id);
    expect(back).toMatchObject({ productName: "Sample Fiber", pricePerKgInr: "275.00" });
    expect((await getBuyleadRules(ctx, {})).productTerms.map((t) => t.productId)).toEqual([fiber.product.id]);
    expect(await listRemovedProducts(ctx, {})).toEqual([]);
    const actions = (await getDb().select().from(auditLogs).where(eq(auditLogs.orgId, org.id))).filter((a) => a.actor === `human:${user.id}`).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["product.remove", "buylead.rules_product_removed", "product.restore", "buylead.rules_product_added"]));
  });

  it("two grades can swap names in one save", async () => {
    const { ctx } = await setupOrgWithUser("owner");
    const p = await createProduct(ctx, { name: "Sample Starch", grades: ["Native", "Waxy"] });
    await updateProduct(ctx, { productId: p.product.id, name: "Sample Starch", aliases: [], grades: [{ id: p.grades[0]!.id, name: "Waxy" }, { id: p.grades[1]!.id, name: "Native" }] });
    expect((await getCurrentRates(ctx, {})).map((r) => [r.gradeId, r.gradeName])).toEqual([[p.grades[0]!.id, "Waxy"], [p.grades[1]!.id, "Native"]]);
  });

  it("sales and viewers cannot edit a product; another company's product is not found", async () => {
    const { org, fiber } = await company();
    for (const role of ["sales", "viewer"] as const) {
      const u = await createUser();
      await addMember(org.id, u, role);
      await expect(updateProduct(human(org.id, u, role), { productId: fiber.product.id, name: "Changed", aliases: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(removeProduct(human(org.id, u, role), { productId: fiber.product.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(restoreProduct(human(org.id, u, role), { productId: fiber.product.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const other = await setupOrgWithUser("owner");
    await expect(updateProduct(other.ctx, { productId: fiber.product.id, name: "Changed", aliases: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removeProduct(other.ctx, { productId: fiber.product.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("seed folders", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  const root = path.join(process.cwd(), "seed");
  const dirs = readdirSync(root).filter((d) => existsSync(path.join(root, d, "products.json")));

  it("there is at least one seed folder", () => expect(dirs.length).toBeGreaterThan(0));

  it.each(dirs)("seed/%s loads completely, and its own price list then shows nothing left to change", async (dir) => {
    const owner = await createUser("owner@example.com");
    const seedDir = path.join(root, dir);
    const { orgId } = await seed({ ownerUserId: owner.id, ownerEmail: owner.email, seedDir });
    const ctx: Ctx = { orgId, actor: { kind: "system", job: "test" } };
    const lists = existsSync(path.join(seedDir, "price-lists")) ? readdirSync(path.join(seedDir, "price-lists")).filter((f) => f.endsWith(".txt")).sort() : [];
    if (!lists.length) return;
    const text = readFileSync(path.join(seedDir, "price-lists", lists[lists.length - 1]!), "utf8");
    const plan = await planPriceListImport(ctx, { text });
    expect(planCounts(plan)).toEqual({ read: plan.rows.length, toWrite: 0, unchanged: plan.rows.length, problems: 0 });
    expect(plan.rows.length).toBeGreaterThan(0);
    expect(plan.footerChanged).toBe(false);
    // Every priced grade is on the list, every rate carries GST, a pack size and a price basis.
    expect(plan.notOnList).toEqual([]);
    const rates = (await getCurrentRates(ctx, {})).filter((r) => r.pricePerKgInr);
    expect(rates).toHaveLength(plan.rows.length);
    for (const r of rates) expect(r.gstPercent && r.packSize && r.priceBasis, `${r.productName} ${r.gradeName}`).toBeTruthy();
    // Running the seed twice adds nothing.
    await seed({ ownerUserId: owner.id, ownerEmail: owner.email, seedDir });
    expect(await getDb().select().from(priceEntries).where(eq(priceEntries.orgId, orgId))).toHaveLength(plan.rows.length);
    expect((await getDb().select().from(productGrades).where(eq(productGrades.orgId, orgId))).length).toBeGreaterThanOrEqual(plan.rows.length);
  });
});
