/**
 * The outbound pipeline (GOAL G-OUT-*, G-TPL-*, G-CNV-2, G-CNV-3, G-FUP-1; ADR-032) against fake Gmail and AI.
 * People act as signed-in roles under RLS; the jobs run as system. All data invented.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { auditLogs, notifications } from "@/modules/core/schema";
import { getIntegrationInternal, updateIntegrationInternal, updateOrgSettings, writeSecretsInternal } from "@/modules/core/service";
import { createProduct, updateProduct, updateRates } from "@/modules/catalog/service";
import { leads } from "@/modules/leads/schema";
import { upsertLeadInternal } from "@/modules/leads/service";
import { emailMessages } from "@/modules/email/schema";
import { ingestMessageInternal } from "@/modules/email/service";
import { outgoingMessages } from "@/modules/outbound/schema";
import {
  approveAndSendInternal, createOutboundRule, editMessage, listOutbox, prepareMessage, rejectMessage, runOutboundPlan, runOutboundSend, saveOutboundSettings,
} from "@/modules/outbound/service";
import { readOutboundSettings } from "@/modules/outbound/types";
import { saveTemplate, listTemplates } from "@/modules/templates/service";
import { saveAiTier } from "@/modules/ai/service";
import { uploadDocument } from "@/modules/documents/service";
import { createQuoteDraft } from "@/modules/quotes/service";
import type { Ctx } from "@/modules/core/types";
import { addMember, createUser, resetDb, setupOrgWithUser, systemCtx } from "./helpers/db";
import { fakeGoogle } from "./helpers/fake-google";
import { fakeAi } from "./helpers/fake-ai";

const MONDAY_10 = new Date("2026-11-23T10:00:00+05:30");
let ctx: Ctx;
let sys: Ctx;
let orgId: string;
let productId: string;
let n = 0;

async function connectGmail() {
  await withSystemTx(async (tx) => {
    const integ = await getIntegrationInternal(tx, orgId, "gmail");
    await writeSecretsInternal(tx, sys, integ, { clientId: "x.apps.googleusercontent.com", clientSecret: "secret-123456", refreshToken: "rt" });
    await updateIntegrationInternal(tx, sys, integ.id, { status: "connected", accountEmail: "sales@seller.example", config: { ownAddresses: ["sales@seller.example"] } });
  });
}

beforeEach(async () => {
  await resetDb();
  const s = await setupOrgWithUser("owner");
  ctx = s.ctx;
  orgId = s.org.id;
  sys = systemCtx(orgId);
  const { product, grades } = await createProduct(ctx, { name: "Sample Protein Isolate", grades: ["Standard"] });
  productId = product.id;
  await updateRates(ctx, { items: [{ gradeId: grades[0]!.id, pricePerKgInr: "300", gstPercent: "18", priceBasis: "Ex-factory", moqKg: "100", packSize: "20 Kg" }] });
  await updateOrgSettings(ctx, { paymentTerms: "100% advance" });
  await connectGmail();
});
afterAll(closeDb);

/** A portal enquiry that rules settle completely (product, intent, quantity). */
async function lead(over: Record<string, unknown> = {}) {
  n++;
  const r = await withSystemTx((tx) => upsertLeadInternal(tx, sys, {
    source: "indiamart", sourceRef: `IM-${n}`, channel: "indiamart_api_w", receivedAt: new Date(), contactName: "Test Buyer", companyName: "Test Co",
    email: `buyer${n}@example.com`, phone: `+9190000${String(n).padStart(5, "0")}`, productText: "Sample Protein Isolate", quantityText: "500 kg",
    message: "Kindly send your best price", ...over,
  }));
  return r.leadId;
}
const messages = async (leadId?: string) => getDb().select().from(outgoingMessages).where(leadId ? eq(outgoingMessages.leadId, leadId) : undefined);
const setMode = async (email: "shadow" | "assisted" | "automatic", over: Record<string, unknown> = {}) =>
  saveOutboundSettings(ctx, { ...readOutboundSettings(null), modes: { email }, ...over });

describe("only the pipeline sends (AGENTS rule 4)", () => {
  it("no file but src/modules/outbound/send.ts calls Gmail's send", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
    walk(path.join(process.cwd(), "src"));
    const callers = files.filter((f) => /\.sendMessage\(|messages\/send/.test(readFileSync(f, "utf8"))).map((f) => path.relative(process.cwd(), f)).sort();
    expect(callers).toEqual(["src/modules/outbound/send.ts", "src/modules/sources/gmail/client.ts"]);
  });
});

describe("shadow mode (the default)", () => {
  it("prepares the first quotation by email and WhatsApp as drafts for a person, and sends nothing", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    const m = await messages(id);
    expect(m.map((x) => [x.channel, x.purpose, x.state, x.mode]).sort()).toEqual([["email", "first_quotation", "draft", "shadow"], ["whatsapp", "first_quotation", "draft", "shadow"]]);
    const email = m.find((x) => x.channel === "email")!;
    expect(email.body).toContain("Price: Rs. 300.00/kg (Ex-factory)");
    expect(email.body).toContain("- Payment: 100% advance");
    expect(email.templateVersion).toBe(1);
    expect(email.priceEntryIds).toHaveLength(1);
    const g = fakeGoogle(); // no allowSend: any send throws
    expect(await runOutboundSend(sys, { fetchImpl: g.fetch, now: MONDAY_10 })).toMatchObject({ sent: 0 });
    // Planned once only.
    await runOutboundPlan(sys);
    expect(await messages(id)).toHaveLength(2);
  });

  it("a person approves an email: it is sent at once with the Gmail signature, recorded and audited (G-OUT-10)", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    const email = (await messages(id)).find((x) => x.channel === "email")!;
    const g = fakeGoogle({ allowSend: true });
    const r = await approveAndSendInternal(ctx, { id: email.id }, { fetchImpl: g.fetch });
    expect(r.message).toMatchObject({ state: "sent", sentBy: `human:${(ctx.actor as { userId: string }).userId}` });
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0]!.raw).toContain("To: buyer");
    expect(g.sent[0]!.raw).toMatch(/Seller Foods/); // the mailbox's own signature
    const [lr] = await getDb().select().from(leads).where(eq(leads.id, id));
    expect(lr!.status).toBe("quoted");
    const [a] = await getDb().select().from(auditLogs).where(and(eq(auditLogs.entityId, email.id), eq(auditLogs.action, "outbound.sent")));
    expect(a!.changes).toMatchObject({ ruleSet: expect.stringMatching(/^hold-rules-/), template: { version: 1 }, priceEntryIds: email.priceEntryIds });
  });

  it("WhatsApp: approving gives the tap-to-send link and records the person's send", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    const wa = (await messages(id)).find((x) => x.channel === "whatsapp")!;
    const r = await approveAndSendInternal(ctx, { id: wa.id }, { fetchImpl: fakeGoogle().fetch });
    expect(r.whatsappUrl).toMatch(/^https:\/\/wa\.me\/91900000\d+\?text=/);
    expect(r.message.state).toBe("sent");
  });
});

describe("assisted mode (G-OUT-3, G-OUT-4)", () => {
  it("only an owner changes the mode, and the change is audited", async () => {
    const admin = await createUser();
    await addMember(orgId, admin, "admin");
    const adminCtx: Ctx = { orgId, actor: { kind: "human", userId: admin.id, email: admin.email, role: "admin" } };
    await expect(saveOutboundSettings(adminCtx, { ...readOutboundSettings(null), modes: { email: "assisted" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await saveOutboundSettings(adminCtx, { ...readOutboundSettings(null), paused: true }); // the pause switch is not owner-only
    await setMode("assisted");
    const [a] = await getDb().select().from(auditLogs).where(eq(auditLogs.action, "outbound.mode"));
    expect(a!.changes).toEqual({ email: ["shadow", "assisted"] });
  });

  it("sends a clean first quotation automatically inside the window; waits outside it, when paused, and holds at the cap", async () => {
    await setMode("assisted", { caps: { perHour: 1, perDay: 10 } });
    const a = await lead();
    const b = await lead();
    await runOutboundPlan(sys);
    const auto = (await messages()).filter((x) => x.channel === "email");
    expect(auto.every((x) => x.state === "approved" && x.autoApproved)).toBe(true);
    expect((await messages(a)).find((x) => x.channel === "whatsapp")!.state).toBe("draft"); // WhatsApp: always a person's tap

    const g = fakeGoogle({ allowSend: true });
    expect(await runOutboundSend(sys, { fetchImpl: g.fetch, now: new Date("2026-11-22T10:00:00+05:30") })).toMatchObject({ skipped: "Outside the send window" });
    await setMode("assisted", { caps: { perHour: 1, perDay: 10 }, paused: true });
    expect(await runOutboundSend(sys, { fetchImpl: g.fetch, now: MONDAY_10 })).toMatchObject({ skipped: "Paused" });
    await setMode("assisted", { caps: { perHour: 1, perDay: 10 } });
    await runOutboundSend(sys, { fetchImpl: g.fetch, now: MONDAY_10 });
    expect(g.sent).toHaveLength(1);
    const after = (await messages()).filter((x) => x.channel === "email");
    expect(after.map((x) => x.state).sort()).toEqual(["held", "sent"]);
    expect(after.find((x) => x.state === "held")!.holdReasons.map((r) => r.rule)).toEqual(["send_limit"]);
    expect([a, b]).toContain(after.find((x) => x.state === "sent")!.leadId);
  });

  it("checks the rules again just before sending: a buyer reply holds the quotation", async () => {
    await setMode("assisted");
    const id = await lead();
    await runOutboundPlan(sys);
    const [l] = await getDb().select().from(leads).where(eq(leads.id, id));
    await withSystemTx((tx) => ingestMessageInternal(tx, sys, {
      gmailMessageId: "reply-1", gmailThreadId: "t-reply", fromEmail: l!.email, fromName: "Test Buyer", toEmails: ["sales@seller.example"], ccEmails: [],
      subject: "Re: enquiry", snippet: "x", text: "Can you also tell me the delivery charges?", html: null, labelIds: ["INBOX"], headers: {}, receivedAt: new Date(),
    }, { ownAddresses: ["sales@seller.example"] }));
    await withSystemTx((tx) => tx.update(emailMessages).set({ classification: "conversation", leadId: id }).where(eq(emailMessages.gmailMessageId, "reply-1")));
    const g = fakeGoogle({ allowSend: true });
    await runOutboundSend(sys, { fetchImpl: g.fetch, now: MONDAY_10 });
    expect(g.sent).toHaveLength(0);
    const email = (await messages(id)).find((x) => x.channel === "email")!;
    expect(email.state).toBe("held");
    expect(email.holdReasons.map((r) => r.rule)).toContain("in_conversation");
  });
});

describe("hold rules in the pipeline (G-OUT-2, G-OUT-9)", () => {
  it("a held message shows its reasons, tells the team once, and needs a confirmation to send", async () => {
    const id = await lead({ quantityText: "50 kg" }); // below the MOQ of 100 kg
    await runOutboundPlan(sys);
    const email = (await messages(id)).find((x) => x.channel === "email")!;
    expect(email).toMatchObject({ purpose: "below_moq", state: "held" });
    expect(email.holdReasons[0]!.detail).toMatch(/below the MOQ/);
    const notes = await getDb().select().from(notifications).where(eq(notifications.entityId, email.id));
    expect(notes).toHaveLength(1);
    await expect(approveAndSendInternal(ctx, { id: email.id }, { fetchImpl: fakeGoogle().fetch })).rejects.toMatchObject({ code: "VALIDATION" });
    const g = fakeGoogle({ allowSend: true });
    expect((await approveAndSendInternal(ctx, { id: email.id, confirmHeld: true }, { fetchImpl: g.fetch })).message.state).toBe("sent");
  });

  it("rejecting with a rule holds the next message for that buyer; editing marks it edited", async () => {
    const id = await lead({ email: "repeat@example.org" });
    await runOutboundPlan(sys);
    const email = (await messages(id)).find((x) => x.channel === "email")!;
    const edited = await editMessage(ctx, { id: email.id, body: `${email.body}\n\nP.S. edited` });
    expect(edited.edited).toBe(true);
    const r = await rejectMessage(ctx, { id: email.id, reason: "Agent, not a buyer", rule: { matchType: "buyer_domain", pattern: "example.org" } });
    expect(r.message.state).toBe("cancelled");
    const again = await prepareMessage(ctx, { leadId: id, purpose: "first_quotation", channel: "email" });
    expect(again.state).toBe("held");
    expect(again.holdReasons).toContainEqual({ rule: "team_rule", detail: "Team rule: Agent, not a buyer" });
    expect((await listOutbox(ctx, { view: "review" })).items.map((x) => x.id)).toContain(again.id);
  });

  it("a blank required term holds the quotation instead of printing a blank (G-KB-2)", async () => {
    await updateOrgSettings(ctx, { paymentTerms: "" });
    const id = await lead();
    await runOutboundPlan(sys);
    const email = (await messages(id)).find((x) => x.channel === "email")!;
    expect(email.state).toBe("held");
    expect(email.holdReasons).toContainEqual({ rule: "terms_blank", detail: "Empty: payment terms" });
    expect(email.body).not.toMatch(/Payment:\s*$/m);
  });

  it("hand-quoting through a Gmail draft cancels the pipeline's pending quotation", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    await createQuoteDraft(ctx, { leadId: id }, { fetchImpl: fakeGoogle().fetch });
    expect((await messages(id)).filter((x) => x.purpose === "first_quotation").every((x) => x.state === "cancelled")).toBe(true);
  });
});

describe("documents, samples, follow-ups, AI replies, template versions", () => {
  it("a document request gets the latest valid COA attached; a missing document holds it (G-CNV-2)", async () => {
    const id = await lead({ message: "Please send COA and TDS" });
    await uploadDocument(ctx, { productId, type: "coa", title: "COA", expiryDate: "2030-01-01", file: { name: "coa.pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.4 coa")) } });
    await runOutboundPlan(sys);
    const email = (await messages(id)).find((x) => x.channel === "email")!;
    expect(email).toMatchObject({ purpose: "document_share", state: "held" });
    expect(email.documentIds).toHaveLength(1);
    expect(email.holdReasons).toContainEqual({ rule: "documents_missing", detail: "No valid TDS for this product" });
    expect(email.body).toContain("COA");
  });

  it("a sample request waits until the sample policy and the product's sample flag are set (G-KB-5)", async () => {
    const id = await lead({ message: "Can you send a sample first?" });
    await runOutboundPlan(sys);
    let email = (await messages(id)).find((x) => x.channel === "email")!;
    expect(email.holdReasons.map((r) => r.rule)).toEqual(["terms_blank", "sample_undecided", "sample_policy"]);
    await updateOrgSettings(ctx, { samplePolicy: { freeSampleSize: "250 g", requiredDetails: ["Company name", "Delivery address"], note: null } });
    await updateProduct(ctx, { productId, name: "Sample Protein Isolate", aliases: [], sampleAvailable: true });
    email = await prepareMessage(ctx, { leadId: id, purpose: "sample_request", channel: "email" });
    expect(email.state).toBe("draft");
    expect(email.body).toContain("free sample of 250 g");
    expect(email.body).toContain("- Delivery address");
  });

  it("prepares one follow-up after the set days without a reply (G-FUP-1)", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    const email = (await messages(id)).find((x) => x.channel === "email")!;
    await approveAndSendInternal(ctx, { id: email.id }, { fetchImpl: fakeGoogle({ allowSend: true }).fetch });
    await getDb().update(outgoingMessages).set({ sentAt: new Date(Date.now() - 4 * 86400_000) }).where(eq(outgoingMessages.id, email.id));
    await runOutboundPlan(sys);
    await runOutboundPlan(sys);
    const f = (await messages(id)).filter((x) => x.purpose === "follow_up");
    expect(f).toHaveLength(1);
    expect(f[0]!).toMatchObject({ channel: "email", replyToId: email.id, state: "draft" });
    expect(f[0]!.body).toMatch(/We sent you our quotation for Sample Protein Isolate on \d/);
  });

  it("a buyer's question in a conversation gets an AI draft that is always held (G-CNV-3)", async () => {
    await saveAiTier(ctx, { tier: "advanced", enabled: true, provider: "anthropic", model: "test-model", threshold: 0.8, dailyLimit: 10, apiKey: "fake-key-123456" });
    const ai = fakeAi(() => ({ body: "Dear Test Buyer, thank you. Our team will confirm the delivery charges to Pune shortly. Our price is Rs. 280/kg.", confidence: 0.9 }));
    const id = await lead();
    await withSystemTx((tx) => tx.update(leads).set({ outreachPlannedAt: new Date() }).where(eq(leads.id, id)));
    const [l] = await getDb().select().from(leads).where(eq(leads.id, id));
    await withSystemTx((tx) => ingestMessageInternal(tx, sys, {
      gmailMessageId: "conv-1", gmailThreadId: "t-conv", fromEmail: l!.email, fromName: "Test Buyer", toEmails: ["sales@seller.example"], ccEmails: [],
      subject: "Re: quotation", snippet: "x", text: "What are the delivery charges to Pune?", html: null, labelIds: ["INBOX"], headers: {}, receivedAt: new Date(),
    }, { ownAddresses: ["sales@seller.example"] }));
    await withSystemTx((tx) => tx.update(emailMessages).set({ classification: "conversation", leadId: id }).where(eq(emailMessages.gmailMessageId, "conv-1")));
    await runOutboundPlan(sys, { fetchImpl: ai.f });
    const reply = (await messages(id)).find((x) => x.purpose === "reply")!;
    expect(reply).toMatchObject({ state: "held", gmailThreadId: "t-conv", inReplyToMessageId: "conv-1" });
    expect(reply.holdReasons.map((r) => r.rule)).toEqual(expect.arrayContaining(["ai_written", "price_in_text"]));
    expect(ai.calls[0]!.raw).toContain("UNTRUSTED MESSAGE");
  });

  it("records the template version a message was built from (G-TPL-3)", async () => {
    await runOutboundPlan(sys); // creates the starting templates
    const t = (await listTemplates(ctx, { kind: "quote_email" })).find((x) => x.purpose === "first_quotation")!;
    await saveTemplate(ctx, { id: t.id, kind: "quote_email", purpose: "first_quotation", name: t.name, subject: t.subject, body: `${t.body}\n\nWe look forward to your order.`, isDefault: true });
    const id = await lead();
    await runOutboundPlan(sys);
    const email = (await messages(id)).find((x) => x.channel === "email")!;
    expect(email).toMatchObject({ templateId: t.id, templateVersion: 2 });
    expect(email.body).toContain("We look forward to your order.");
  });

  it("a sales member works the outbox; a viewer cannot", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    const sales = await setupOrgWithUser("sales");
    await expect(prepareMessage(sales.ctx, { leadId: id, purpose: "first_quotation", channel: "email" })).rejects.toMatchObject({ code: "NOT_FOUND" }); // other company
    const salesHere = await createUser();
    await addMember(orgId, salesHere, "sales");
    const salesCtx: Ctx = { orgId, actor: { kind: "human", userId: salesHere.id, email: salesHere.email, role: "sales" } };
    const m = await prepareMessage(salesCtx, { leadId: id, purpose: "detailed_quotation", channel: "email" });
    expect(m.state).toBe("draft");
    await createOutboundRule(salesCtx, { matchType: "text_contains", pattern: "tender", note: "Tenders go to the owner" });
    const viewer = await createUser();
    await addMember(orgId, viewer, "viewer");
    const viewerCtx: Ctx = { orgId, actor: { kind: "human", userId: viewer.id, email: viewer.email, role: "viewer" } };
    await expect(prepareMessage(viewerCtx, { leadId: id, purpose: "first_quotation", channel: "email" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listOutbox(viewerCtx, { view: "review" })).items.length).toBeGreaterThan(0);
  });
});
