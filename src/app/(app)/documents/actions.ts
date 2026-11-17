"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { removeDocument, uploadDocument } from "@/modules/documents/service";
import type { DocumentType } from "@/modules/documents/types";

/** Documents → Add document. The form posts the file itself (up to 4 MB). */
export async function uploadDocumentAction(form: FormData) {
  const s = await requireSession("documents.write");
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const file = form.get("file");
  const r = await runAction(async () => uploadDocument(s.ctx, {
    productId: text("productId"), type: (text("type") ?? "") as DocumentType, title: text("title"), batch: text("batch"),
    issueDate: text("issueDate"), expiryDate: text("expiryDate"), notes: text("notes"),
    file: { name: file instanceof File ? file.name : "", bytes: file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array() },
  }));
  revalidatePath("/documents");
  return r.ok ? { ok: true as const } : r;
}

export async function removeDocumentAction(documentId: string) {
  const s = await requireSession("documents.write");
  const r = await runAction(() => removeDocument(s.ctx, { documentId }));
  revalidatePath("/documents");
  return r.ok ? { ok: true as const } : r;
}
