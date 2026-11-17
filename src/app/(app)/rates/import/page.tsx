import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { can } from "@/modules/core/permissions";
import { getOrgSettings } from "@/modules/core/service";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { PriceListImport } from "@/components/rates/price-list-import";

export const metadata: Metadata = { title: "Import price list" };

/** Rates → Import price list (GOAL G-KB-6): paste the list, read what would change, then apply it. */
export default async function ImportPriceListPage() {
  const s = await requireSession("rates.write");
  if (!can(s.ctx, "catalog.write")) redirect("/?denied=1");
  const settings = await getOrgSettings(s.ctx, {});
  return (
    <>
      <PageHeader title="Import price list"
        description="Paste your price list to see what would change before anything is saved. Old rates stay in history; nothing is overwritten or removed."
        actions={<Button asChild variant="outline"><Link href="/rates"><ArrowLeft />Back to rates</Link></Button>} />
      <PriceListImport savedMap={settings.priceListMap ? JSON.stringify(settings.priceListMap, null, 2) : ""} />
    </>
  );
}
