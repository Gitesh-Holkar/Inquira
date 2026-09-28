import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { contacts } from "@/modules/contacts/schema";
import { auditLogs } from "@/modules/core/schema";
import { createProduct } from "@/modules/catalog/service";
import { leads } from "./schema";
import { addLeadNote, deleteLead, detectInternational, getLead, listLeads, quantityToKg, updateLeadStatus, upsertLeadInternal } from "./service";
import type { NormalizedLead } from "./types";
import { mcpCtx, resetDb, setupOrgWithUser, systemCtx } from "../../../tests/helpers/db";

const base = (over: Partial<NormalizedLead>): NormalizedLead => ({
  source: "tradeindia", sourceRef: "900000001", channel: "tradeindia_api", contactName: "Vikram Shah",
  phone: "+91-9000000707", productText: "Chickpea Isolate Protein", receivedAt: new Date("2026-09-27T15:30:00Z"), ...over,
});

describe("leads: upsert + dedupe", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("is idempotent on (source, source_ref) and fills missing fields from the second copy", async () => {
    const { org } = await setupOrgWithUser();
    const ctx = systemCtx(org.id);
    const a = await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ channel: "tradeindia_email" })));
    const b = await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ channel: "tradeindia_api", email: "vikram@example.com", city: "Hyderabad" })));
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ leadId: a.leadId, created: false, method: "source_ref" });
    const rows = await getDb().select().from(leads);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("vikram@example.com");
    expect(rows[0]!.phone).toBe("+919000000707");
  });

  it("merges a TradeIndia email without inquiry id into the API lead (phone + 48h window)", async () => {
    const { org } = await setupOrgWithUser();
    const ctx = systemCtx(org.id);
    const email = await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ sourceRef: "gmail:msg1", channel: "tradeindia_email" })));
    const api = await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ sourceRef: "900000009", channel: "tradeindia_api", receivedAt: new Date("2026-09-27T15:35:00Z") })));
    expect(api).toMatchObject({ leadId: email.leadId, duplicate: true, method: "contact_time_window" });
    const [row] = await getDb().select().from(leads);
    expect(row!.sourceRef).toBe("900000009"); // upgraded to the real id
    expect(row!.alternateRefs).toEqual([{ source: "tradeindia_email", ref: "gmail:msg1", method: "contact_time_window" }]);
  });

  it("does not merge the same buyer asking for a different product", async () => {
    const { org } = await setupOrgWithUser();
    const ctx = systemCtx(org.id);
    await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ sourceRef: "1" })));
    await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ sourceRef: "2", productText: "Potato Starch" })));
    expect(await getDb().select().from(leads)).toHaveLength(2);
  });

  it("links companies sharing one mobile number to one contact but keeps company names apart", async () => {
    const { org } = await setupOrgWithUser();
    const ctx = systemCtx(org.id);
    await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ sourceRef: "1", companyName: "Alpha Foods", productText: "Pea Protein" })));
    await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ sourceRef: "2", companyName: "Beta Traders", productText: "Soya Flour", receivedAt: new Date("2026-10-10T00:00:00Z") })));
    const cs = await getDb().select().from(contacts);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.companyName).toBe("Alpha Foods"); // never overwritten
    const ls = await getDb().select().from(leads);
    expect(ls.map((l) => l.companyName).sort()).toEqual(["Alpha Foods", "Beta Traders"]);
    expect(new Set(ls.map((l) => l.contactId)).size).toBe(1);
  });

  it("matches email before phone for contacts", async () => {
    const { org } = await setupOrgWithUser();
    const ctx = systemCtx(org.id);
    await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ sourceRef: "1", email: "A@Example.com", phone: null })));
    await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ sourceRef: "2", email: "a@example.com", phone: "+919111111111", productText: "Pea" })));
    const cs = await getDb().select().from(contacts);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.phone).toBe("+919111111111"); // filled, not overwritten
  });

  it("links the catalog product and flags international leads", async () => {
    const { org, ctx: owner } = await setupOrgWithUser("owner");
    const { product } = await createProduct(owner, { name: "Peanut Flour", aliases: ["defatted peanut flour"], grades: ["Standard"] });
    const ctx = systemCtx(org.id);
    const r = await withSystemTx((tx) => upsertLeadInternal(tx, ctx, base({ source: "indiamart", sourceRef: "gmail:x", productText: "Peanut Flour Powder for Protein Supplements", country: "Lebanon", phone: "+961-70000303" })));
    const [row] = await getDb().select().from(leads).where(eq(leads.id, r.leadId));
    expect(row!.productId).toBe(product.id);
    expect(row!.isInternational).toBe(true);
    const list = await listLeads(owner, {});
    expect(list.total).toBe(0); // international leads are hidden from the default inbox
    expect((await listLeads(owner, { international: "only" })).total).toBe(1);
  });
});

describe("leads: status, notes and permissions", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("MCP tokens can update status and add notes, but not delete; everything is audited with the token name", async () => {
    const { org } = await setupOrgWithUser();
    const { leadId } = await withSystemTx((tx) => upsertLeadInternal(tx, systemCtx(org.id), base({})));
    const mcp = mcpCtx(org.id, "claude-desktop");
    await updateLeadStatus(mcp, { leadId, status: "contacted" });
    await addLeadNote(mcp, { leadId, body: "Called, wants COA" });
    await expect(deleteLead(mcp, { leadId })).rejects.toThrow(/Not allowed: leads.delete/);
    const detail = await getLead(mcp, { leadId });
    expect(detail.lead.status).toBe("contacted");
    expect(detail.statusChanges.map((s) => s.toStatus)).toEqual(["contacted", "new"]);
    expect(detail.notes[0]!.createdBy).toBe("mcp:claude-desktop");
    const audits = await getDb().select().from(auditLogs).where(eq(auditLogs.actor, "mcp:claude-desktop"));
    expect(audits.map((a) => a.action).sort()).toEqual(["lead.note", "lead.status"]);
  });

  it("MCP cannot read another org's lead", async () => {
    const { org } = await setupOrgWithUser();
    const { org: other } = await setupOrgWithUser();
    const { leadId } = await withSystemTx((tx) => upsertLeadInternal(tx, systemCtx(org.id), base({})));
    await expect(getLead(mcpCtx(other.id), { leadId })).rejects.toThrow(/not found/);
  });
});

describe("helpers", () => {
  it.each([["25 Kg", "25"], ["1 ton", "1000"], ["500 grams", "0.5"], ["1,000 kg", "1000"], ["some", null]])("quantityToKg(%s)", (t, kg) =>
    expect(quantityToKg(t)).toBe(kg));
  it("detects international", () => {
    expect(detectInternational({ country: "IN" })).toBe(false);
    expect(detectInternational({ country: "India" })).toBe(false);
    expect(detectInternational({ country: "Lebanon" })).toBe(true);
    expect(detectInternational({ phone: "+96170000303" })).toBe(true);
    expect(detectInternational({ phone: "+919000000000" })).toBe(false);
  });
});
