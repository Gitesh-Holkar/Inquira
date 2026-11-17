import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Tag } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { getCurrentRates, listProducts, listRemovedProducts } from "@/modules/catalog/service";
import { getOrgSettings } from "@/modules/core/service";
import { can } from "@/modules/core/permissions";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { RatesEditor } from "@/components/rates/rates-editor";
import { AddProductButton } from "@/components/rates/add-product";
import { EditProductButton } from "@/components/rates/edit-product";
import { RemovedProducts } from "@/components/rates/removed-products";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Rates" };

export default async function RatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession("catalog.read");
  const [{ q }, rates, settings] = await Promise.all([searchParams, getCurrentRates(s.ctx, {}), getOrgSettings(s.ctx, {})]);
  const priced = rates.filter((r) => r.pricePerKgInr).length;
  const canCatalog = can(s.ctx, "catalog.write");
  const editable = canCatalog ? (await listProducts(s.ctx, {})).map((p) => ({
    id: p.id, name: p.name, category: p.category, aliases: p.aliases,
    grades: rates.filter((r) => r.productId === p.id).map((r) => ({ id: r.gradeId, name: r.gradeName })),
  })).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const removed = canCatalog ? await listRemovedProducts(s.ctx, {}) : [];
  return (
    <>
      <PageHeader title="Rates" description={`${priced} of ${rates.length} grades have a current rate. Prices are per kg in INR, GST shown separately. Every change is kept in history.`}
        actions={canCatalog ? (
          <>
            {can(s.ctx, "rates.write") ? <Button asChild variant="outline"><Link href="/rates/import"><FileUp />Import price list</Link></Button> : null}
            {editable.length ? <EditProductButton products={editable} /> : null}
            <AddProductButton />
          </>
        ) : undefined} />
      {rates.length === 0 ? (
        <Card><EmptyState icon={<Tag />} title="No products yet">Add a product, or import your price list.</EmptyState></Card>
      ) : (
        <RatesEditor canEdit={can(s.ctx, "rates.write")} today={todayIST()} defaultBasis={settings.defaultPriceBasis} initialQuery={q}
          rows={rates.map((r) => ({
            gradeId: r.gradeId, productName: r.productName, category: r.category, gradeName: r.gradeName, price: r.pricePerKgInr, gst: r.gstPercent,
            moq: r.moqKg, basis: r.priceBasis ?? settings.defaultPriceBasis, pack: r.packSize, validFrom: r.validFrom, confirm: r.needsConfirmation, updatedAt: r.updatedAt?.toISOString() ?? null,
          }))} />
      )}
      {removed.length ? <RemovedProducts items={removed.map((p) => ({ id: p.id, name: p.name, removedAt: p.removedAt!.toISOString() }))} /> : null}
    </>
  );
}
