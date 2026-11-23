"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, Field, Input, Select } from "@/components/ui/primitives";
import { createOutboundRuleAction, removeOutboundRuleAction, saveSendingAction } from "@/app/(app)/settings/actions";
import type { OutboundSettings } from "@/modules/outbound/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MODE_HELP = {
  shadow: "A person sends every message (recommended until the drafts need few edits).",
  assisted: "First quotations that pass every hold rule are sent automatically; everything else waits for a person.",
  automatic: "Also document replies and follow-ups that pass every rule are sent automatically.",
};

/** Settings → Sending (GOAL G-OUT-3, G-OUT-4, G-FUP-1, G-RPT-2). */
export function SendingForm({ s, isOwner, canEdit }: { s: OutboundSettings; isOwner: boolean; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <form className="grid gap-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const num = (k: string) => Number(f.get(k) ?? 0);
      const input: OutboundSettings = {
        modes: { email: String(f.get("mode")) as OutboundSettings["modes"]["email"] },
        paused: f.get("paused") === "on",
        window: { start: String(f.get("start")), end: String(f.get("end")), days: DAYS.map((_, i) => i).filter((i) => f.get(`day-${i}`) === "on") },
        caps: { perHour: num("perHour"), perDay: num("perDay") },
        followUpDays: num("followUpDays"),
        dailySummary: { enabled: f.get("summary") === "on", to: String(f.get("summaryTo") ?? "").split(",").map((x) => x.trim()).filter(Boolean) },
      };
      start(async () => {
        const r = await saveSendingAction(input);
        if (r.ok) toast.success("Saved"); else toast.error(r.error);
      });
    }}>
      <Field label="Email mode" htmlFor="snd-mode" hint={isOwner ? MODE_HELP[s.modes.email] : "Only an owner can change the mode."}>
        <Select id="snd-mode" name="mode" defaultValue={s.modes.email} disabled={!canEdit || !isOwner}>
          <option value="shadow">Shadow: a person sends everything</option>
          <option value="assisted">Assisted: clean first quotations go automatically</option>
          <option value="automatic">Automatic: also documents and follow-ups</option>
        </Select>
      </Field>
      {!isOwner ? <input type="hidden" name="mode" value={s.modes.email} /> : null}
      <p className="text-xs text-muted">WhatsApp is always sent by a person: Inquira opens the chat with the text filled in.</p>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="paused" defaultChecked={s.paused} disabled={!canEdit} className="size-4" /> Pause all automatic sending
      </label>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Send window (IST)</legend>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input type="time" name="start" defaultValue={s.window.start} aria-label="From" className="w-32" disabled={!canEdit} required /> to
          <Input type="time" name="end" defaultValue={s.window.end} aria-label="Until" className="w-32" disabled={!canEdit} required />
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {DAYS.map((d, i) => (
            <label key={d} className="flex min-h-11 items-center gap-1.5"><input type="checkbox" name={`day-${i}`} defaultChecked={s.window.days.includes(i)} disabled={!canEdit} className="size-4" />{d}</label>
          ))}
        </div>
        <p className="text-xs text-muted">Automatic messages outside the window wait for it. A person can send any time.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Automatic emails per hour" htmlFor="snd-h"><Input id="snd-h" name="perHour" type="number" min={0} max={500} defaultValue={s.caps.perHour} disabled={!canEdit} /></Field>
        <Field label="Automatic emails per day" htmlFor="snd-d"><Input id="snd-d" name="perDay" type="number" min={0} max={5000} defaultValue={s.caps.perDay} disabled={!canEdit} /></Field>
        <Field label="Follow up after (days)" htmlFor="snd-f" hint="0 = no follow-ups"><Input id="snd-f" name="followUpDays" type="number" min={0} max={60} defaultValue={s.followUpDays} disabled={!canEdit} /></Field>
      </div>
      <fieldset className="grid gap-2 border-t border-border pt-3">
        <legend className="pt-3 text-sm font-medium">Daily summary</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="summary" defaultChecked={s.dailySummary.enabled} disabled={!canEdit} className="size-4" /> Email a summary of the day at 7:30 PM IST (from your Gmail)</label>
        <Field label="Send it to (comma separated)" htmlFor="snd-to" hint="Empty = every owner"><Input id="snd-to" name="summaryTo" defaultValue={s.dailySummary.to.join(", ")} disabled={!canEdit} /></Field>
      </fieldset>
      {canEdit ? <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div> : <Alert tone="neutral" title="Read-only" />}
    </form>
  );
}

const RULE_KINDS = [
  ["buyer_email", "Buyer's email is", "name@buyer.com"],
  ["buyer_domain", "Buyer's email domain is", "buyer.com"],
  ["buyer_phone", "Buyer's phone is", "+91 98765 43210"],
  ["product", "Product is", "Pea Protein Isolate"],
  ["text_contains", "Enquiry mentions", "export, credit, discount…"],
] as const;

/** The team's own hold rules (G-OUT-9): every message that matches waits for a person. Add one here or from “Don't send”. */
export function TeamRules({ rules, canEdit, products = [] }: { rules: { id: string; matchType: string; pattern: string; note: string | null }[]; canEdit: boolean; products?: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<(typeof RULE_KINDS)[number][0]>("buyer_domain");
  // A product rule keeps the product's id; show its name (or say it was deleted).
  const shown = (r: { matchType: string; pattern: string }) => r.matchType === "product" ? (products.find((p) => p.id === r.pattern)?.name ?? "a deleted product") : r.pattern;
  const what = (t: string) => ({ buyer_email: "buyer email", buyer_domain: "buyer domain", buyer_phone: "buyer phone", product: "product", text_contains: "enquiry mentions" }[t] ?? t);
  return (
    <div className="grid gap-3">
      {!rules.length ? <p className="text-sm text-muted">None yet. Add one below, or choose “Don’t send” on a message and turn the reason into a rule.</p> : (
        <ul className="grid gap-2" aria-label="Team hold rules">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
              <span className="min-w-0 flex-1 break-words"><span className="text-muted">{what(r.matchType)}:</span> {shown(r)}{r.note ? <span className="text-muted"> · {r.note}</span> : null}</span>
              {canEdit ? (
                <ConfirmDialog danger title="Remove this rule?" confirmLabel="Remove" description="Messages that match it are no longer held because of it."
                  trigger={<Button size="sm" variant="outline" disabled={pending}><Trash2 />Remove</Button>}
                  onConfirm={() => start(async () => { const x = await removeOutboundRuleAction(r.id); if (x.ok) toast.success("Removed"); else toast.error(x.error); })} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form className="grid gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          start(async () => {
            const r = await createOutboundRuleAction({ matchType: kind, pattern: String(f.get("pattern") ?? ""), note: String(f.get("note") ?? "") });
            if (r.ok) { toast.success("Rule added: matching messages will wait for a person"); form.reset(); setKind("buyer_domain"); } else toast.error(r.error);
          });
        }}>
          <Field label="Hold a message when" htmlFor="tr-kind">
            <Select id="tr-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{RULE_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</Select>
          </Field>
          {kind === "product" ? (
            <Field label="Product" htmlFor="tr-pattern">
              <Select id="tr-pattern" name="pattern" required defaultValue=""><option value="" disabled>Choose a product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            </Field>
          ) : (
            <Field label="Value" htmlFor="tr-pattern"><Input key={kind} id="tr-pattern" name="pattern" required maxLength={200} placeholder={RULE_KINDS.find(([k]) => k === kind)![2]} /></Field>
          )}
          <Field label="Why (optional)" htmlFor="tr-note" className="sm:col-span-2"><Input id="tr-note" name="note" maxLength={200} placeholder="Existing distributor: the owner replies" /></Field>
          <div className="sm:col-span-2"><Button type="submit" variant="outline" disabled={pending}><Plus />Add rule</Button></div>
        </form>
      ) : null}
    </div>
  );
}
