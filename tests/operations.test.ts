/**
 * Operations (GOAL G-RPT-1, G-RPT-2, G-PLT-7): report numbers, the owner's daily summary, nightly backups and a
 * full restore. Gmail is faked; files go to the test folder (FILE_STORAGE=disk). All data invented.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { getIntegrationInternal, updateIntegrationInternal, updateOrgSettings, writeSecretsInternal } from "@/modules/core/service";
import { integrations, memberships, organizations } from "@/modules/core/schema";
import { createProduct, updateRates } from "@/modules/catalog/service";
import { leads } from "@/modules/leads/schema";
import { upsertLeadInternal } from "@/modules/leads/service";
import { outgoingMessages } from "@/modules/outbound/schema";
import { approveAndSendInternal, runOutboundPlan, saveOutboundSettings } from "@/modules/outbound/service";
import { readOutboundSettings } from "@/modules/outbound/types";
import { reportInternal, runDailySummary } from "@/modules/dashboard/service";
import { backups } from "@/modules/backup/schema";
import { backupNow, getBackupFile, nightlyBackup, readBackup, restoreBackupInternal, runBackupInternal } from "@/modules/backup/service";
import { uploadDocument } from "@/modules/documents/service";
import { documents } from "@/modules/documents/schema";
import { fileStore } from "@/modules/documents/storage";
import type { Ctx } from "@/modules/core/types";
import { addMember, createUser, resetDb, setupOrgWithUser, systemCtx } from "./helpers/db";
import { fakeGoogle } from "./helpers/fake-google";

let ctx: Ctx;
let sys: Ctx;
let orgId: string;
let ownerEmail: string;

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
  ownerEmail = s.user.email;
  sys = systemCtx(orgId);
  const { grades } = await createProduct(ctx, { name: "Sample Protein Isolate", grades: ["Standard"] });
  await updateRates(ctx, { items: [{ gradeId: grades[0]!.id, pricePerKgInr: "300", gstPercent: "18", priceBasis: "Ex-factory", moqKg: "100", packSize: "20 Kg" }] });
  await updateOrgSettings(ctx, { paymentTerms: "100% advance" });
  await connectGmail();
});
afterAll(closeDb);

const lead = (ref: string, over: Record<string, unknown> = {}) => withSystemTx((tx) => upsertLeadInternal(tx, sys, {
  source: "indiamart", sourceRef: ref, channel: "indiamart_api_w", receivedAt: new Date(Date.now() - 30 * 60_000), contactName: "Test Buyer",
  email: `${ref}@example.com`, phone: `+9190000${ref.replace(/\D/g, "").padStart(5, "0")}`, productText: "Sample Protein Isolate", quantityText: "500 kg", message: "Price please", ...over,
}));

describe("report numbers (G-RPT-1)", () => {
  it("counts leads, matches, replies by people and automatically, held, set aside, and the time to first reply", async () => {
    const a = await lead("101");
    await lead("102", { productText: "something unknown" });
    await runOutboundPlan(sys);
    const first = (await getDb().select().from(outgoingMessages)).find((m) => m.leadId === a.leadId && m.channel === "email")!;
    await approveAndSendInternal(ctx, { id: first.id }, { fetchImpl: fakeGoogle({ allowSend: true }).fetch });
    const r = await withSystemTx((tx) => reportInternal(tx, orgId, new Date(Date.now() - 86400_000)));
    expect(r).toMatchObject({ received: 2, matched: 1, sentByPeople: 1, autoSent: 0, firstReplies: 1 });
    expect(r.firstReplyMedianMinutes).toBeGreaterThanOrEqual(29);
    expect(r.firstReplyMedianMinutes).toBeLessThanOrEqual(31);
    expect(r.readyNow).toBeGreaterThanOrEqual(1);
  });
});

describe("daily summary (G-RPT-2)", () => {
  const evening = () => { const d = new Date(); return new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d)}T19:45:00+05:30`); };

  it("is off by default; when on, goes once a day after 19:30 IST to the owners through the send path", async () => {
    await lead("201");
    const g = fakeGoogle({ allowSend: true });
    expect(await runDailySummary(sys, { fetchImpl: g.fetch, now: evening() })).toMatchObject({ skipped: expect.any(String) });
    await saveOutboundSettings(ctx, { ...readOutboundSettings(null), dailySummary: { enabled: true, to: [] } });
    const morning = new Date(evening().getTime() - 10 * 3600_000);
    expect(await runDailySummary(sys, { fetchImpl: g.fetch, now: morning })).toMatchObject({ skipped: "Waits until 19:30 IST" });
    expect(await runDailySummary(sys, { fetchImpl: g.fetch, now: evening() })).toMatchObject({ sent: true });
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0]!.raw).toContain(`To: ${ownerEmail}`);

    expect(await runDailySummary(sys, { fetchImpl: g.fetch, now: evening() })).toMatchObject({ skipped: expect.any(String) });
    expect(g.sent).toHaveLength(1);
    const [m] = await getDb().select().from(outgoingMessages).where(eq(outgoingMessages.purpose, "daily_summary"));
    expect(m).toMatchObject({ state: "sent", leadId: null });
    expect(m!.body).toMatch(/New leads: 1 \(1 matched/);
  });

  it("the pause switch stops it too", async () => {
    await saveOutboundSettings(ctx, { ...readOutboundSettings(null), paused: true, dailySummary: { enabled: true, to: ["owner2@example.com"] } });
    const g = fakeGoogle(); // any send would throw
    expect(await runDailySummary(sys, { fetchImpl: g.fetch, now: evening() })).toMatchObject({ skipped: "Paused" });
  });
});

describe("backups (G-PLT-7)", () => {
  it("nightly: waits for 01:00 IST, once a day; only owners make or download one", async () => {
    const at = (h: number) => new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())}T${String(h).padStart(2, "0")}:30:00+05:30`);
    expect(await nightlyBackup(sys, { now: at(0) })).toMatchObject({ skipped: "Waits until 01:00 IST" });
    expect(await nightlyBackup(sys, { now: at(2) })).toMatchObject({ backupId: expect.any(String) });
    expect(await nightlyBackup(sys, { now: at(3) })).toMatchObject({ skipped: "Already backed up today" });
    const sales = await createUser();
    await addMember(orgId, sales, "sales");
    const salesCtx: Ctx = { orgId, actor: { kind: "human", userId: sales.id, email: sales.email, role: "sales" } };
    await expect(backupNow(salesCtx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [b] = await getDb().select().from(backups);
    await expect(getBackupFile(salesCtx, { backupId: b!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getBackupFile(ctx, { backupId: b!.id })).fileName).toMatch(/^inquira-backup-\d{4}-\d{2}-\d{2}\.json\.gz$/);
  });

  it("keeps 14 days", async () => {
    const old = await runBackupInternal(sys, { now: new Date(Date.now() - 20 * 86400_000) });
    await getDb().update(backups).set({ createdAt: new Date(Date.now() - 20 * 86400_000) }).where(eq(backups.id, old.backup.id));
    const r = await runBackupInternal(sys);
    expect(r.removed).toBe(1);
    await expect(fileStore()!.get(old.backup.storageKey)).rejects.toThrow();
  });

  it("restores everything into an empty database: rows, document files, members matched by email; keys never inside", async () => {
    const { leadId } = await lead("301");
    const { product } = await createProduct(ctx, { name: "Second Product" });
    await uploadDocument(ctx, { productId: product.id, type: "coa", expiryDate: "2030-01-01", file: { name: "coa.pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.4 test coa")) } });
    const made = await backupNow(ctx);
    const file = await getBackupFile(ctx, { backupId: made.id });
    const parsed = readBackup(file.data);
    expect(Object.keys(parsed.tables)).not.toContain("integration_secrets");
    expect(JSON.stringify(parsed)).not.toContain("secret-123456");

    // Disaster: the database and the files are gone; the owner signs up with the same email (a new account id).
    await resetDb();
    const [docRow] = parsed.tables.documents as { storage_key: string }[];
    await fileStore()!.remove(docRow!.storage_key);
    const owner = await createUser(ownerEmail);
    const r = await withSystemTx((tx) => restoreBackupInternal(tx, parsed));
    expect(r.counts.leads).toBe(1);
    expect(r.files).toBe(1);
    const [org] = await getDb().select().from(organizations);
    expect(org!.id).toBe(orgId);
    const [l] = await getDb().select().from(leads).where(eq(leads.id, leadId));
    expect(l).toMatchObject({ productText: "Sample Protein Isolate", contactName: "Test Buyer" });
    const [m] = await getDb().select().from(memberships);
    expect(m!.userId).toBe(owner.id);
    const [doc] = await getDb().select().from(documents);
    expect(Buffer.from(await fileStore()!.get(doc!.storageKey)).toString()).toBe("%PDF-1.4 test coa");
    const ints = await getDb().select().from(integrations);
    expect(ints.every((i) => i.status === "not_connected")).toBe(true);
    await expect(withSystemTx((tx) => restoreBackupInternal(tx, parsed))).rejects.toThrow(/already exists/);
  });

  it("local mode: a member with no account on the new computer gets one without a password", async () => {
    const made = await backupNow(ctx);
    const parsed = readBackup((await getBackupFile(ctx, { backupId: made.id })).data);
    await resetDb();
    const r = await withSystemTx((tx) => restoreBackupInternal(tx, parsed, { createLocalAccounts: true }));
    expect(r.accounts).toBe(1);
    const [m] = await getDb().select().from(memberships);
    const [u] = await getDb().execute<{ id: string; email: string; encrypted_password: string | null }>(sql`select id, email, encrypted_password from auth.users`);
    expect(u).toMatchObject({ id: m!.userId, email: ownerEmail.toLowerCase(), encrypted_password: null });
  });
});
