/**
 * Document library (GOAL G-KB-4): COA, TDS, MSDS, specifications, brochures and certificates per
 * product, with batch, issue date and expiry. "Latest valid COA for product X" returns one file or
 * none, and an expired file is never attached to a quotation (`latestValidDocumentsInternal`).
 *
 * Files are kept in file storage (`storage.ts`); this module stores the details and checks access.
 * Uploading and reading a file are network calls, so they run outside database transactions.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { AppError, notFound } from "@/lib/errors";
import { todayIST } from "@/lib/format";
import { audit, emit } from "@/modules/core/audit";
import { authorize } from "@/modules/core/permissions";
import { defineService, parseInput, runTx } from "@/modules/core/service-kit";
import { actorString, type Ctx } from "@/modules/core/types";
import { productInfoById, productNamesInternal } from "@/modules/catalog/service";
import { documents } from "./schema";
import { fileStore, type FileStore } from "./storage";
import { ALLOWED_FILES, DOCUMENT_TYPES, DOCUMENT_TYPE_SHORT, MAX_DOCUMENT_BYTES, fileExtension, looksLike, safeFileName, validity, type DocumentType } from "./types";

export type DocumentRow = typeof documents.$inferSelect;
type Deps = { store?: FileStore | null };

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-17");
function storeOrFail(deps: Deps): FileStore {
  const s = deps.store === undefined ? fileStore() : deps.store;
  if (!s) throw new AppError("INTEGRATION", "File storage is not set up on this site. Add SUPABASE_SERVICE_ROLE_KEY to the hosting settings (docs/SETUP.md section 2).");
  return s;
}

const uploadInput = z.object({
  productId: z.string().uuid().nullish(),
  type: z.enum(DOCUMENT_TYPES),
  title: z.string().trim().max(160).nullish(),
  batch: z.string().trim().max(80).nullish(),
  issueDate: ymd.nullish(),
  expiryDate: ymd.nullish(),
  notes: z.string().trim().max(500).nullish(),
  file: z.object({ name: z.string().min(1).max(255), bytes: z.instanceof(Uint8Array) }),
}).refine((d) => !d.issueDate || !d.expiryDate || d.expiryDate >= d.issueDate, { message: "The expiry date is before the issue date", path: ["expiryDate"] });

/** Saves a file and its details. Refuses wrong file types (checked by content, not only by name) and files over 4 MB. */
export async function uploadDocument(ctx: Ctx, raw: z.input<typeof uploadInput>, deps: Deps = {}) {
  const input = parseInput(uploadInput, raw);
  authorize(ctx, "documents.write");
  const fileName = safeFileName(input.file.name);
  const ext = fileExtension(fileName);
  const contentType = ALLOWED_FILES[ext];
  const bad = (msg: string) => new AppError("VALIDATION", msg, { fieldErrors: { file: [msg] } });
  if (!contentType) throw bad("Upload a PDF, an image (PNG, JPG, WebP) or a Word or Excel file.");
  if (input.file.bytes.byteLength === 0) throw bad("The file is empty.");
  if (input.file.bytes.byteLength > MAX_DOCUMENT_BYTES) throw bad("The file is larger than 4 MB. Save it smaller (for example as a compressed PDF) and try again.");
  if (!looksLike(ext, input.file.bytes)) throw bad(`This file is not a real .${ext} file.`);
  const store = storeOrFail(deps);

  if (input.productId) {
    const p = await runTx(ctx, (tx) => productInfoById(tx, ctx.orgId, input.productId!));
    if (!p || p.removed) throw notFound("Product");
  }
  const id = randomUUID();
  const storageKey = `${ctx.orgId}/${id}.${ext}`;
  await store.put(storageKey, input.file.bytes, contentType);
  try {
    return await runTx(ctx, async (tx) => {
      const [row] = await tx.insert(documents).values({
        id, orgId: ctx.orgId, productId: input.productId ?? null, type: input.type, title: input.title || fileName.replace(/\.[^.]+$/, ""),
        fileName, contentType, sizeBytes: input.file.bytes.byteLength, sha256: createHash("sha256").update(input.file.bytes).digest("hex"), storageKey,
        batch: input.batch || null, issueDate: input.issueDate || null, expiryDate: input.expiryDate || null, notes: input.notes || null, createdBy: actorString(ctx.actor),
      }).returning();
      await audit(tx, ctx, { action: "document.add", entityType: "document", entityId: id, changes: { type: input.type, productId: input.productId ?? null, fileName, batch: input.batch ?? null, expiryDate: input.expiryDate ?? null } });
      await emit(tx, ctx, { type: "document.added", entityType: "document", entityId: id, payload: { type: input.type } });
      return row!;
    });
  } catch (e) {
    await store.remove(storageKey).catch(() => {}); // no file without its row
    throw e;
  }
}

export const listDocuments = defineService({
  name: "documents.list",
  input: z.object({ productId: z.string().uuid().optional(), type: z.enum(DOCUMENT_TYPES).optional() }).default({}),
  permission: "documents.read",
  handler: async (ctx, input, tx) => {
    const rows = await tx.select().from(documents).where(and(
      eq(documents.orgId, ctx.orgId), isNull(documents.deletedAt),
      input.productId ? eq(documents.productId, input.productId) : undefined,
      input.type ? eq(documents.type, input.type) : undefined,
    )).orderBy(asc(documents.type), sql`${documents.issueDate} desc nulls last`, desc(documents.createdAt)).limit(500);
    const names = await productNamesInternal(tx, ctx.orgId);
    const today = todayIST();
    return rows.map((r) => ({ ...r, productName: r.productId ? names.get(r.productId)?.name ?? null : null, validity: validity(r.expiryDate, today) }));
  },
});

export const removeDocument = defineService({
  name: "documents.remove",
  input: z.object({ documentId: z.string().uuid() }),
  permission: "documents.write",
  handler: async (ctx, input, tx) => {
    const [d] = await tx.select().from(documents).where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, input.documentId), isNull(documents.deletedAt)));
    if (!d) throw notFound("Document");
    await tx.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, d.id));
    await audit(tx, ctx, { action: "document.remove", entityType: "document", entityId: d.id, changes: { type: d.type, fileName: d.fileName } });
    await emit(tx, ctx, { type: "document.removed", entityType: "document", entityId: d.id, payload: { type: d.type } });
    return { ok: true };
  },
});

/** The file of one document, for the download link. */
export async function getDocumentFile(ctx: Ctx, raw: { documentId: string }, deps: Deps = {}) {
  const input = parseInput(z.object({ documentId: z.string().uuid() }), raw);
  authorize(ctx, "documents.read");
  const d = await runTx(ctx, async (tx) => (await tx.select().from(documents).where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, input.documentId), isNull(documents.deletedAt))))[0]);
  if (!d) throw notFound("Document");
  return { fileName: d.fileName, contentType: d.contentType, data: await storeOrFail(deps).get(d.storageKey) };
}

/**
 * For each requested type, the newest document that is valid today: issued most recently, not expired
 * (no expiry date counts as valid), for this product, else one that applies to the whole company.
 * Returns at most one document per type; a type with only expired files returns nothing.
 */
export async function latestValidDocumentsInternal(tx: Tx, orgId: string, productId: string | null, types: readonly DocumentType[] = DOCUMENT_TYPES, today = todayIST()): Promise<DocumentRow[]> {
  if (!types.length) return [];
  return tx.selectDistinctOn([documents.type]).from(documents).where(and(
    eq(documents.orgId, orgId), isNull(documents.deletedAt), inArray(documents.type, [...types]),
    productId ? or(eq(documents.productId, productId), isNull(documents.productId)) : isNull(documents.productId),
    or(isNull(documents.expiryDate), gte(documents.expiryDate, today)),
  )).orderBy(documents.type, sql`(${documents.productId} is null)`, sql`${documents.issueDate} desc nulls last`, desc(documents.createdAt));
}

/** What can be attached to a quotation for this product right now (lead page). */
export const documentsForProduct = defineService({
  name: "documents.forProduct",
  input: z.object({ productId: z.string().uuid() }),
  permission: "documents.read",
  handler: async (ctx, input, tx) => {
    const today = todayIST();
    return (await latestValidDocumentsInternal(tx, ctx.orgId, input.productId, DOCUMENT_TYPES, today)).map((d) => ({
      id: d.id, type: d.type, label: DOCUMENT_TYPE_SHORT[d.type], fileName: d.fileName, batch: d.batch, expiryDate: d.expiryDate, validity: validity(d.expiryDate, today),
    }));
  },
});

/** Reads the files of documents found by `latestValidDocumentsInternal` (network; call outside a transaction). */
export async function documentFilesInternal(docs: DocumentRow[], deps: Deps = {}) {
  if (!docs.length) return [];
  const store = storeOrFail(deps);
  return Promise.all(docs.map(async (d) => ({ document: d, data: await store.get(d.storageKey) })));
}

/** Documents by id (for a prepared message that recorded which files it attaches). Removed files are left out. */
export async function documentsByIdsInternal(tx: Tx, orgId: string, ids: string[]): Promise<DocumentRow[]> {
  if (!ids.length) return [];
  return tx.select().from(documents).where(and(eq(documents.orgId, orgId), inArray(documents.id, ids), isNull(documents.deletedAt)));
}
