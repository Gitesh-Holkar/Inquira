/**
 * "Not replied" and "Replied" leads, and removing replied leads after some days (owner's request of 28 Nov 2026).
 * A lead is replied only when a reply really went out and nothing for it waits or failed in the Outbox; the buyer
 * writing again brings it back. Gmail is faked; people act as signed-in roles under RLS. All data invented.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { getIntegrationInternal, updateIntegrationInternal, updateOrgSettings, writeSecretsInternal } from "@/modules/core/service";
import { orgSettings } from "@/modules/core/schema";
import { createProduct, updateRates } from "@/modules/catalog/service";
import { leads } from "@/modules/leads/schema";
import { cleanupRepliedLeads, deleteLeads, listLeads, markLeadsNotReplied, markLeadsReplied, upsertLeadInternal } from "@/modules/leads/service";
import { ingestMessageInternal } from "@/modules/email/service";
import { outgoingMessages } from "@/modules/outbound/schema";
import { approveAndSendInternal, runOutboundPlan } from "@/modules/outbound/service";
import { getDashboard } from "@/modules/dashboard/service";
import type { Ctx } from "@/modules/core/types";
import { addMember, createUser, resetDb, setupOrgWithUser, systemCtx } from "./helpers/db";
import { fakeGoogle } from "./helpers/fake-google";

let ctx: Ctx;
let sys: Ctx;
let orgId: string;
let n = 0;
const OWN = { ownAddresses: ["sales@seller.example"] };

beforeEach(async () => {
  await resetDb();
  const s = await setupOrgWithUser("owner");
  ctx = s.ctx;
  orgId = s.org.id;
  sys = systemCtx(orgId);
  const { grades } = await createProduct(ctx, { name: "Sample Protein Isolate", grades: ["Standard"] });
  await updateRates(ctx, { items: [{ gradeId: grades[0]!.id, pricePerKgInr: "300", gstPercent: "18", priceBasis: "Ex-factory", moqKg: "100", packSize: "20 Kg" }] });
  await updateOrgSettings(ctx, { paymentTerms: "100% advance" });
  await withSystemTx(async (tx) => {
    const integ = await getIntegrationInternal(tx, orgId, "gmail");
    await writeSecretsInternal(tx, sys, integ, { clientId: "x.apps.googleusercontent.com", clientSecret: "secret-123456", refreshToken: "rt" });
    await updateIntegrationInternal(tx, sys, integ.id, { status: "connected", accountEmail: "sales@seller.example", config: { ownAddresses: OWN.ownAddresses } });
  });
});
afterAll(closeDb);

/** An enquiry by email (so it has a Gmail thread) with an email address and a phone number. */
async function lead() {
  n++;
  return (await withSystemTx((tx) => upsertLeadInternal(tx, sys, {
    source: "indiamart", sourceRef: `IM-R${n}`, channel: "indiamart_api_w", receivedAt: new Date(Date.now() - 60_000), contactName: "Test Buyer",
    email: `buyer${n}@example.com`, phone: `+9190000${String(700 + n).padStart(5, "0")}`, productText: "Sample Protein Isolate", quantityText: "500 kg",
    message: "Kindly send your best price", gmailThreadId: `thread-${n}`,
  }))).leadId;
}
const ids = async (replied: "yes" | "no") => (await listLeads(ctx, { replied })).items.map((l) => l.id);
const msgs = (leadId: string) => getDb().select().from(outgoingMessages).where(eq(outgoingMessages.leadId, leadId));
const row = async (leadId: string) => (await getDb().select().from(leads).where(eq(leads.id, leadId)))[0]!;
/** The buyer writes in the lead's Gmail thread. */
const buyerWrites = async (leadId: string, id: string) => {
  const l = await row(leadId);
  return withSystemTx((tx) => ingestMessageInternal(tx, sys, {
  gmailMessageId: id, gmailThreadId: l.gmailThreadId!, fromEmail: l.email, fromName: "Test Buyer", toEmails: OWN.ownAddresses, ccEmails: [],
  subject: "Re: enquiry", snippet: "x", text: "Thanks. What is the delivery time?", html: null, labelIds: ["INBOX"], headers: {}, receivedAt: new Date(),
  }, OWN));
};
/** A person replies from Gmail in the lead's thread (the sync sees a SENT message). */
const ownReply = async (leadId: string, gmailId: string) => {
  const l = await row(leadId);
  return withSystemTx((tx) => ingestMessageInternal(tx, sys, {
    gmailMessageId: gmailId, gmailThreadId: l.gmailThreadId!, fromEmail: "sales@seller.example", fromName: "Sales", toEmails: [l.email!], ccEmails: [],
    subject: "Re: enquiry", snippet: "x", text: "Dear sir, our price is attached.", html: null, labelIds: ["SENT"], headers: {}, receivedAt: new Date(),
  }, OWN));
};
/** Pretends the reply (and the buyer's message before it) happened some days ago. */
const repliedDaysAgo = (leadId: string, d: number, extra: Partial<typeof leads.$inferInsert> = {}) =>
  getDb().update(leads).set({ repliedAt: new Date(Date.now() - d * 86400_000), lastBuyerMessageAt: new Date(Date.now() - (d + 1) * 86400_000), ...extra }).where(eq(leads.id, leadId));

describe("Not replied and Replied", () => {
  it("stays Not replied until both the email and the WhatsApp message went out", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    expect((await msgs(id)).map((m) => m.channel).sort()).toEqual(["email", "whatsapp"]);
    expect(await ids("no")).toContain(id);
    const g = fakeGoogle({ allowSend: true });
    const email = (await msgs(id)).find((m) => m.channel === "email")!;
    await approveAndSendInternal(ctx, { id: email.id, confirmHeld: true }, { fetchImpl: g.fetch });
    expect(await ids("no")).toContain(id); // the WhatsApp message still waits
    const wa = (await msgs(id)).find((m) => m.channel === "whatsapp")!;
    await approveAndSendInternal(ctx, { id: wa.id, confirmHeld: true });
    expect(await ids("yes")).toContain(id);
    expect(await ids("no")).not.toContain(id);
  });

  it("a send that fails keeps the lead in Not replied, so it is never lost", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    const email = (await msgs(id)).find((m) => m.channel === "email")!;
    const g = fakeGoogle(); // refuses to send: the send fails
    const r = await approveAndSendInternal(ctx, { id: email.id, confirmHeld: true }, { fetchImpl: g.fetch });
    expect(r.message.state).toBe("failed");
    const wa = (await msgs(id)).find((m) => m.channel === "whatsapp")!;
    await approveAndSendInternal(ctx, { id: wa.id, confirmHeld: true });
    expect(await row(id)).toMatchObject({ outboxPending: true });
    expect(await ids("no")).toContain(id);
  });

  it("the buyer writing again brings the lead back to Not replied", async () => {
    const id = await lead();
    await markLeadsReplied(ctx, { leadIds: [id] });
    expect(await ids("yes")).toContain(id);
    await buyerWrites(id, "buyer-again-1");
    expect(await ids("no")).toContain(id);
  });

  it("a reply a person sent from Gmail counts, and stops Inquira's unsent email (WhatsApp still waits)", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    await ownReply(id, "own-1");
    const m = await msgs(id);
    expect(m.find((x) => x.channel === "email")).toMatchObject({ state: "cancelled", cancelledReason: "A person replied by email from Gmail" });
    expect(m.find((x) => x.channel === "whatsapp")!.state).toBe("draft");
    expect((await row(id)).repliedAt).not.toBeNull();
    expect(await ids("no")).toContain(id); // the WhatsApp message is still to send
  });

  it("an email Inquira sent itself is not mistaken for a person's reply", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    const g = fakeGoogle({ allowSend: true });
    const email = (await msgs(id)).find((m) => m.channel === "email")!;
    const sent = await approveAndSendInternal(ctx, { id: email.id, confirmHeld: true }, { fetchImpl: g.fetch });
    await ownReply(id, sent.message.gmailMessageId!);
    expect((await msgs(id)).find((m) => m.channel === "whatsapp")!.state).toBe("draft"); // nothing cancelled
  });

  it("Mark as replied (one or many) stops unsent messages; Move to Not replied undoes it; viewers cannot", async () => {
    const [a, b] = [await lead(), await lead()];
    await runOutboundPlan(sys);
    const sales = await createUser();
    await addMember(orgId, sales, "sales");
    const salesCtx: Ctx = { orgId, actor: { kind: "human", userId: sales.id, email: sales.email, role: "sales" } };
    expect(await markLeadsReplied(salesCtx, { leadIds: [a, b] })).toMatchObject({ count: 2, cancelled: 4 });
    expect(await ids("yes")).toEqual(expect.arrayContaining([a, b]));
    expect((await msgs(a)).every((m) => m.state === "cancelled")).toBe(true);
    await markLeadsNotReplied(salesCtx, { leadIds: [a] });
    expect(await ids("no")).toContain(a);
    const viewer = await createUser();
    await addMember(orgId, viewer, "viewer");
    await expect(markLeadsReplied({ orgId, actor: { kind: "human", userId: viewer.id, email: viewer.email, role: "viewer" } }, { leadIds: [a] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the dashboard counts the leads not replied yet", async () => {
    const [a] = [await lead(), await lead()];
    await markLeadsReplied(ctx, { leadIds: [a] });
    expect((await getDashboard(ctx, {})).needingAction).toBe(1);
  });
});

describe("removing replied leads after some days", () => {
  it("removes leads replied more than 7 days ago; keeps newer ones, ones with something waiting, and all when switched off", async () => {
    const [old, fresh, waiting] = [await lead(), await lead(), await lead()];
    await markLeadsReplied(ctx, { leadIds: [old, fresh, waiting] });
    await repliedDaysAgo(old, 8);
    await repliedDaysAgo(waiting, 8, { outboxPending: true });
    await repliedDaysAgo(fresh, 3);
    await getDb().update(orgSettings).set({ removeRepliedAfterDays: null }).where(eq(orgSettings.orgId, orgId));
    expect(await cleanupRepliedLeads(sys)).toMatchObject({ removed: 0, skipped: expect.any(String) });
    await getDb().update(orgSettings).set({ removeRepliedAfterDays: 7 }).where(eq(orgSettings.orgId, orgId));
    expect(await cleanupRepliedLeads(sys)).toEqual({ removed: 1 });
    expect(await row(old)).toMatchObject({ deletedReason: "replied" });
    expect((await row(old)).deletedAt).not.toBeNull();
    expect((await listLeads(ctx, {})).items.map((l) => l.id).sort()).toEqual([fresh, waiting].sort());
  });

  it("a removed lead comes back when the buyer writes again, but not when the same enquiry is imported again", async () => {
    const id = await lead();
    await markLeadsReplied(ctx, { leadIds: [id] });
    await repliedDaysAgo(id, 9);
    expect(await cleanupRepliedLeads(sys)).toEqual({ removed: 1 });
    // The portal sends the same enquiry again (a sync overlap): it stays removed, no duplicate is made.
    const ref = (await row(id)).sourceRef;
    const again = await withSystemTx((tx) => upsertLeadInternal(tx, sys, {
      source: "indiamart", sourceRef: ref, channel: "indiamart_api_w", receivedAt: new Date(), contactName: "Test Buyer", productText: "Sample Protein Isolate",
    }));
    expect(again).toMatchObject({ leadId: id, created: false });
    expect((await listLeads(ctx, {})).items).toHaveLength(0);
    // The buyer replies in the thread: the lead is back, Not replied.
    await buyerWrites(id, "buyer-back-1");
    expect(await row(id)).toMatchObject({ deletedAt: null, deletedReason: null });
    expect(await ids("no")).toContain(id);
  });

  it("a lead a person deleted stays deleted when the buyer writes again; deleting stops its unsent messages; sales cannot delete", async () => {
    const id = await lead();
    await runOutboundPlan(sys);
    const sales = await createUser();
    await addMember(orgId, sales, "sales");
    await expect(deleteLeads({ orgId, actor: { kind: "human", userId: sales.id, email: sales.email, role: "sales" } }, { leadIds: [id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await deleteLeads(ctx, { leadIds: [id] })).toEqual({ count: 1 });
    expect((await msgs(id)).every((m) => m.state === "cancelled")).toBe(true);
    await buyerWrites(id, "buyer-after-delete");
    expect(await row(id)).toMatchObject({ deletedReason: "manual" });
    expect((await row(id)).deletedAt).not.toBeNull();
  });
});
