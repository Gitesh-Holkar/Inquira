import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/core/permissions";
import { listProducts } from "@/modules/catalog/service";
import { listDocuments } from "@/modules/documents/service";
import { fileStoreKind } from "@/modules/documents/storage";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_SHORT, type DocumentType } from "@/modules/documents/types";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, Select } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { UploadDocumentForm } from "@/components/documents/upload-form";
import { RemoveDocumentButton } from "@/components/documents/remove-document";

export const metadata: Metadata = { title: "Documents" };

const VALIDITY = {
  valid: { tone: "success", text: (d: number | null) => `Valid, ${d} days left` },
  expiring: { tone: "warning", text: (d: number | null) => (d === 0 ? "Expires today" : `Expires in ${d} day${d === 1 ? "" : "s"}`) },
  expired: { tone: "danger", text: () => "Expired: never attached" },
  no_expiry: { tone: "neutral", text: () => "No expiry date" },
} as const;

/** Documents (GOAL G-KB-4): COA, TDS, MSDS and other files per product, with batch and expiry. */
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ product?: string; type?: string }> }) {
  const s = await requireSession("documents.read");
  const sp = await searchParams;
  const productId = sp.product && /^[0-9a-f-]{36}$/.test(sp.product) ? sp.product : undefined;
  const type = DOCUMENT_TYPES.includes(sp.type as DocumentType) ? (sp.type as DocumentType) : undefined;
  const [docs, products] = await Promise.all([listDocuments(s.ctx, { productId, type }), listProducts(s.ctx, {})]);
  const canWrite = can(s.ctx, "documents.write");
  const storage = fileStoreKind();
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Documents" description="COA, TDS, MSDS and other files for your products. The latest valid file of a type can be attached to a quotation; expired files never are." />
      {!storage ? <Alert tone="warning" className="mb-4" title="File storage is not set up on this site">Add SUPABASE_SERVICE_ROLE_KEY to the hosting settings (docs/SETUP.md section 2), then redeploy.</Alert> : null}
      {canWrite && storage ? (
        <Card className="mb-4">
          <CardHeader><CardTitle>Add document</CardTitle></CardHeader>
          <CardContent><UploadDocumentForm products={sorted.map((p) => ({ id: p.id, name: p.name }))} /></CardContent>
        </Card>
      ) : null}

      <form className="mb-3 grid gap-2 sm:flex sm:items-end" action="/documents">
        <Select name="product" aria-label="Filter by product" defaultValue={productId ?? ""} className="sm:w-72">
          <option value="">All products</option>
          {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select name="type" aria-label="Filter by type" defaultValue={type ?? ""} className="sm:w-56">
          <option value="">All types</option>
          {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_SHORT[t]}</option>)}
        </Select>
        <Button type="submit" variant="outline">Filter</Button>
        {productId || type ? <Link href="/documents" className="text-sm text-primary underline-offset-4 hover:underline sm:self-center">Clear</Link> : null}
      </form>

      {docs.length === 0 ? (
        <Card>
          <EmptyState icon={<FileText />} title={productId || type ? "No documents match" : "No documents yet"}>
            {canWrite ? "Add your COA, TDS and MSDS files above, with their batch and expiry date." : "Ask an owner or admin to add the COA, TDS and MSDS files."}
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-2" aria-label="Documents">
          {docs.map((d) => {
            const v = VALIDITY[d.validity.status];
            return (
              <li key={d.id}>
                <Card className="flex flex-wrap items-start gap-3 p-3">
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info" title={DOCUMENT_TYPE_LABELS[d.type]}>{DOCUMENT_TYPE_SHORT[d.type]}</Badge>
                      <Badge tone={v.tone}>{v.text(d.validity.daysLeft)}</Badge>
                    </div>
                    <p className="mt-1 break-words font-medium">{d.title}</p>
                    <p className="break-words text-sm text-muted">
                      {[d.productName ?? "Whole company", d.batch ? `Batch ${d.batch}` : null, d.issueDate ? `Issued ${formatDate(d.issueDate)}` : null, d.expiryDate ? `Expires ${formatDate(d.expiryDate)}` : null, `${Math.max(1, Math.round(d.sizeBytes / 1024))} KB`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm"><a href={`/api/documents/${d.id}`} aria-label={`Download ${d.fileName}`}><Download />Download</a></Button>
                    {canWrite ? <RemoveDocumentButton id={d.id} name={d.fileName} /> : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
