import Link from "next/link";
import type { Metadata } from "next";
import { Inbox, Search } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { can } from "@/modules/core/permissions";
import { listLeads } from "@/modules/leads/service";
import { listProducts } from "@/modules/catalog/service";
import { INTENT_LABELS, LEAD_INTENTS, LEAD_SOURCES, LEAD_STATUSES, SOURCE_LABELS, STATUS_LABELS, type LeadIntent, type LeadSource, type LeadStatus } from "@/modules/leads/types";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Input, PageHeader, Select } from "@/components/ui/primitives";
import { InboxList } from "@/components/leads/inbox-list";
import { NewLeadButton } from "@/components/leads/new-lead";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads" };

type SP = { view?: string; status?: string; source?: string; product?: string; intent?: string; q?: string; from?: string; to?: string; page?: string };

const VIEWS = [["inbox", "Inbox"], ["details", "Needs details"], ["international", "International"]] as const;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession("leads.read");
  const sp = await searchParams;
  const view = sp.view === "international" ? "international" : sp.view === "details" ? "details" : "inbox";
  const intent = LEAD_INTENTS.includes(sp.intent as LeadIntent) ? (sp.intent as LeadIntent) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = LEAD_STATUSES.includes(sp.status as LeadStatus) ? (sp.status as LeadStatus) : undefined;
  const source = LEAD_SOURCES.includes(sp.source as LeadSource) ? (sp.source as LeadSource) : undefined;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? `${sp.from}T00:00:00+05:30` : undefined;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? `${sp.to}T23:59:59+05:30` : undefined;
  const productId = sp.product && /^[0-9a-f-]{36}$/.test(sp.product) ? sp.product : undefined;

  const [res, products] = await Promise.all([
    listLeads(s.ctx, {
      status, source, productId, intent, q: sp.q?.slice(0, 100) || undefined, from, to, page, pageSize: 25,
      international: view === "international" ? "only" : "exclude", needsDetails: view === "details" || undefined,
    }),
    listProducts(s.ctx, {}),
  ]);
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/leads?${p}`;
  };
  const filtered = !!(status || source || productId || intent || sp.q || from || to);
  const viewHref = (v: string) => (v === "inbox" ? "/leads" : `/leads?view=${v}`);

  return (
    <>
      <PageHeader title="Leads" description={`${res.total} ${view === "international" ? "international (parked, no quotes)" : view === "details" ? "leads without a product or intent" : "leads"}${filtered ? " matching filters" : ""}`}
        actions={can(s.ctx, "leads.create") ? <NewLeadButton /> : undefined} />
      <div role="tablist" aria-label="Lead views" className="mb-3 flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        {VIEWS.map(([v, label]) => (
          <Link key={v} role="tab" aria-selected={view === v} href={viewHref(v)}
            className={cn("flex-1 rounded-md px-2 py-2 text-center font-medium text-muted", view === v && "bg-surface text-foreground shadow-card")}>
            {label}
          </Link>
        ))}
      </div>
      <Card className="mb-4 p-3">
        <form className="grid grid-cols-2 gap-2 md:grid-cols-7" action="/leads" role="search">
          {view !== "inbox" ? <input type="hidden" name="view" value={view} /> : null}
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input name="q" defaultValue={sp.q} placeholder="Name, company, phone, product…" aria-label="Search leads" className="pl-9" />
          </div>
          <Select name="status" defaultValue={status ?? ""} aria-label="Status">
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABELS[x]}</option>)}
          </Select>
          <Select name="source" defaultValue={source ?? ""} aria-label="Source">
            <option value="">All sources</option>
            {LEAD_SOURCES.map((x) => <option key={x} value={x}>{SOURCE_LABELS[x]}</option>)}
          </Select>
          <Select name="product" defaultValue={productId ?? ""} aria-label="Product">
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select name="intent" defaultValue={intent ?? ""} aria-label="What the buyer wants">
            <option value="">Any request</option>
            {LEAD_INTENTS.map((x) => <option key={x} value={x}>{INTENT_LABELS[x]}</option>)}
          </Select>
          <div className="col-span-2 grid grid-cols-2 gap-2 md:col-span-1">
            <Button type="submit" className="w-full">Filter</Button>
            <Button asChild variant="outline" className="w-full"><Link href={viewHref(view)}>Clear</Link></Button>
          </div>
          <details className="col-span-2 md:col-span-7" open={!!(from || to)}>
            <summary className="cursor-pointer text-sm text-muted">Date range</summary>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-sm">
              <Input type="date" name="from" defaultValue={sp.from} aria-label="From date" />
              <Input type="date" name="to" defaultValue={sp.to} aria-label="To date" />
            </div>
          </details>
        </form>
      </Card>

      {res.items.length === 0 ? (
        <Card>
          <EmptyState icon={<Inbox />} title={filtered ? "No leads match these filters" : view === "international" ? "No international inquiries" : view === "details" ? "Nothing to complete" : "No leads yet"}
            action={filtered ? <Button asChild variant="outline"><Link href="/leads">Clear filters</Link></Button> : view === "inbox" && can(s.ctx, "integrations.manage") ? <Button asChild><Link href="/settings">Connect TradeIndia or Gmail</Link></Button> : undefined}>
            {filtered ? "Try a wider date range or clear the search." : view === "international" ? "Inquiries from outside India are parked here until USD pricing is supported." : view === "details" ? "Every open lead has a product and a request. Leads the rules and AI could not complete appear here for a person or Claude." : "No leads yet. Connect TradeIndia and Gmail in Settings and new inquiries will appear here within 10 minutes."}
          </EmptyState>
        </Card>
      ) : (
        <InboxList leads={res.items.map((l) => ({
          id: l.id, status: l.status, source: l.source, channel: l.channel, productText: l.productText, quantityText: l.quantityText,
          city: l.city, state: l.state, country: l.country, contactName: l.contactName, companyName: l.companyName, phone: l.phone, email: l.email,
          receivedAt: l.receivedAt.toISOString(), isInternational: l.isInternational,
          intent: l.intent, belowMoq: l.belowMoq, needsDetails: !!l.understoodAt && (!l.productId || !l.intent) && !["won", "lost", "not_relevant"].includes(l.status),
        }))} />
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2 text-sm">
          <Button asChild variant="outline" size="sm" aria-disabled={page <= 1} className={cn(page <= 1 && "pointer-events-none opacity-50")}><Link href={qs({ page: String(page - 1) })}>Previous</Link></Button>
          <span className="text-muted">Page {page} of {pages}</span>
          <Button asChild variant="outline" size="sm" aria-disabled={page >= pages} className={cn(page >= pages && "pointer-events-none opacity-50")}><Link href={qs({ page: String(page + 1) })}>Next</Link></Button>
        </nav>
      ) : null}
    </>
  );
}
