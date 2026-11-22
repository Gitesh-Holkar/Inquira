/**
 * Knowledge base and lead score (GOAL G-KB-2, G-KB-3, G-KB-5, G-UND-6), as a signed-in owner under RLS
 * unless a system job is the point. All data invented.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { addDays, todayIST } from "@/lib/format";
import { createProduct, currentRatesInternal, productTermsInternal, updateProduct, updateRates } from "@/modules/catalog/service";
import { getOrgSettings, updateOrgSettings } from "@/modules/core/service";
import { samplePolicySchema } from "@/modules/catalog/types";
import { leads } from "@/modules/leads/schema";
import { listLeads, rescoreLeadsInternal, updateLead, upsertLeadInternal } from "@/modules/leads/service";
import { scoreLead } from "@/modules/leads/understanding";
import type { Ctx } from "@/modules/core/types";
import { DEFAULT_ITEM_BLOCK, render } from "@/modules/templates/engine";
import { resetDb, setupOrgWithUser, systemCtx } from "./helpers/db";

let ctx: Ctx;
let sys: Ctx;
let productId: string;
let gradeId: string;

beforeEach(async () => {
  await resetDb();
  const s = await setupOrgWithUser("owner");
  ctx = s.ctx;
  sys = systemCtx(s.org.id);
  const { product, grades } = await createProduct(ctx, { name: "Sample Protein Isolate", grades: ["Standard"] });
  productId = product.id;
  gradeId = grades[0]!.id;
});
afterAll(closeDb);

const rate = (over: Record<string, unknown> = {}) => ({ gradeId, pricePerKgInr: "300", gstPercent: "18", priceBasis: "Ex-factory", moqKg: "100", ...over });

describe("commercial terms (G-KB-2)", () => {
  it("are saved per product, cleared with an empty value, and payment terms fall back to the company's", async () => {
    const base = { productId, name: "Sample Protein Isolate", aliases: [] };
    await updateProduct(ctx, { ...base, hsnCode: "35040091", leadTime: "7 to 10 days", sampleAvailable: true });
    expect(await withSystemTx((tx) => productTermsInternal(tx, sys.orgId, productId))).toMatchObject({ hsnCode: "35040091", leadTime: "7 to 10 days", paymentTerms: null, sampleAvailable: true });
    await updateProduct(ctx, { ...base, leadTime: "", sampleAvailable: null });
    expect(await withSystemTx((tx) => productTermsInternal(tx, sys.orgId, productId))).toMatchObject({ hsnCode: "35040091", leadTime: null, sampleAvailable: null });
    await expect(updateProduct(ctx, { ...base, hsnCode: "35A" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("terms on quotations", () => {
  it("prints filled terms and drops empty ones without leaving a blank line (regression)", () => {
    const vars = { product: "P", grade: "G", price_per_kg: "300.00", price_basis: "Ex-factory", pack_size: "20 Kg", gst_percent: "18", moq: "100", payment_terms: "100% advance" };
    const without = render(DEFAULT_ITEM_BLOCK, vars);
    expect(without).not.toMatch(/HSN|Lead time/);
    expect(without).not.toContain("\n\n");
    expect(render(DEFAULT_ITEM_BLOCK, { ...vars, hsn_code: "35040091", lead_time: "7 to 10 days" })).toContain("- HSN: 35040091\n- Lead time: 7 to 10 days\n- Payment: 100% advance");
  });
});

describe("rates: valid until, lowest and highest price (G-KB-3)", () => {
  it("a rate past its last day is no longer current", async () => {
    await updateRates(ctx, { validTo: addDays(todayIST(), 2), items: [rate()] });
    const now = await withSystemTx((tx) => currentRatesInternal(tx, sys.orgId));
    expect(now[0]).toMatchObject({ pricePerKgInr: "300.00", validTo: addDays(todayIST(), 2) });
    const later = await withSystemTx((tx) => currentRatesInternal(tx, sys.orgId, { asOf: addDays(todayIST(), 3) }));
    expect(later[0]!.pricePerKgInr).toBeNull();
    await expect(updateRates(ctx, { validFrom: addDays(todayIST(), 5), validTo: addDays(todayIST(), 4), items: [rate()] })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps the range on a new price inside it, drops it when the price leaves it, and refuses a range around the wrong side", async () => {
    await updateRates(ctx, { items: [rate({ floorPerKgInr: "280", ceilingPerKgInr: "320" })] });
    await updateRates(ctx, { items: [rate({ pricePerKgInr: "310" })] }); // e.g. the price list import: no range given
    let [r] = await withSystemTx((tx) => currentRatesInternal(tx, sys.orgId));
    expect(r).toMatchObject({ floorPerKgInr: "280.00", ceilingPerKgInr: "320.00" });
    await updateRates(ctx, { items: [rate({ pricePerKgInr: "340" })] });
    [r] = await withSystemTx((tx) => currentRatesInternal(tx, sys.orgId));
    expect(r).toMatchObject({ floorPerKgInr: "280.00", ceilingPerKgInr: null });
    await expect(updateRates(ctx, { items: [rate({ floorPerKgInr: "350" })] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateRates(ctx, { items: [rate({ ceilingPerKgInr: "250" })] })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("sample policy (G-KB-5)", () => {
  it("is empty until entered and is saved as the company's setting", async () => {
    expect(samplePolicySchema.parse((await getOrgSettings(ctx, {})).samplePolicy ?? {})).toEqual({ freeSampleSize: null, requiredDetails: [], note: null });
    await updateOrgSettings(ctx, { samplePolicy: { freeSampleSize: "250 g", requiredDetails: ["Company name", "GST number"], note: "Courier paid by the buyer" } });
    expect((await getOrgSettings(ctx, {})).samplePolicy).toEqual({ freeSampleSize: "250 g", requiredDetails: ["Company name", "GST number"], note: "Courier paid by the buyer" });
    const sales = await setupOrgWithUser("sales");
    await expect(updateOrgSettings(sales.ctx, { samplePolicy: { freeSampleSize: "1 kg", requiredDetails: [], note: null } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("lead score (G-UND-6)", () => {
  it("adds up product, quantity against MOQ and buyer details, with reasons", () => {
    const full = scoreLead({ productId: "p", quantityKg: "500", phone: "+919000000001", email: "a@example.com", companyName: "Co", intent: "new_enquiry" }, 100);
    expect(full.score).toBe(100);
    const below = scoreLead({ productId: "p", quantityKg: "30", phone: null, email: null, companyName: null, intent: null }, 100);
    expect(below.score).toBe(35);
    expect(below.reasons.map((r) => r.reason)).toContain("Quantity below the MOQ of 100 kg");
    expect(scoreLead({ productId: "p", quantityKg: "500", phone: "x", email: "y", companyName: "z", intent: "not_buyer" }, 100).score).toBe(0);
  });

  it("is stored on arrival and after an edit; the inbox sorts by it; the daily job refreshes old scores", async () => {
    await updateRates(ctx, { items: [rate()] });
    const mk = (ref: string, over: Record<string, string>) => withSystemTx((tx) => upsertLeadInternal(tx, sys, {
      source: "indiamart", sourceRef: ref, channel: "indiamart_api_w", receivedAt: new Date(), ...over,
    }));
    const weak = await mk("IM-1", { phone: "+919000000101", productText: "something else" });
    const strong = await mk("IM-2", { phone: "+919000000102", email: "b2@example.com", companyName: "Test Co", productText: "Sample Protein Isolate", quantityText: "500 kg" });
    const sorted = await listLeads(ctx, { sort: "score" });
    expect(sorted.items.map((l) => l.id)).toEqual([strong.leadId, weak.leadId]);
    expect(sorted.items[0]!.score).toBe(100);

    const edited = await updateLead(ctx, { leadId: weak.leadId, fields: { productId } });
    expect(edited.score).toBeGreaterThan(sorted.items[1]!.score);

    // MOQ goes up: tonight's job lowers the strong lead's score.
    await updateRates(ctx, { items: [rate({ moqKg: "1000" })] });
    await getDb().update(leads).set({ scoredAt: new Date(Date.now() - 2 * 86400_000) }).where(eq(leads.id, strong.leadId));
    const r = await withSystemTx((tx) => rescoreLeadsInternal(tx, sys));
    expect(r.rescored).toBeGreaterThanOrEqual(1);
    const [after] = await getDb().select().from(leads).where(eq(leads.id, strong.leadId));
    expect(after!.score).toBe(80);
    expect(after!.scoreReasons.map((x) => x.reason)).toContain("Quantity below the MOQ of 1000 kg");
    expect((await withSystemTx((tx) => rescoreLeadsInternal(tx, sys))).rescored).toBe(0); // nothing left today
  });
});
