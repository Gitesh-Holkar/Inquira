import Link from "next/link";
import type { Metadata } from "next";
import { Send } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { can } from "@/modules/core/permissions";
import { getOutboundSettings, getOutboxCounts, listOutbox } from "@/modules/outbound/service";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { MessageCard, type MessageView } from "@/components/outbox/message-card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Outbox" };

const VIEWS = [["review", "Needs a person"], ["waiting", "Waiting to send"], ["sent", "Sent"], ["stopped", "Not sent"]] as const;
type View = (typeof VIEWS)[number][0];

/** Every message Inquira prepared (GOAL G-OUT-1, G-OUT-9): held and ready ones for a person, automatic ones waiting, sent. */
export default async function OutboxPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const s = await requireSession("quotes.read");
  const sp = await searchParams;
  const view: View = VIEWS.some(([v]) => v === sp.view) ? (sp.view as View) : "review";
  const page = Math.max(1, Number(sp.page) || 1);
  const [res, counts, sending] = await Promise.all([
    listOutbox(s.ctx, { view, page }), getOutboxCounts(s.ctx, {}), can(s.ctx, "settings.read") ? getOutboundSettings(s.ctx, {}) : Promise.resolve(null),
  ]);
  const mode = sending?.settings.modes.email;
  const items: MessageView[] = res.items.map((m) => ({
    id: m.id, channel: m.channel as MessageView["channel"], purpose: m.purpose as MessageView["purpose"], state: m.state as MessageView["state"], toAddress: m.toAddress,
    subject: m.subject, body: m.body, holdReasons: m.holdReasons, mode: m.mode, autoApproved: m.autoApproved, edited: m.edited, templateVersion: m.templateVersion,
    documents: m.documentIds.length, createdAt: m.createdAt.toISOString(), sentAt: m.sentAt?.toISOString() ?? null, sentBy: m.sentBy, error: m.error, cancelledReason: m.cancelledReason,
    lead: m.lead ? { id: m.lead.id, name: m.lead.contactName ?? m.lead.companyName ?? "Buyer", product: m.lead.productText, email: m.lead.email } : null,
  }));
  return (
    <>
      <PageHeader title="Outbox" description="Replies Inquira prepared from your templates and rates. Held ones say why. Email is sent from your Gmail with your signature; WhatsApp opens on your phone." />
      {mode ? (
        <Alert tone={mode === "shadow" ? "info" : "warning"} className="mb-3" title={mode === "shadow" ? "Mode: shadow — a person sends every message" : `Mode: ${mode} — clean ${mode === "assisted" ? "first quotations" : "quotations, document replies and follow-ups"} are sent automatically`}>
          {sending?.settings.paused ? "Automatic sending is paused. " : ""}Change it under <Link href="/settings?tab=sending" className="underline underline-offset-2">Settings → Sending</Link>.
        </Alert>
      ) : null}
      <nav aria-label="Outbox views" className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1 text-sm sm:flex">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={v === "review" ? "/outbox" : `/outbox?view=${v}`} aria-current={view === v ? "page" : undefined}
            className={cn("flex min-h-11 flex-1 items-center justify-center rounded-md px-2 py-2 text-center font-medium text-muted", view === v && "bg-surface text-foreground shadow-card")}>
            {label}{v === "review" && counts.review ? ` (${counts.review})` : v === "waiting" && counts.waiting ? ` (${counts.waiting})` : ""}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<Send />} title={view === "review" ? "Nothing waits for a person" : view === "waiting" ? "Nothing waits to be sent" : view === "sent" ? "Nothing sent yet" : "Nothing stopped"}>
            {view === "review" ? "New enquiries get a reply prepared within minutes of arriving. Held ones and drafts appear here." : "Messages appear here as they move along."}
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-2" aria-label="Messages">
          {items.map((m) => <MessageCard key={m.id} m={m} canAct={can(s.ctx, "quotes.create")} />)}
        </ul>
      )}
      {res.more || page > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex justify-between text-sm">
          {page > 1 ? <Link className="text-primary" href={`/outbox?view=${view}&page=${page - 1}`}>Previous</Link> : <span />}
          {res.more ? <Link className="text-primary" href={`/outbox?view=${view}&page=${page + 1}`}>Next</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
