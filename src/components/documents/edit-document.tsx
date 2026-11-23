"use client";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/primitives";
import { updateDocumentAction } from "@/app/(app)/documents/actions";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentType } from "@/modules/documents/types";

export type EditableDocument = {
  id: string; fileName: string; productId: string | null; type: DocumentType; title: string; batch: string | null;
  issueDate: string | null; expiryDate: string | null; notes: string | null;
};

/** Documents → Edit details: fixes a wrong product, type, batch or date without uploading the file again. */
export function EditDocumentButton({ doc, products }: { doc: EditableDocument; products: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErrors({}); }}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Edit details of ${doc.fileName}`}><Pencil />Edit</Button>
      <DialogContent title="Edit document details" description={`${doc.fileName}. The file stays the same; for a new batch, add the new file instead.`}>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const text = (k: string) => String(f.get(k) ?? "").trim();
          start(async () => {
            const r = await updateDocumentAction({
              documentId: doc.id, productId: text("productId"), type: text("type") as DocumentType, title: text("title"), batch: text("batch"),
              issueDate: text("issueDate"), expiryDate: text("expiryDate"), notes: text("notes"),
            });
            if (r.ok) { toast.success("Details saved"); setOpen(false); setErrors({}); }
            else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
          });
        }}>
          <Field label="Product" htmlFor={`ed-product-${doc.id}`} error={errors.productId?.[0]}>
            <Select id={`ed-product-${doc.id}`} name="productId" defaultValue={doc.productId ?? ""}>
              <option value="">Whole company (not one product)</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Type" htmlFor={`ed-type-${doc.id}`}>
            <Select id={`ed-type-${doc.id}`} name="type" defaultValue={doc.type}>{DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}</Select>
          </Field>
          <Field label="Title" htmlFor={`ed-title-${doc.id}`} error={errors.title?.[0]}><Input id={`ed-title-${doc.id}`} name="title" required maxLength={160} defaultValue={doc.title} /></Field>
          <Field label="Batch number" htmlFor={`ed-batch-${doc.id}`}><Input id={`ed-batch-${doc.id}`} name="batch" maxLength={80} defaultValue={doc.batch ?? ""} /></Field>
          <Field label="Issue date" htmlFor={`ed-issue-${doc.id}`} error={errors.issueDate?.[0]}><Input id={`ed-issue-${doc.id}`} name="issueDate" type="date" defaultValue={doc.issueDate ?? ""} /></Field>
          <Field label="Expiry date" htmlFor={`ed-expiry-${doc.id}`} error={errors.expiryDate?.[0]} hint="An expired file is never attached to a quotation">
            <Input id={`ed-expiry-${doc.id}`} name="expiryDate" type="date" defaultValue={doc.expiryDate ?? ""} />
          </Field>
          <Field label="Note" htmlFor={`ed-notes-${doc.id}`} className="sm:col-span-2"><Input id={`ed-notes-${doc.id}`} name="notes" maxLength={500} defaultValue={doc.notes ?? ""} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save details"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
