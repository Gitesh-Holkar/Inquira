import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { auditLogs, events } from "@/modules/core/schema";
import { eq } from "drizzle-orm";
import { createProduct, getCurrentRates, matchProduct, rateHistory, updateRates } from "./service";
import { mcpCtx, resetDb, setupOrgWithUser } from "../../../tests/helpers/db";

describe("catalog service", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("keeps rate history append-only and returns the newest as current", async () => {
    const { ctx } = await setupOrgWithUser("admin");
    const { grades } = await createProduct(ctx, { name: "Pea Protein Isolate", grades: ["Standard"] });
    const gradeId = grades[0]!.id;
    await updateRates(ctx, { validFrom: "2026-09-01", items: [{ gradeId, pricePerKgInr: "340", gstPercent: "18", priceBasis: "Ex-factory" }] });
    await updateRates(ctx, { validFrom: "2026-09-02", items: [{ gradeId, pricePerKgInr: "350", gstPercent: "18", priceBasis: "Ex-factory", moqKg: "100" }] });

    const current = await getCurrentRates(ctx, {});
    expect(current[0]!.pricePerKgInr).toBe("350.00");
    expect(current[0]!.moqKg).toBe("100.00");
    const hist = await rateHistory(ctx, { gradeId });
    expect(hist.map((h) => h.pricePerKgInr)).toEqual(["350.00", "340.00"]);

    const audits = await getDb().select().from(auditLogs).where(eq(auditLogs.orgId, ctx.orgId));
    expect(audits.filter((a) => a.action === "rate.update")).toHaveLength(2);
    expect(audits.every((a) => a.actor === `human:${(ctx.actor as { userId: string }).userId}`)).toBe(true);
    const evts = await getDb().select().from(events).where(eq(events.type, "rate.updated"));
    expect(evts).toHaveLength(2);
  });

  it("forbids sales users and MCP tokens from changing rates", async () => {
    const { ctx } = await setupOrgWithUser("sales");
    await expect(updateRates(ctx, { items: [{ gradeId: crypto.randomUUID(), pricePerKgInr: "1", gstPercent: "5", priceBasis: "x" }] })).rejects.toThrow(/Not allowed: rates.write/);
    await expect(updateRates(mcpCtx(ctx.orgId), { items: [{ gradeId: crypto.randomUUID(), pricePerKgInr: "1", gstPercent: "5", priceBasis: "x" }] })).rejects.toThrow(/Not allowed/);
  });

  it("validates rate input", async () => {
    const { ctx } = await setupOrgWithUser("admin");
    await expect(updateRates(ctx, { items: [{ gradeId: crypto.randomUUID(), pricePerKgInr: "abc", gstPercent: "18", priceBasis: "x" }] })).rejects.toThrow(/Invalid input/);
  });
});

describe("matchProduct", () => {
  const catalog = [
    { id: "pea", name: "Pea Protein Isolate", aliases: ["pea isolate protein", "pea protein"] },
    { id: "soy", name: "Soya Protein Isolate", aliases: ["soy protein isolate", "soya isolate protein"] },
    { id: "rice", name: "Brown Rice Protein Isolate", aliases: ["rice protein isolate", "rice protein"] },
    { id: "pf", name: "Peanut Flour", aliases: ["defatted peanut flour"] },
    { id: "ppi", name: "Peanut Protein Isolate", aliases: ["peanut isolate protein"] },
    { id: "sf", name: "Soya Flour", aliases: ["defatted soya flour", "soy flour"] },
  ];
  it.each([
    ["Soy Protein Isolate Powder", "soy"],
    ["Pea Protein", "pea"],
    ["Rice Protein Meal 90 Protein", "rice"],
    ["Defatted Peanut Flour", "pf"],
    ["Peanut Protein Isolate", "ppi"],
    ["Soya Flour Powder, Protein Content: 50-55, Packaging Size: 25 kg", "sf"],
    ["CHICKPEA ISOLATE PROTEIN", null],
    ["Potato Starch Powder Production Plant", null],
  ])("%s → %s", (text, id) => expect(matchProduct(text, catalog)?.id ?? null).toBe(id));
});
