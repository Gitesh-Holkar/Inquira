import type { Metadata } from "next";
import { Tag } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { getCurrentRates } from "@/modules/catalog/service";
import { getOrgSettings } from "@/modules/core/service";
import { can } from "@/modules/core/permissions";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { RatesEditor } from "@/components/rates/rates-editor";
import { AddProductButton } from "@/components/rates/add-product";

export const metadata: Metadata = { title: "Rates" };

export default async function RatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession("catalog.read");
  const [{ q }, rates, settings] = await Promise.all([searchParams, getCurrentRates(s.ctx, {}), getOrgSettings(s.ctx, {})]);
  const priced = rates.filter((r) => r.pricePerKgInr).length;
  return (
    <>
      <PageHeader title="Rates" description={`${priced} of ${rates.length} grades have a current rate. Prices are per kg in INR, GST shown separately. Every change is kept in history.`}
        actions={can(s.ctx, "catalog.write") ? <AddProductButton /> : undefined} />
      {rates.length === 0 ? (
        <Card><EmptyState icon={<Tag />} title="No products yet">Run <code>npm run db:seed</code> to import the catalogue, or add a product.</EmptyState></Card>
      ) : (
        <RatesEditor canEdit={can(s.ctx, "rates.write")} today={todayIST()} defaultBasis={settings.defaultPriceBasis} initialQuery={q}
          rows={rates.map((r) => ({
            gradeId: r.gradeId, productName: r.productName, category: r.category, gradeName: r.gradeName, price: r.pricePerKgInr, gst: r.gstPercent,
            moq: r.moqKg, basis: r.priceBasis ?? settings.defaultPriceBasis, pack: r.packSize, validFrom: r.validFrom, confirm: r.needsConfirmation, updatedAt: r.updatedAt?.toISOString() ?? null,
          }))} />
      )}
    </>
  );
}
