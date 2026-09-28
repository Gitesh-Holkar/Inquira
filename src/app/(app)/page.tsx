import Link from "next/link";
import type { Metadata } from "next";
import { AlertCircle, CheckCircle2, Inbox, ListChecks, Mail, ShoppingCart, Globe2 } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getDashboard } from "@/modules/dashboard/service";
import { SOURCE_LABELS, LEAD_SOURCES } from "@/modules/leads/types";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({ label, value, href, icon, tone }: { label: string; value: number | string; href?: string; icon: React.ReactNode; tone?: string }) {
  const inner = (
    <Card className="h-full transition-colors hover:border-primary">
      <CardContent className="flex items-center gap-3 py-4">
        <div className={`grid size-10 shrink-0 place-items-center rounded-md ${tone ?? "bg-primary-soft text-primary"} [&_svg]:size-5`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-none">{value}</p>
          <p className="mt-1 truncate text-sm text-muted">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block rounded-lg">{inner}</Link> : inner;
}

export default async function DashboardPage() {
  const s = await requireSession("dashboard.read");
  const d = await getDashboard(s.ctx, {});
  const r = d.reconciliation;
  return (
    <>
      <PageHeader title="Today" description={`Signed in to ${s.orgName}`} actions={<Button asChild><Link href="/leads">Open lead inbox</Link></Button>} />
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New leads today" value={d.newTodayTotal} href="/leads" icon={<Inbox />} />
        <Stat label="Need action" value={d.needingAction} href="/leads?status=new" icon={<AlertCircle />} tone="bg-info-soft text-info" />
        <Stat label="Review queue" value={r.pendingReview + r.olderBacklog} href="/review" icon={<ListChecks />} tone="bg-danger-soft text-danger" />
        <Stat label="International (parked)" value={d.international} href="/leads?view=international" icon={<Globe2 />} tone="bg-warning-soft text-warning" />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>New leads by source</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {LEAD_SOURCES.map((src) => (
                <li key={src} className="flex items-center justify-between text-sm">
                  <span>{SOURCE_LABELS[src]}</span>
                  <span className="font-semibold tabular-nums">{d.newToday[src] ?? 0}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Email reconciliation</CardTitle><Mail className="size-4 text-muted" aria-hidden /></CardHeader>
          <CardContent>
            <p className="text-sm" data-testid="reconciliation">
              <strong>{r.received}</strong> received today, <strong>{r.classified}</strong> classified, <strong>{r.pendingReview}</strong> pending review
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${r.classified} of ${r.received} classified`}>
              <div className="h-full bg-primary" style={{ width: `${r.received ? Math.round((r.classified / r.received) * 100) : 100}%` }} />
            </div>
            {r.olderBacklog > 0 ? <p className="mt-2 text-xs text-muted">Plus {r.olderBacklog} older emails still waiting for review.</p> : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(r.byClass).map(([k, v]) => <Badge key={k}>{k.replace("_", " ")}: {v}</Badge>)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Integration health</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {d.integrations.map((i) => (
              <div key={i.provider} className="flex items-start gap-3 text-sm">
                {i.status === "connected" ? <CheckCircle2 className="mt-0.5 size-4 text-success" aria-hidden /> : <AlertCircle className="mt-0.5 size-4 text-warning" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.provider === "gmail" ? "Gmail" : "TradeIndia"} <Badge tone={i.status === "connected" ? "success" : i.status === "not_connected" || i.status === "configured" ? "neutral" : "danger"}>{i.status.replace("_", " ")}</Badge></p>
                  <p className="text-muted">
                    {i.lastSuccessAt ? <>Last sync {formatRelative(i.lastSuccessAt)} <span className="hidden sm:inline">({formatDateTime(i.lastSuccessAt)})</span></> : "Never synced"}
                    {i.account ? ` · ${i.account}` : ""}
                  </p>
                  {i.lastError ? <p className="mt-1 break-words text-danger">Last error {i.lastErrorAt ? formatRelative(i.lastErrorAt) : ""}: {i.lastError}</p> : null}
                </div>
              </div>
            ))}
            <Link href="/settings" className="text-sm text-primary underline-offset-4 hover:underline">Manage integrations</Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>IndiaMART today</CardTitle>
            <ShoppingCart className="size-4 text-muted" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-sm" data-testid="indiamart-card">
              <strong>{d.indiamart.testMode ? d.indiamart.would_contact : d.indiamart.contacted}</strong> {d.indiamart.testMode ? "would be contacted (test mode)" : "contacted by Cowork"},{" "}
              <strong>{d.indiamart.skipped}</strong> skipped, <strong>{d.indiamart.arrivedByEmail}</strong> arrived by email
            </p>
            <p className="mt-1 text-xs text-muted">Daily cap {d.indiamart.dailyCap}{d.indiamart.testMode ? " · test mode is ON (no clicking)" : ""}</p>
            <Link href="/indiamart" className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline">Decision log</Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
