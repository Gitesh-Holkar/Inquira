import Link from "next/link";
import type { Metadata } from "next";
import { ShoppingCart } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getBuyleadSummary, listBuyleadDecisions } from "@/modules/buyleads/service";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "IndiaMART" };

const DECISION = {
  contacted: { label: "Bought (old entry)", tone: "success" },
  would_contact: { label: "Suggested", tone: "info" },
  skipped: { label: "Skipped", tone: "neutral" },
} as const;

export default async function IndiaMartPage() {
  const s = await requireSession("buylead.decisions.read");
  const [summary, decisions] = await Promise.all([getBuyleadSummary(s.ctx, {}), listBuyleadDecisions(s.ctx, { limit: 100, sinceDays: 14 })]);
  return (
    <>
      <PageHeader
        title="IndiaMART Buy Leads"
        description={
          <>
            Buy Leads that Claude looked at for you: which ones it suggests and which it skipped, by your rules. You choose and click on IndiaMART; the buyer&apos;s details then arrive by email and become leads.{" "}
            <Link href="/settings?tab=buyleads" className="text-primary underline-offset-4 hover:underline">Edit rules</Link>
          </>
        }
      />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
          <span>Today: <strong>{summary.would_contact}</strong> suggested</span>
          <span><strong>{summary.skipped}</strong> skipped</span>
          <span>Suggestions left today: <strong>{summary.remaining_today}</strong> of {summary.daily_cap}</span>
        </CardContent>
      </Card>
      {decisions.length === 0 ? (
        <Card>
          <EmptyState icon={<ShoppingCart />} title="Nothing logged yet">
            Connect Claude (Settings → Claude connector), then ask it to go through today&apos;s Buy Leads with you. It suggests; you click on IndiaMART.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {decisions.map((d) => (
            <li key={d.id}>
              <Card className="p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={DECISION[d.decision].tone}>{DECISION[d.decision].label}</Badge>
                  {(d.meta as { over_cap?: boolean }).over_cap ? <Badge tone="danger">over the daily limit</Badge> : null}
                  <span className="text-xs text-muted">{formatDateTime(d.decidedAt)}</span>
                </div>
                <p className="mt-1 break-words font-medium">{d.leadTitle}</p>
                <p className="text-muted">{[d.product, d.location, d.quantity].filter(Boolean).join(" · ")}</p>
                <p className="mt-1 break-words">{d.reason}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
