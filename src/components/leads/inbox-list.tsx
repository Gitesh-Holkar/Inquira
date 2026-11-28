"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCheck, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { deleteLeadsAction, markNotRepliedAction, markRepliedAction } from "@/app/(app)/leads/actions";
import { SourceBadge, StatusBadge } from "@/components/status";
import { formatPhone } from "@/lib/phone";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { INTENT_LABELS, type LeadIntent, type LeadSource, type LeadStatus } from "@/modules/leads/types";
import { Badge } from "@/components/ui/primitives";
import { CallButton, CopyButton, QuoteButton, WhatsAppButton } from "./actions";

export type InboxLead = {
  id: string; status: LeadStatus; source: LeadSource; channel: string | null; productText: string | null; quantityText: string | null;
  city: string | null; state: string | null; country: string | null; contactName: string | null; companyName: string | null;
  phone: string | null; email: string | null; receivedAt: string; isInternational: boolean;
  intent: LeadIntent | null; belowMoq: boolean | null; needsDetails: boolean; score: number;
  /** Reply state (the Not replied / Replied tabs). */
  repliedAt: string | null; outboxPending: boolean; buyerWroteAgain: boolean;
};

/** What the person may do with selected leads. */
export type BulkActions = { markReplied: boolean; markNotReplied: boolean; delete: boolean };

const SHORTCUTS = [["j / k", "Next / previous lead"], ["e or Enter", "Open lead"], ["w", "WhatsApp"], ["q", "Create quote draft"], ["?", "Show this help"]];

export function InboxList({ leads, bulk = { markReplied: false, markNotReplied: false, delete: false }, removeAfterDays = null }: { leads: InboxLead[]; bulk?: BulkActions; removeAfterDays?: number | null }) {
  const router = useRouter();
  const [sel, setSel] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const canPick = bulk.markReplied || bulk.markNotReplied || bulk.delete;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = leads.length > 0 && leads.every((l) => picked.has(l.id));
  const run = (fn: (ids: string[]) => Promise<{ ok: boolean; error?: string; data?: { count: number } }>, done: (n: number) => string) => start(async () => {
    const r = await fn([...picked]);
    if (r.ok) { toast.success(done(r.data?.count ?? picked.size)); setPicked(new Set()); router.refresh(); } else toast.error(r.error ?? "That did not work");
  });
  const [help, setHelp] = useState(false);
  const wa = useRef<Record<string, () => void>>({});
  const qt = useRef<Record<string, () => void>>({});
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const byKeyboard = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      // Enter on a focused button or link must activate that control, not open the selected lead.
      if (e.key === "Enter" && t.closest("a, button, summary, [role=button]")) return;
      const lead = leads[Math.min(sel, leads.length - 1)];
      if (e.key === "j") { byKeyboard.current = true; setSel((i) => Math.min(leads.length - 1, i + 1)); }
      else if (e.key === "k") { byKeyboard.current = true; setSel((i) => Math.max(0, i - 1)); }
      else if ((e.key === "e" || e.key === "Enter") && lead) router.push(`/leads/${lead.id}`);
      else if (e.key === "w" && lead) wa.current[lead.id]?.();
      else if (e.key === "q" && lead) qt.current[lead.id]?.();
      else if (e.key === "?") setHelp(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leads, sel, router]);

  useEffect(() => {
    // Only follow the selection when it moved via j/k (never on load or hover).
    if (!byKeyboard.current) return;
    byKeyboard.current = false;
    rows.current[sel]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);

  return (
    <>
      {canPick ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex min-h-11 items-center gap-2 px-1">
            <input type="checkbox" className="size-5" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(leads.map((l) => l.id)))} aria-label="Select all leads on this page" />
            Select all on this page
          </label>
        </div>
      ) : null}
      <ul className="grid grid-cols-1 gap-2" aria-label="Leads">
        {leads.map((l, i) => {
          const where = [l.city, l.state, l.isInternational ? l.country : null].filter(Boolean).join(", ");
          return (
            <li key={l.id} ref={(el) => { rows.current[i] = el; }} data-selected={i === sel || undefined}
              className={cn("min-w-0 rounded-lg border border-border bg-surface shadow-card", i === sel && "ring-2 ring-ring")}
              onMouseEnter={() => setSel(i)}>
              <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
                {canPick ? (
                  <label className="-m-1 flex size-11 shrink-0 items-center justify-center self-start md:self-center" title="Select">
                    <input type="checkbox" className="size-5" checked={picked.has(l.id)} onChange={() => toggle(l.id)}
                      aria-label={`Select ${l.contactName ?? l.companyName ?? "lead"}: ${l.productText ?? "product not stated"}`} />
                  </label>
                ) : null}
                <Link href={`/leads/${l.id}`} className="min-w-0 flex-1 rounded-md">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={l.status} />
                    <SourceBadge source={l.source} channel={l.channel} />
                    {l.intent && l.intent !== "new_enquiry" ? <Badge tone="info">{INTENT_LABELS[l.intent]}</Badge> : null}
                    {l.belowMoq ? <Badge tone="warning">Below MOQ</Badge> : null}
                    {l.needsDetails ? <Badge tone="warning">Needs details</Badge> : null}
                    {l.buyerWroteAgain ? <Badge tone="warning">Buyer wrote again</Badge> : null}
                    {l.outboxPending ? <Badge tone="info" title="A message for this lead waits, is held or failed in the Outbox">In Outbox</Badge> : null}
                    {l.repliedAt && !l.outboxPending && !l.buyerWroteAgain ? (
                      <Badge tone="success" title={removeAfterDays ? `Leaves this list ${removeAfterDays} days after the reply` : undefined}>Replied {formatRelative(l.repliedAt)}</Badge>
                    ) : null}
                    <Badge tone={l.score >= 70 ? "success" : l.score >= 40 ? "info" : "neutral"} title="Lead score: product, quantity against MOQ and buyer details">Score {l.score}</Badge>
                    <span className="ml-auto text-xs text-muted md:ml-0" title={formatDateTime(l.receivedAt)}>{formatRelative(l.receivedAt)}</span>
                  </div>
                  <p className="mt-1.5 truncate font-semibold">{l.productText ?? "Product not stated"}{l.quantityText ? <span className="font-normal text-muted"> · {l.quantityText}</span> : null}</p>
                  <p className="truncate text-sm text-muted">
                    {[l.contactName, l.companyName].filter(Boolean).join(" · ") || "Unknown buyer"}{where ? ` · ${where}` : ""}
                  </p>
                  {l.phone ? <p className="text-sm tabular-nums">{formatPhone(l.phone)}</p> : null}
                </Link>
                <div className="flex flex-wrap gap-2 md:flex-nowrap">
                  {l.phone ? (
                    <>
                      <WhatsAppButton leadId={l.id} phone={l.phone} compact openRef={(fn) => (wa.current[l.id] = fn)} />
                      <CallButton phone={l.phone} compact />
                      <CopyButton value={formatPhone(l.phone)} label="phone" compact />
                    </>
                  ) : null}
                  {l.email ? <CopyButton value={l.email} label="email" compact icon="email" /> : null}
                  <QuoteButton leadId={l.id} compact disabled={l.isInternational} reason="Quotes are disabled for international leads (no USD pricing yet)." runRef={(fn) => (qt.current[l.id] = fn)} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {picked.size ? (
        <div role="region" aria-label="Selected leads" className="sticky bottom-20 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 shadow-card lg:bottom-4">
          <span className="text-sm"><strong>{picked.size}</strong> selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {bulk.markReplied ? (
              <ConfirmDialog title={`Mark ${picked.size} as replied?`} confirmLabel="Mark as replied"
                description="Use this when you answered on WhatsApp, by phone or outside Inquira. Messages Inquira prepared for these leads and has not sent are stopped, so nobody gets a second answer."
                trigger={<Button disabled={pending}><CheckCheck />Mark as replied</Button>}
                onConfirm={() => run(markRepliedAction, (n) => `${n} marked as replied`)} />
            ) : null}
            {bulk.markNotReplied ? (
              <Button variant="outline" disabled={pending} onClick={() => run(markNotRepliedAction, (n) => `${n} moved to Not replied`)}><Undo2 />Move to Not replied</Button>
            ) : null}
            {bulk.delete ? (
              <ConfirmDialog danger title={`Delete ${picked.size} lead${picked.size === 1 ? "" : "s"}?`} confirmLabel="Delete"
                description="They leave every list, and their unsent messages are stopped. Use this for spam, tests and duplicates."
                trigger={<Button variant="outline" className="text-danger" disabled={pending}><Trash2 />Delete</Button>}
                onConfirm={() => run(deleteLeadsAction, (n) => `${n} deleted`)} />
            ) : null}
            <Button variant="ghost" onClick={() => setPicked(new Set())} aria-label="Clear the selection"><X />Clear</Button>
          </div>
        </div>
      ) : null}
      <p className="mt-3 hidden text-xs text-muted lg:block">Tip: press <kbd className="rounded border border-border px-1">?</kbd> for keyboard shortcuts.</p>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent title="Keyboard shortcuts">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="contents"><dt><kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt><dd>{d}</dd></div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
