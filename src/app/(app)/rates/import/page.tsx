import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { can } from "@/modules/core/permissions";
import { getOrgSettings } from "@/modules/core/service";
import { getCurrentRates } from "@/modules/catalog/service";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { PriceListImport } from "@/components/rates/price-list-import";

export const metadata: Metadata = { title: "Import price list" };

/** Rates → Import price list (GOAL G-KB-6): paste the list, read what would change, then apply it. */
export default async function ImportPriceListPage() {
  const s = await requireSession("rates.write");
  if (!can(s.ctx, "catalog.write")) redirect("/?denied=1");
  const [settings, rates] = await Promise.all([getOrgSettings(s.ctx, {}), getCurrentRates(s.ctx, {})]);
  // Products and their grades, for the mapping form's suggestions.
  const catalog = [...rates.reduce((m, r) => m.set(r.productName, [...(m.get(r.productName) ?? []), r.gradeName]), new Map<string, string[]>())]
    .map(([name, grades]) => ({ name, grades })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Import price list"
        description="Paste your price list to see what would change before anything is saved. Old rates stay in history; nothing is overwritten or removed."
        actions={<Button asChild variant="outline"><Link href="/rates"><ArrowLeft />Back to rates</Link></Button>} />
      <PriceListImport savedMap={settings.priceListMap ? JSON.stringify(settings.priceListMap, null, 2) : ""} catalog={catalog} />
    </>
  );
}
