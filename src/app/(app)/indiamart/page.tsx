import Link from "next/link";
import type { Metadata } from "next";
import { ShoppingCart } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getBuyleadSummary, listBuyleadDecisions } from "@/modules/buyleads/service";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "IndiaMART" };

const DECISION = {
  contacted: { label: "Contacted", tone: "success" },
  would_contact: { label: "Would contact (test)", tone: "info" },
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
            Decisions logged by the Claude Cowork task (daily, ~11 AM IST). Buyer details then arrive by email and become leads.{" "}
            <Link href="/settings?tab=buyleads" className="text-primary underline-offset-4 hover:underline">Edit rules</Link>
          </>
        }
      />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
          <span>Today: <strong>{summary.contacted}</strong> contacted</span>
          <span><strong>{summary.would_contact}</strong> would contact (test)</span>
          <span><strong>{summary.skipped}</strong> skipped</span>
          <span>Remaining today: <strong>{summary.remaining_today}</strong> of {summary.daily_cap}</span>
          {summary.test_mode ? <Badge tone="info">Test mode ON</Badge> : <Badge tone="warning">Live mode</Badge>}
        </CardContent>
      </Card>
      {decisions.length === 0 ? (
        <Card>
          <EmptyState icon={<ShoppingCart />} title="No decisions logged yet">
            Set up the Cowork task with the prompt in docs/COWORK_INDIAMART_TASK.md. Start in test mode to check matching before any credits are spent.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {decisions.map((d) => (
            <li key={d.id}>
              <Card className="p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={DECISION[d.decision].tone}>{DECISION[d.decision].label}</Badge>
                  {d.testMode ? <Badge>test</Badge> : null}
                  {(d.meta as { over_cap?: boolean }).over_cap ? <Badge tone="danger">over daily cap</Badge> : null}
                  {(d.meta as { clicked_in_test_mode?: boolean }).clicked_in_test_mode ? <Badge tone="danger">clicked in test mode</Badge> : null}
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
