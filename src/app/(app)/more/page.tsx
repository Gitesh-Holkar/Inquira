import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { can } from "@/modules/core/permissions";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import { PAGE_PERMISSION } from "@/components/shell/nav-access";
import { Card, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "More" };

/** Phones: every page this person may open (the bottom bar has room for four). */
export default async function MorePage() {
  const s = await requireSession("dashboard.read");
  const pages = NAV_ITEMS.filter((i) => can(s.ctx, PAGE_PERMISSION[i.href]!));
  return (
    <>
      <PageHeader title="More" />
      <Card>
        <ul className="divide-y divide-border" aria-label="Pages">
          {pages.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-12 items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-surface-2">
                <Icon className="size-5 text-muted" aria-hidden />
                <span className="flex-1">{label}</span>
                <ChevronRight className="size-4 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
