"use client";
import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/primitives";
import { uploadDocumentAction } from "@/app/(app)/documents/actions";
import { ACCEPT_ATTRIBUTE, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, MAX_DOCUMENT_BYTES } from "@/modules/documents/types";

/** Documents → Add document: product (or the whole company), type, file, batch, dates. */
export function UploadDocumentForm({ products }: { products: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const file = fd.get("file");
      if (file instanceof File && file.size > MAX_DOCUMENT_BYTES) {
        setErrors({ file: ["The file is larger than 4 MB. Save it smaller (for example as a compressed PDF) and try again."] });
        return;
      }
      start(async () => {
        const r = await uploadDocumentAction(fd);
        if (r.ok) { toast.success("Document added"); setErrors({}); formRef.current?.reset(); }
        else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
      });
    }}>
      <Field label="Product" htmlFor="doc-product" error={errors.productId?.[0]}>
        <Select id="doc-product" name="productId" defaultValue="">
          <option value="">Whole company (not one product)</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Type" htmlFor="doc-type" error={errors.type?.[0]}>
        <Select id="doc-type" name="type" defaultValue="coa">{DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}</Select>
      </Field>
      <Field label="File (PDF, image, Word or Excel; up to 4 MB)" htmlFor="doc-file" error={errors.file?.[0]} className="sm:col-span-2">
        <Input id="doc-file" name="file" type="file" accept={ACCEPT_ATTRIBUTE} required />
      </Field>
      <Field label="Batch number" htmlFor="doc-batch" hint="Optional"><Input id="doc-batch" name="batch" maxLength={80} /></Field>
      <Field label="Title" htmlFor="doc-title" hint="Optional; the file name is used otherwise"><Input id="doc-title" name="title" maxLength={160} /></Field>
      <Field label="Issue date" htmlFor="doc-issue" error={errors.issueDate?.[0]}><Input id="doc-issue" name="issueDate" type="date" /></Field>
      <Field label="Expiry date" htmlFor="doc-expiry" error={errors.expiryDate?.[0]} hint="An expired file is never attached to a quotation">
        <Input id="doc-expiry" name="expiryDate" type="date" />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" disabled={pending}><Upload />{pending ? "Uploading…" : "Add document"}</Button>
      </div>
    </form>
  );
}
