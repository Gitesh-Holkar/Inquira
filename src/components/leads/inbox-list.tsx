"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SourceBadge, StatusBadge } from "@/components/status";
import { formatPhone } from "@/lib/phone";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeadSource, LeadStatus } from "@/modules/leads/types";
import { CallButton, CopyButton, QuoteButton, WhatsAppButton } from "./actions";

export type InboxLead = {
  id: string; status: LeadStatus; source: LeadSource; channel: string | null; productText: string | null; quantityText: string | null;
  city: string | null; state: string | null; country: string | null; contactName: string | null; companyName: string | null;
  phone: string | null; email: string | null; receivedAt: string; isInternational: boolean;
};

const SHORTCUTS = [["j / k", "Next / previous lead"], ["e or Enter", "Open lead"], ["w", "WhatsApp"], ["q", "Create quote draft"], ["?", "Show this help"]];

export function InboxList({ leads }: { leads: InboxLead[] }) {
  const router = useRouter();
  const [sel, setSel] = useState(0);
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
      <ul className="grid grid-cols-1 gap-2" aria-label="Leads">
        {leads.map((l, i) => {
          const where = [l.city, l.state, l.isInternational ? l.country : null].filter(Boolean).join(", ");
          return (
            <li key={l.id} ref={(el) => { rows.current[i] = el; }} data-selected={i === sel || undefined}
              className={cn("min-w-0 rounded-lg border border-border bg-surface shadow-card", i === sel && "ring-2 ring-ring")}
              onMouseEnter={() => setSel(i)}>
              <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
                <Link href={`/leads/${l.id}`} className="min-w-0 flex-1 rounded-md">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={l.status} />
                    <SourceBadge source={l.source} channel={l.channel} />
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
