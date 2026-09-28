import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { leads } from "@/modules/leads/schema";
import { emailMessages } from "@/modules/email/schema";
import { quotations } from "@/modules/quotes/schema";
import { integrations, syncRuns } from "@/modules/core/schema";
import { getIntegrationInternal, updateIntegrationInternal, writeSecretsInternal } from "@/modules/core/service";
import { syncGmail } from "@/modules/sources/gmail/service";
import { syncTradeIndia } from "@/modules/sources/tradeindia/service";
import { createQuoteDraft, whatsappForLead } from "@/modules/quotes/service";
import { createProduct, updateRates } from "@/modules/catalog/service";
import { ensureDefaultTemplatesInternal } from "@/modules/templates/service";
import { getReconciliation, listEmailsNeedingReview, submitEmailClassification } from "@/modules/email/service";
import { fakeGoogle, fixture, toGmailMessage } from "./helpers/fake-google";
import { mcpCtx, resetDb, setupOrgWithUser, systemCtx } from "./helpers/db";

async function connectGmail(orgId: string) {
  const ctx = systemCtx(orgId);
  await withSystemTx(async (tx) => {
    const integ = await getIntegrationInternal(tx, orgId, "gmail");
    await writeSecretsInternal(tx, ctx, integ, { clientId: "x.apps.googleusercontent.com", clientSecret: "secret-123456", refreshToken: "rt" });
    await updateIntegrationInternal(tx, ctx, integ.id, { status: "connected", accountEmail: "sales@seller.example", config: { ownAddresses: ["sales@seller.example"] } });
  });
}

async function catalogWithRates(ctx: Parameters<typeof createProduct>[0]) {
  const { grades } = await createProduct(ctx, { name: "Chickpea Protein Isolate", aliases: ["chickpea isolate protein"], grades: ["Standard"] });
  await updateRates(ctx, { items: [{ gradeId: grades[0]!.id, pricePerKgInr: "485", gstPercent: "18", priceBasis: "Ex-factory", moqKg: "100", packSize: "20 Kg" }] });
  await withSystemTx((tx) => ensureDefaultTemplatesInternal(tx, systemCtx(ctx.orgId)));
}

const tiApiRow = (over: Record<string, unknown> = {}) => ({
  rfi_id: "900000001", sender_name: "Vikram Shah", sender_mobile: "+919000000707", sender_email: "vikram@example.com", sender_city: "Hyderabad",
  sender_state: "Telangana", sender_country: "India", product_name: "Chickpea Isolate Protein", quantity: "100 Kg", message: "Need price",
  generated_date: "2026-09-27", generated_time: "21:00:13", ...over,
});

describe("Gmail sync → classification → leads", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("stores every message, creates leads from portal mail, and is idempotent", async () => {
    const { org } = await setupOrgWithUser();
    await connectGmail(org.id);
    const ids = ["indiamart-enquiry-by-phone", "tradeindia-inquiry", "indiamart-export-enquiry", "ignored-newsletter", "direct-inquiry-domestic", "own-sent-quotation"];
    const g = fakeGoogle({ messages: ids.map((i) => toGmailMessage(fixture(i))) });
    const ctx = systemCtx(org.id);

    const first = await syncGmail(ctx, { fetchImpl: g.fetch });
    expect(first).toMatchObject({ fetched: 6, errors: 0 });
    const emails = await getDb().select().from(emailMessages);
    expect(emails).toHaveLength(6);
    const byId = Object.fromEntries(emails.map((e) => [e.gmailMessageId, e.classification]));
    expect(byId).toMatchObject({
      "indiamart-enquiry-by-phone": "inquiry", "tradeindia-inquiry": "inquiry", "indiamart-export-enquiry": "international",
      "ignored-newsletter": "ignored", "direct-inquiry-domestic": "needs_review", "own-sent-quotation": "ignored",
    });
    const ls = await getDb().select().from(leads);
    expect(ls).toHaveLength(3);
    expect(ls.find((l) => l.source === "tradeindia")!.sourceRef).toBe("900000001");
    expect(ls.find((l) => l.isInternational)!.country).toBe("Lebanon");

    // Next run: history has the same ids again → nothing new.
    g.historyAdds = ids;
    const second = await syncGmail(ctx, { fetchImpl: g.fetch });
    expect(second).toMatchObject({ duplicates: 6, created: 0 });
    expect(await getDb().select().from(emailMessages)).toHaveLength(6);

    const rec = await getReconciliation(ctx, { since: "2026-09-01T00:00:00Z" });
    expect(rec.received).toBe(5); // own sent mail excluded
    expect(rec.pendingReview).toBe(1);
  });

  it("falls back to a date resync when the history id has expired", async () => {
    const { org } = await setupOrgWithUser();
    await connectGmail(org.id);
    const g = fakeGoogle({ messages: [toGmailMessage(fixture("tradeindia-whatsapp-inquiry"))] });
    await withSystemTx(async (tx) => {
      const integ = await getIntegrationInternal(tx, org.id, "gmail");
      await updateIntegrationInternal(tx, systemCtx(org.id), integ.id, { cursor: { historyId: "1" }, lastSuccessAt: new Date() });
    });
    g.historyExpired = true;
    const r = await syncGmail(systemCtx(org.id), { fetchImpl: g.fetch });
    expect(r.fetched).toBe(1);
    const [run] = await getDb().select().from(syncRuns).where(eq(syncRuns.provider, "gmail"));
    expect(run!.meta).toMatchObject({ resync: true });
  });

  it("flags revoked Gmail access as reauth_required", async () => {
    const { org } = await setupOrgWithUser();
    await connectGmail(org.id);
    const g = fakeGoogle();
    g.revoked = true;
    const r = await syncGmail(systemCtx(org.id), { fetchImpl: g.fetch });
    expect(r.errors).toBe(1);
    const [i] = await getDb().select().from(integrations).where(eq(integrations.provider, "gmail"));
    expect(i!.status).toBe("reauth_required");
  });

  it("Claude (MCP) classifies review mail; low confidence stays in review", async () => {
    const { org } = await setupOrgWithUser();
    await connectGmail(org.id);
    const g = fakeGoogle({ messages: [toGmailMessage(fixture("direct-inquiry-domestic")), toGmailMessage(fixture("vendor-pitch"))] });
    await syncGmail(systemCtx(org.id), { fetchImpl: g.fetch });
    const mcp = mcpCtx(org.id, "claude-ai");
    const q = await listEmailsNeedingReview(mcp, {});
    expect(q.total).toBe(2);
    const direct = q.items.find((i) => i.subject?.includes("Rice fiber"))!;
    const vendor = q.items.find((i) => i.subject?.includes("HDPE"))!;

    const low = await submitEmailClassification(mcp, { emailId: vendor.id, classification: "ignored", confidence: "low", reason: "Looks like a supplier pitch" });
    expect(low.status).toBe("kept_for_review");

    const ok = await submitEmailClassification(mcp, {
      emailId: direct.id, classification: "inquiry", confidence: "high", reason: "Buyer asks for price of rice fiber",
      lead: { contactName: "Priya Sharma", companyName: "Leafy Greens Organic Pvt. Ltd.", phone: "+91 9000001111", productText: "Rice fiber powder", quantityText: "700kg" },
    });
    expect(ok.leadCreated).toBe(true);
    const [lead] = await getDb().select().from(leads);
    expect(lead).toMatchObject({ source: "gmail", channel: "direct_email", phone: "+919000001111", email: "priya.sourcing@example.com", createdBy: "mcp:claude-ai" });
    expect((await listEmailsNeedingReview(mcp, {})).total).toBe(1);
  });
});

describe("TradeIndia sync", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  function fakeTi(pages: unknown[][], opts: { status?: number } = {}) {
    let call = 0;
    const urls: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      if (opts.status) return new Response(JSON.stringify({ message: "limit" }), { status: opts.status });
      const body = pages[call++] ?? [];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    return { f, urls };
  }

  async function configure(orgId: string) {
    await withSystemTx(async (tx) => {
      const integ = await getIntegrationInternal(tx, orgId, "tradeindia");
      await writeSecretsInternal(tx, systemCtx(orgId), integ, { userId: "u1", profileId: "p1", key: "key-12345678" });
      await updateIntegrationInternal(tx, systemCtx(orgId), integ.id, { status: "connected" });
    });
  }

  it("backfills 30 days in 7-day windows, dedupes by rfi_id and merges with the notification email", async () => {
    const { org } = await setupOrgWithUser();
    await configure(org.id);
    await connectGmail(org.id);
    // The notification email for inquiry 900000001 arrived first via Gmail.
    await syncGmail(systemCtx(org.id), { fetchImpl: fakeGoogle({ messages: [toGmailMessage(fixture("tradeindia-inquiry"))] }).fetch });
    const { f, urls } = fakeTi([[tiApiRow(), tiApiRow({ rfi_id: "900000002", sender_mobile: "+919000000808", product_name: "Pea Protein" })]]);
    const r = await syncTradeIndia(systemCtx(org.id), { fetchImpl: f, delayMs: 0, now: new Date("2026-09-29T00:00:00Z") });
    expect(r).toMatchObject({ fetched: 2, created: 1, duplicates: 1, errors: 0 });
    expect(urls.length).toBeGreaterThanOrEqual(5); // 30 days / 7-day windows
    expect(urls[0]).toContain("from_date=2026-08-30");
    const ls = await getDb().select().from(leads);
    expect(ls).toHaveLength(2);
    const merged = ls.find((l) => l.sourceRef === "900000001")!;
    expect(merged.email).toBe("vikram@example.com"); // filled in from the API copy
    expect(merged.alternateRefs[0]).toMatchObject({ source: "tradeindia_api", method: "source_ref" });

    // Incremental run re-reads the overlap window; nothing new.
    const again = await syncTradeIndia(systemCtx(org.id), { fetchImpl: fakeTi([[tiApiRow()]]).f, delayMs: 0, now: new Date("2026-09-29T00:10:00Z") });
    expect(again).toMatchObject({ created: 0, duplicates: 1 });
  });

  it("backs off on rate limits and records the error", async () => {
    const { org } = await setupOrgWithUser();
    await configure(org.id);
    const r = await syncTradeIndia(systemCtx(org.id), { fetchImpl: fakeTi([], { status: 429 }).f, delayMs: 0 });
    expect(r.errors).toBe(1);
    const [i] = await getDb().select().from(integrations).where(eq(integrations.provider, "tradeindia"));
    expect(i!.backoffUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(i!.lastError).toMatch(/rate limit/i);
    const skipped = await syncTradeIndia(systemCtx(org.id), { fetchImpl: fakeTi([]).f, delayMs: 0 });
    expect(skipped.skipped).toMatch(/backing off/);
  });
});

describe("Quote drafts", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("renders current rates, snapshots them, fetches the signature and drafts in the inquiry thread (never sends)", async () => {
    const { org, ctx } = await setupOrgWithUser("owner");
    await catalogWithRates(ctx);
    await connectGmail(org.id);
    const g = fakeGoogle({ messages: [toGmailMessage(fixture("tradeindia-whatsapp-inquiry"), { messageId: "<orig-123@mail.example>" })] });
    await syncGmail(systemCtx(org.id), { fetchImpl: g.fetch });
    // Lead is for "Soya Protein Isolate Powder" (no product in catalog) → cannot quote.
    const [soya] = await getDb().select().from(leads);
    await expect(createQuoteDraft(ctx, { leadId: soya!.id }, { fetchImpl: g.fetch })).rejects.toThrow(/Pick the product/);

    // A chickpea lead from the email fixture
    const g2 = fakeGoogle({ messages: [toGmailMessage(fixture("tradeindia-inquiry"), { messageId: "<orig-456@mail.example>" })] });
    g2.historyAdds = ["tradeindia-inquiry"];
    await syncGmail(systemCtx(org.id), { fetchImpl: g2.fetch });
    const chick = (await getDb().select().from(leads)).find((l) => l.sourceRef === "900000001")!;
    expect(chick.productId).not.toBeNull();

    const res = await createQuoteDraft(ctx, { leadId: chick.id }, { fetchImpl: g2.fetch });
    expect(res.quotation.status).toBe("draft_created");
    expect(res.draftUrl).toContain("mail.google.com");
    expect(res.quotation.items[0]).toMatchObject({ productName: "Chickpea Protein Isolate", pricePerKgInr: "485.00", gstPercent: "18.00", moqKg: "100.00" });
    expect(res.quotation.bodyText).toContain("Price: Rs. 485.00/kg (Ex-factory)");
    expect(res.quotation.bodyText).toContain("GST: 18% extra");
    expect(res.quotation.bodyText).toMatch(/valid until \d{1,2} [A-Z][a-z]{2} 20\d\d/);
    expect(res.quotation.bodyText).not.toMatch(/regards/i); // sign-off comes from Gmail, not the template

    const draft = g2.drafts[0]!;
    expect(draft.threadId).toBe("t-tradeindia-inquiry");
    expect(draft.raw).toContain("In-Reply-To: <orig-456@mail.example>");
    expect(draft.raw).toMatch(/Subject: (=\?UTF-8\?B\?.+\?=|Re: CHICKPEA)/);
    const decoded = Buffer.from(draft.raw.split("\r\n\r\n").slice(-1)[0] ?? "", "base64").toString("utf8");
    expect(draft.raw + decoded).toBeTruthy();
    expect(g2.calls.some((c) => /\/(messages|drafts)\/send/.test(c.url))).toBe(false);

    const [lead] = await getDb().select().from(leads).where(eq(leads.id, chick.id));
    expect(lead!.status).toBe("quoted");
    expect(await getDb().select().from(quotations)).toHaveLength(1);
  });

  it("MCP can create quote drafts; international leads are blocked", async () => {
    const { org, ctx } = await setupOrgWithUser("owner");
    await catalogWithRates(ctx);
    const g = fakeGoogle({ messages: [toGmailMessage(fixture("indiamart-export-enquiry"))] });
    await connectGmail(org.id);
    await syncGmail(systemCtx(org.id), { fetchImpl: g.fetch });
    const [intl] = await getDb().select().from(leads);
    await expect(createQuoteDraft(mcpCtx(org.id), { leadId: intl!.id }, { fetchImpl: g.fetch })).rejects.toThrow(/international/);
  });

  it("saves the quotation even when Gmail is not connected", async () => {
    const { org, ctx } = await setupOrgWithUser("owner");
    await catalogWithRates(ctx);
    const [l] = await getDb().insert(leads).values({ orgId: org.id, source: "manual", sourceRef: "m1", productText: "Chickpea", createdBy: "system:test", contactName: "Asha", phone: "+919000000001" }).returning();
    const { getDb: _g } = await import("@/db/client");
    const rates = await (await import("@/modules/catalog/service")).getCurrentRates(ctx, {});
    await getDb().update(leads).set({ productId: rates[0]!.productId }).where(eq(leads.id, l!.id));
    const res = await createQuoteDraft(ctx, { leadId: l!.id });
    expect(res.quotation.status).toBe("draft_failed");
    expect(res.warning).toMatch(/Gmail is not connected/);
    const wa = await whatsappForLead(ctx, { leadId: l!.id });
    expect(wa.url).toMatch(/^https:\/\/wa\.me\/919000000001\?text=Hello%20Asha/);
    expect(wa.text).toContain("Rs. 485.00/kg");
  });
});
