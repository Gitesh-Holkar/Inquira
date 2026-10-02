/**
 * Every service called the way the web app calls it: as a signed-in person, under RLS (role
 * `authenticated`). Most other tests use system/MCP contexts, which bypass RLS; these catch
 * services that work in tests but fail for real users.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { auditLogs, integrations, jobs } from "@/modules/core/schema";
import { emailMessages } from "@/modules/email/schema";
import { getIntegrationInternal, getOrgSettings, listAudit, listIntegrations, listSyncRuns, readSecretsInternal, updateIntegrationInternal, writeSecretsInternal } from "@/modules/core/service";
import { disconnectGmail, saveGmailClient, startGmailConnect, syncGmail } from "@/modules/sources/gmail/service";
import { saveTradeIndiaCredentials } from "@/modules/sources/tradeindia/service";
import { tick } from "@/modules/sources/jobs";
import { getDashboard } from "@/modules/dashboard/service";
import { addLeadNote, createManualLead, listLeads, updateLead, updateLeadStatus } from "@/modules/leads/service";
import { createProduct, getCurrentRates, listProducts } from "@/modules/catalog/service";
import { listTemplates } from "@/modules/templates/service";
import { getBuyleadRules, getBuyleadSummary, listBuyleadDecisions, logBuyleadDecision, updateBuyleadRules } from "@/modules/buyleads/service";
import { createClassificationRule, getReconciliation, ingestMessageInternal, listClassificationRules, listEmailsNeedingReview, submitEmailClassification } from "@/modules/email/service";
import { listMcpTokens } from "@/modules/mcp/service";
import { buildMime, formatAddress } from "@/modules/quotes/mime";
import { fakeGoogle, fixture, toGmailMessage } from "./helpers/fake-google";
import { addMember, createUser, resetDb, setupOrgWithUser, systemCtx } from "./helpers/db";
import type { Ctx, Role } from "@/modules/core/types";

const human = (orgId: string, user: { id: string; email: string }, role: Role): Ctx => ({ orgId, actor: { kind: "human", userId: user.id, email: user.email, role } });

describe("signed-in users (RLS) can use every screen", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("an owner can save Gmail + TradeIndia credentials, start Connect Gmail and disconnect", async () => {
    const { org, ctx } = await setupOrgWithUser("owner");
    const g = await saveGmailClient(ctx, { clientId: "1234-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-secret-123" });
    expect(g.redirectUri).toBe("http://localhost:3000/api/integrations/gmail/callback");
    const { url } = await startGmailConnect(ctx, {});
    const u = new URL(url);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toContain("gmail.compose");
    expect(u.searchParams.get("state")).toMatch(new RegExp(`^${org.id}\\.`));

    await saveTradeIndiaCredentials(ctx, { userId: "u1", profileId: "p1", key: "key-12345678" });
    const secrets = await withSystemTx(async (tx) => readSecretsInternal<Record<string, string>>(tx, (await getIntegrationInternal(tx, org.id, "tradeindia")).id));
    expect(secrets).toMatchObject({ userId: "u1", profileId: "p1", key: "key-12345678" });

    await disconnectGmail(ctx, {});
    const [gm] = await getDb().select().from(integrations).where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "gmail")));
    expect(gm!.status).toBe("configured");

    // Audit rows name the person, never the secret values.
    const audits = await getDb().select().from(auditLogs).where(eq(auditLogs.orgId, org.id));
    const secretAudit = audits.find((a) => a.action === "integration.secrets_update");
    expect(secretAudit?.actor).toBe(`human:${(ctx.actor as { userId: string }).userId}`);
    expect(JSON.stringify(audits)).not.toContain("GOCSPX-secret-123");
    expect(JSON.stringify(audits)).not.toContain("key-12345678");
  });

  it("sales and viewers cannot manage integrations", async () => {
    const { org } = await setupOrgWithUser("owner");
    for (const role of ["sales", "viewer"] as const) {
      const u = await createUser();
      await addMember(org.id, u, role);
      await expect(saveGmailClient(human(org.id, u, role), { clientId: "1-a.apps.googleusercontent.com", clientSecret: "secret-123456" })).rejects.toThrow(/Not allowed/);
      await expect(saveTradeIndiaCredentials(human(org.id, u, role), { userId: "u", profileId: "p", key: "key-12345678" })).rejects.toThrow(/Not allowed/);
    }
  });

  it("every read screen loads for owner, sales and viewer", async () => {
    const { org, ctx: owner } = await setupOrgWithUser("owner");
    // What the seed creates, so the read paths never need to insert.
    await withSystemTx(async (tx) => {
      await getIntegrationInternal(tx, org.id, "gmail");
      await getIntegrationInternal(tx, org.id, "tradeindia");
    });
    await getBuyleadRules(owner, {});
    for (const role of ["owner", "sales", "viewer"] as const) {
      const u = await createUser();
      await addMember(org.id, u, role);
      const ctx = human(org.id, u, role);
      await expect(Promise.all([
        listIntegrations(ctx, {}), getReconciliation(ctx, {}), getDashboard(ctx, {}), listLeads(ctx, {}), listProducts(ctx, {}),
        getCurrentRates(ctx, {}), listTemplates(ctx, {}), getBuyleadRules(ctx, {}), getBuyleadSummary(ctx, {}), listBuyleadDecisions(ctx, {}),
        listClassificationRules(ctx, {}), listEmailsNeedingReview(ctx, {}), listSyncRuns(ctx, {}), getOrgSettings(ctx, {}), listAudit(ctx, {}),
      ])).resolves.toBeTruthy();
    }
    await expect(listMcpTokens(owner, {})).resolves.toEqual([]);
  });

  it("sales can work leads and the review queue; viewers cannot write", async () => {
    const { org } = await setupOrgWithUser("owner");
    const s = await createUser();
    await addMember(org.id, s, "sales");
    const sales = human(org.id, s, "sales");
    const { leadId } = await createManualLead(sales, { contactName: "Asha", phone: "98765 43210", productText: "Pea protein" });
    await addLeadNote(sales, { leadId, body: "Called" });
    await updateLeadStatus(sales, { leadId, status: "contacted" });

    await withSystemTx((tx) => ingestMessageInternal(tx, systemCtx(org.id), {
      gmailMessageId: "m-review", gmailThreadId: "t-review", fromEmail: "buyer@foods.example", fromName: "Buyer", toEmails: ["sales@seller.example"], ccEmails: [],
      subject: "Requirement", snippet: null, text: "Please quote 500 kg of pea protein isolate.", html: null, labelIds: ["INBOX"], headers: {}, receivedAt: new Date(),
    }, { ownAddresses: ["sales@seller.example"] }));
    const [email] = await getDb().select().from(emailMessages);
    expect(email!.classification).toBe("needs_review");
    const r = await submitEmailClassification(sales, { emailId: email!.id, classification: "inquiry", confidence: "high", reason: "Reviewed" });
    expect(r.leadId).toBeTruthy();

    const v = await createUser();
    await addMember(org.id, v, "viewer");
    await expect(addLeadNote(human(org.id, v, "viewer"), { leadId, body: "x" })).rejects.toThrow(/Not allowed/);
  });
});

describe("lead fixes", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("rejects an invalid phone on a manual lead instead of silently dropping it", async () => {
    const { ctx } = await setupOrgWithUser("sales");
    await expect(createManualLead(ctx, { contactName: "Asha", phone: "12" })).rejects.toThrow(/phone number/);
  });

  it("finds a +91 lead when searching the number with spaces or a leading 0", async () => {
    const { ctx } = await setupOrgWithUser("sales");
    await createManualLead(ctx, { contactName: "Asha", phone: "+91 98765 43210" });
    for (const q of ["98765 43210", "098765-43210", "+91 98765 43210"]) expect((await listLeads(ctx, { q })).total).toBe(1);
  });

  it("can't link a lead to another organisation's product", async () => {
    const a = await setupOrgWithUser("admin");
    const b = await setupOrgWithUser("admin");
    const { product } = await createProduct(b.ctx, { name: "Other Org Product" });
    const { leadId } = await createManualLead(a.ctx, { contactName: "Asha" });
    await expect(updateLead(a.ctx, { leadId, fields: { productId: product.id } })).rejects.toThrow(/Product not found/);
  });
});

describe("rules, buy leads and audit", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("audits emails cleared from the review queue by a new ignore rule", async () => {
    const { org, ctx } = await setupOrgWithUser("admin");
    await withSystemTx((tx) => ingestMessageInternal(tx, systemCtx(org.id), {
      gmailMessageId: "m1", gmailThreadId: "t1", fromEmail: "ads@vendor.example", fromName: null, toEmails: [], ccEmails: [],
      subject: "Packaging offer", snippet: null, text: "We supply pouches for protein powder.", html: null, labelIds: ["INBOX"], headers: {}, receivedAt: new Date(),
    }, { ownAddresses: [] }));
    const r = await createClassificationRule(ctx, { name: "Vendor", matchType: "sender_domain", pattern: "vendor.example", action: "ignore", applyToReviewQueue: true });
    expect(r.applied).toBe(1);
    const rows = await getDb().select().from(auditLogs).where(eq(auditLogs.action, "rule.apply_to_review_queue"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toMatchObject({ ignored: 1 });
  });

  it("counts the daily cap with would_contact in test mode and flags a click in test mode", async () => {
    const { ctx } = await setupOrgWithUser("admin");
    await updateBuyleadRules(ctx, { productTerms: [], excludedTerms: [], allowedCountries: ["India"], allowedStates: [], excludedStates: [], minQuantityKg: null, maxQuantityKg: null, dailyCap: 1, testMode: true });
    const first = await logBuyleadDecision(ctx, { lead_title: "Pea protein 1 ton", decision: "would_contact", reason: "match" });
    expect(first).toMatchObject({ remaining_today: 0, over_cap: false });
    const second = await logBuyleadDecision(ctx, { lead_title: "Pea protein 2 ton", decision: "would_contact", reason: "match" });
    expect(second.over_cap).toBe(true);
    await logBuyleadDecision(ctx, { lead_title: "Clicked anyway", decision: "contacted", reason: "match" });
    const decisions = await listBuyleadDecisions(ctx, {});
    expect(decisions.find((d) => d.leadTitle === "Clicked anyway")!.meta).toMatchObject({ clicked_in_test_mode: true });
  });
});

describe("Gmail sync robustness", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  async function connected(orgId: string) {
    await withSystemTx(async (tx) => {
      const integ = await getIntegrationInternal(tx, orgId, "gmail");
      await writeSecretsInternal(tx, systemCtx(orgId), integ, { clientId: "x.apps.googleusercontent.com", clientSecret: "secret-123456", refreshToken: "rt" });
      await updateIntegrationInternal(tx, systemCtx(orgId), integ.id, { status: "connected", accountEmail: "sales@seller.example", config: { ownAddresses: ["sales@seller.example"] } });
    });
  }

  it("doesn't download messages it already stored", async () => {
    const { org } = await setupOrgWithUser();
    await connected(org.id);
    const g = fakeGoogle({ messages: [toGmailMessage(fixture("tradeindia-inquiry")), toGmailMessage(fixture("ignored-newsletter"))] });
    await syncGmail(systemCtx(org.id), { fetchImpl: g.fetch });
    // Force a date-based resync (as after an expired history id): same two messages are listed again.
    await withSystemTx(async (tx) => updateIntegrationInternal(tx, systemCtx(org.id), (await getIntegrationInternal(tx, org.id, "gmail")).id, { cursor: {} }));
    const before = g.calls.length;
    const second = await syncGmail(systemCtx(org.id), { fetchImpl: g.fetch });
    expect(second).toMatchObject({ fetched: 0, duplicates: 2, errors: 0 });
    expect(g.calls.slice(before).filter((c) => /\/messages\/[^?]+\?format=full/.test(c.url))).toHaveLength(0);
  });

  it("drops a message deleted in Gmail instead of retrying it forever", async () => {
    const { org } = await setupOrgWithUser();
    await connected(org.id);
    const g = fakeGoogle({ messages: [toGmailMessage(fixture("tradeindia-inquiry"))] });
    const listing = g.fetch;
    // Listed, but gone by the time it is fetched.
    g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages?")) return new Response(JSON.stringify({ messages: [{ id: "gone-1", threadId: "t" }, { id: "tradeindia-inquiry", threadId: "t2" }] }), { status: 200 });
      return listing(input, init);
    }) as typeof fetch;
    const r = await syncGmail(systemCtx(org.id), { fetchImpl: g.fetch });
    expect(r).toMatchObject({ fetched: 1, errors: 0 });
    const [integ] = await getDb().select().from(integrations).where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "gmail")));
    expect((integ!.cursor as { backlog?: string[] }).backlog).toEqual([]);
  });

  it("stops at the time budget and keeps the rest for the next run", async () => {
    const { org } = await setupOrgWithUser();
    await connected(org.id);
    const ids = ["tradeindia-inquiry", "ignored-newsletter", "indiamart-enquiry-by-phone"];
    const g = fakeGoogle({ messages: ids.map((i) => toGmailMessage(fixture(i))) });
    const r = await syncGmail(systemCtx(org.id), { fetchImpl: g.fetch, timeBudgetMs: -1 });
    expect(r.fetched).toBe(0);
    const [integ] = await getDb().select().from(integrations).where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "gmail")));
    expect(new Set((integ!.cursor as { backlog?: string[] }).backlog)).toEqual(new Set(ids));
  });

  it("cron tick leaves jobs queued (not locked) when its start budget is used up", async () => {
    const { org } = await setupOrgWithUser();
    const r = await tick({ startBudgetMs: -1 });
    expect(r.processed).toBe(0);
    const rows = await getDb().select().from(jobs).where(eq(jobs.orgId, org.id));
    expect(rows.map((j) => j.status).sort()).toEqual(["queued", "queued"]);
  });
});

describe("quote email headers", () => {
  it("quotes or encodes the sender name and strips line breaks from header values", () => {
    expect(formatAddress("sales@seller.example", "Seller Foods, Pune")).toBe(`"Seller Foods, Pune" <sales@seller.example>`);
    expect(formatAddress("sales@seller.example", "सेलर फूड्स")).toMatch(/^=\?UTF-8\?B\?.+\?= <sales@seller.example>$/);
    const mime = buildMime({ from: null, to: "buyer@example.com", subject: "Re: Hi\r\nBcc: evil@example.com", text: "x", html: "x", inReplyTo: "<a@b>\r\nBcc: evil@example.com" });
    const head = mime.split("\r\n\r\n")[0]!;
    expect(head.split("\r\n").some((l) => /^Bcc:/i.test(l))).toBe(false);
  });
});
