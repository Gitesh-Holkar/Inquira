/**
 * Document library (GOAL G-KB-4) as a signed-in person under row-level security: upload rules,
 * who may do what, "latest valid" selection, and attaching to quotation drafts (expired never).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { addDays, todayIST } from "@/lib/format";
import { auditLogs } from "@/modules/core/schema";
import { getIntegrationInternal, updateIntegrationInternal, writeSecretsInternal } from "@/modules/core/service";
import { createProduct, removeProduct, updateRates } from "@/modules/catalog/service";
import { leads } from "@/modules/leads/schema";
import { createQuoteDraft } from "@/modules/quotes/service";
import { ensureDefaultTemplatesInternal } from "@/modules/templates/service";
import { documentsForProduct, getDocumentFile, latestValidDocumentsInternal, listDocuments, removeDocument, uploadDocument } from "@/modules/documents/service";
import { diskStore, supabaseStore } from "@/modules/documents/storage";
import { fakeGoogle } from "./helpers/fake-google";
import { addMember, createUser, mcpCtx, resetDb, setupOrgWithUser, systemCtx } from "./helpers/db";
import type { Ctx, Role } from "@/modules/core/types";

const human = (orgId: string, user: { id: string; email: string }, role: Role): Ctx => ({ orgId, actor: { kind: "human", userId: user.id, email: user.email, role } });
const pdf = (text = "sample", size = 0) => {
  const head = new TextEncoder().encode(`%PDF-1.4\n${text}\n`);
  const out = new Uint8Array(Math.max(head.length, size));
  out.set(head);
  return out;
};
const store = diskStore(mkdtempSync(path.join(tmpdir(), "inquira-docs-")));
const today = todayIST();

async function company() {
  const { org, ctx, user } = await setupOrgWithUser("owner");
  const { product, grades } = await createProduct(ctx, { name: "Sample Protein Isolate", grades: ["Standard"] });
  await updateRates(ctx, { items: [{ gradeId: grades[0]!.id, pricePerKgInr: "485", gstPercent: "18", priceBasis: "Ex-factory", moqKg: "100", packSize: "20 Kg" }] });
  await withSystemTx((tx) => ensureDefaultTemplatesInternal(tx, systemCtx(org.id)));
  return { org, ctx, user, product };
}
const upload = (ctx: Ctx, over: Partial<Parameters<typeof uploadDocument>[1]> = {}) =>
  uploadDocument(ctx, { type: "coa", file: { name: "COA batch 7.pdf", bytes: pdf("coa batch 7") }, ...over }, { store });

describe("document library (G-KB-4)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("an owner uploads a COA for a product; everyone in the company lists and downloads it; it is audited", async () => {
    const { org, ctx, user, product } = await company();
    const d = await upload(ctx, { productId: product.id, batch: "B-7", issueDate: today, expiryDate: addDays(today, 200) });
    expect(d).toMatchObject({ fileName: "COA batch 7.pdf", title: "COA batch 7", contentType: "application/pdf", batch: "B-7", storageKey: `${org.id}/${d.id}.pdf` });
    for (const role of ["sales", "viewer"] as const) {
      const u = await createUser();
      await addMember(org.id, u, role);
      const c = human(org.id, u, role);
      const [row] = await listDocuments(c, {});
      expect(row).toMatchObject({ id: d.id, productName: "Sample Protein Isolate", validity: { status: "valid" } });
      const file = await getDocumentFile(c, { documentId: d.id }, { store });
      expect(new TextDecoder().decode(file.data)).toContain("coa batch 7");
      await expect(upload(c)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(removeDocument(c, { documentId: d.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const [a] = await getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.id), eq(auditLogs.action, "document.add")));
    expect(a).toMatchObject({ actor: `human:${user.id}`, entityId: d.id });
    await removeDocument(ctx, { documentId: d.id });
    expect(await listDocuments(ctx, {})).toEqual([]);
    await expect(getDocumentFile(ctx, { documentId: d.id }, { store })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses other file types, disguised files, files over 4 MB, wrong dates and removed products, and stores nothing then", async () => {
    const { ctx, product } = await company();
    await expect(upload(ctx, { file: { name: "page.html", bytes: new TextEncoder().encode("<html>") } })).rejects.toThrow(/PDF, an image/);
    await expect(upload(ctx, { file: { name: "fake.pdf", bytes: new TextEncoder().encode("<html><script>") } })).rejects.toThrow(/not a real \.pdf/);
    await expect(upload(ctx, { file: { name: "big.pdf", bytes: pdf("x", 4 * 1024 * 1024 + 1) } })).rejects.toThrow(/larger than 4 MB/);
    await expect(upload(ctx, { issueDate: "2026-11-10", expiryDate: "2026-11-01" })).rejects.toMatchObject({ code: "VALIDATION" });
    await removeProduct(ctx, { productId: product.id });
    await expect(upload(ctx, { productId: product.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listDocuments(ctx, {})).toEqual([]);
    await expect(uploadDocument(ctx, { type: "coa", file: { name: "a.pdf", bytes: pdf() } }, { store: null })).rejects.toThrow(/File storage is not set up/);
  });

  it("another company cannot see or download a document; the Claude connector has no access", async () => {
    const { org, ctx } = await company();
    const d = await upload(ctx);
    const other = await setupOrgWithUser("owner");
    expect(await listDocuments(other.ctx, {})).toEqual([]);
    await expect(getDocumentFile(other.ctx, { documentId: d.id }, { store })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listDocuments(mcpCtx(org.id), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the latest valid document per type: newest issue, never expired, the product's own before a company-wide one", async () => {
    const { org, ctx, product } = await company();
    await upload(ctx, { productId: product.id, issueDate: addDays(today, -400), expiryDate: addDays(today, -1), file: { name: "expired.pdf", bytes: pdf() } });
    const older = await upload(ctx, { productId: product.id, issueDate: addDays(today, -60), expiryDate: addDays(today, 100), file: { name: "older.pdf", bytes: pdf() } });
    const newest = await upload(ctx, { productId: product.id, issueDate: addDays(today, -5), expiryDate: addDays(today, 10), file: { name: "newest.pdf", bytes: pdf() } });
    await upload(ctx, { type: "brochure", file: { name: "company-brochure.pdf", bytes: pdf() } }); // whole company, no expiry
    await upload(ctx, { type: "tds", productId: product.id, expiryDate: addDays(today, -3), file: { name: "old-tds.pdf", bytes: pdf() } });
    const got = await withSystemTx((tx) => latestValidDocumentsInternal(tx, org.id, product.id));
    expect(Object.fromEntries(got.map((d) => [d.type, d.fileName]))).toEqual({ coa: "newest.pdf", brochure: "company-brochure.pdf" }); // no TDS: only an expired one
    expect((await documentsForProduct(ctx, { productId: product.id })).map((d) => [d.label, d.validity.status])).toEqual([["COA", "expiring"], ["Brochure", "no_expiry"]]);
    // Once the newest expires, the older valid one is chosen; when all expire, none.
    const later = addDays(today, 50);
    expect((await withSystemTx((tx) => latestValidDocumentsInternal(tx, org.id, product.id, ["coa"], later))).map((d) => d.id)).toEqual([older.id]);
    expect(await withSystemTx((tx) => latestValidDocumentsInternal(tx, org.id, product.id, ["coa"], addDays(today, 200)))).toEqual([]);
    expect(newest.id).toBeTruthy();
  });

  it("a quotation draft carries the latest valid COA as an attachment; a missing or expired type is reported, never attached", async () => {
    const { org, ctx, product } = await company();
    await withSystemTx(async (tx) => {
      const integ = await getIntegrationInternal(tx, org.id, "gmail");
      await writeSecretsInternal(tx, systemCtx(org.id), integ, { clientId: "x.apps.googleusercontent.com", clientSecret: "secret-123456", refreshToken: "rt" });
      await updateIntegrationInternal(tx, systemCtx(org.id), integ.id, { status: "connected", accountEmail: "sales@seller.example" });
    });
    await upload(ctx, { productId: product.id, expiryDate: addDays(today, -1), file: { name: "COA expired.pdf", bytes: pdf("expired") } });
    const coa = await upload(ctx, { productId: product.id, batch: "B-9", expiryDate: addDays(today, 90), file: { name: "COA B-9.pdf", bytes: pdf("valid coa B-9") } });
    const [lead] = await getDb().insert(leads).values({ orgId: org.id, source: "manual", sourceRef: "m-doc", productText: "Sample", productId: product.id, email: "buyer@example.com", createdBy: "system:test" }).returning();
    const g = fakeGoogle({ messages: [] });

    const r = await createQuoteDraft(ctx, { leadId: lead!.id, attach: ["coa", "tds"] }, { fetchImpl: g.fetch, store });
    expect(r.attached).toEqual(["COA B-9.pdf"]);
    expect(r.warning).toMatch(/No valid TDS for this product/);
    const raw = g.drafts[0]!.raw;
    expect(raw).toMatch(/Content-Type: multipart\/mixed/);
    expect(raw).toContain('Content-Disposition: attachment; filename="COA B-9.pdf"');
    expect(raw).toContain(Buffer.from(pdf("valid coa B-9")).toString("base64").slice(0, 40));
    expect(raw).not.toContain("COA expired.pdf");
    const [a] = await getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.id), eq(auditLogs.action, "quote.draft")));
    expect(a!.changes).toMatchObject({ attached: [{ documentId: coa.id, type: "coa", fileName: "COA B-9.pdf" }] });
    expect(g.calls.some((c) => /\/(messages|drafts)\/send/.test(c.url))).toBe(false);

    // A large file goes through Gmail's upload endpoint (JSON requests stop near 5 MB).
    await upload(ctx, { type: "specification", productId: product.id, file: { name: "spec.pdf", bytes: pdf("spec", 3_900_000) } });
    const big = await createQuoteDraft(ctx, { leadId: lead!.id, attach: ["specification"] }, { fetchImpl: g.fetch, store });
    expect(big.attached).toEqual(["spec.pdf"]);
    expect(g.drafts[1]).toMatchObject({ uploaded: true });
    expect(g.drafts[1]!.raw).toContain('filename="spec.pdf"');
  });
});

describe("file storage adapters", () => {
  const key = "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.pdf";

  it("disk: never overwrites a file and refuses keys that could leave its folder", async () => {
    const s = diskStore(mkdtempSync(path.join(tmpdir(), "inquira-disk-")));
    await s.put(key, pdf("one"), "application/pdf");
    await expect(s.put(key, pdf("two"), "application/pdf")).rejects.toThrow();
    expect(new TextDecoder().decode(await s.get(key))).toContain("one");
    await expect(s.get("../../etc/passwd")).rejects.toMatchObject({ code: "VALIDATION" });
    await s.remove(key);
    await expect(s.get(key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Supabase: uses the private bucket with the service key, never upserts, and reports a missing file", async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const files = new Map<string, Uint8Array>();
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, headers: init?.headers as Record<string, string> });
      const k = url.split("/storage/v1/object/documents/")[1];
      if (method === "POST" && k) { files.set(k, new Uint8Array(await new Response(init!.body).arrayBuffer())); return new Response("{}", { status: 200 }); }
      if (method === "GET" && k) return files.has(k) ? new Response(files.get(k) as BodyInit, { status: 200 }) : new Response("{}", { status: 400 });
      if (method === "DELETE" && url.endsWith("/storage/v1/object/documents")) { files.clear(); return new Response("[]", { status: 200 }); }
      throw new Error(`unexpected ${method} ${url}`);
    }) as typeof fetch;
    const s = supabaseStore({ url: "https://proj.supabase.example/", serviceKey: "svc" }, f);
    await s.put(key, pdf("hello"), "application/pdf");
    expect(calls[0]).toMatchObject({ url: `https://proj.supabase.example/storage/v1/object/documents/${key}`, method: "POST", headers: { Authorization: "Bearer svc", "x-upsert": "false" } });
    expect(new TextDecoder().decode(await s.get(key))).toContain("hello");
    await s.remove(key);
    await expect(s.get(key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
