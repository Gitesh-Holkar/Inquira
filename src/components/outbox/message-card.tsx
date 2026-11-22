"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Mail, MessageCircle, Pencil, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { formatDateTime, formatRelative } from "@/lib/format";
import { PURPOSE_LABELS, STATE_LABELS, type MessagePurpose, type MessageState, type RuleMatchType } from "@/modules/outbound/types";
import { approveAction, editAction, rejectAction } from "@/app/(app)/outbox/actions";

export type MessageView = {
  id: string; channel: "email" | "whatsapp"; purpose: MessagePurpose; state: MessageState; toAddress: string | null; subject: string | null; body: string;
  holdReasons: { rule: string; detail: string }[]; mode: string; autoApproved: boolean; edited: boolean; templateVersion: number | null; documents: number;
  createdAt: string; sentAt: string | null; sentBy: string | null; error: string | null; cancelledReason: string | null;
  lead: { id: string; name: string; product: string | null; email: string | null } | null;
};

const TONE: Record<MessageState, "warning" | "info" | "success" | "danger" | "neutral"> = { held: "warning", draft: "info", approved: "info", sent: "success", failed: "danger", cancelled: "neutral" };

/** One prepared message with what a person can do with it (GOAL G-OUT-9: approve, edit, reject). */
export function MessageCard({ m, canAct }: { m: MessageView; canAct: boolean }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const open = ["draft", "held", "approved", "failed"].includes(m.state);
  const send = (confirmHeld: boolean) => start(async () => {
    const r = await approveAction(m.id, confirmHeld);
    if (!r.ok) return void toast.error(r.error);
    if (r.whatsappUrl) { window.open(r.whatsappUrl, "_blank", "noopener,noreferrer"); toast.success("WhatsApp opened. Recorded as sent."); }
    else toast.success("Sent");
  });
  const domain = m.lead?.email?.split("@")[1] ?? null;
  return (
    <li className="min-w-0 rounded-lg border border-border bg-surface p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <Badge tone={TONE[m.state]}>{STATE_LABELS[m.state]}</Badge>
        <Badge>{m.channel === "email" ? <Mail className="size-3" /> : <MessageCircle className="size-3" />}{m.channel === "email" ? "Email" : "WhatsApp"}</Badge>
        <span className="font-medium">{PURPOSE_LABELS[m.purpose]}</span>
        {m.lead ? <Link href={`/leads/${m.lead.id}`} className="min-w-0 truncate text-primary underline-offset-4 hover:underline">{m.lead.name}{m.lead.product ? ` · ${m.lead.product}` : ""}</Link> : null}
        <span className="ml-auto text-xs text-muted" title={formatDateTime(m.createdAt)}>{formatRelative(m.createdAt)}</span>
      </div>
      {m.holdReasons.length && m.state !== "sent" ? (
        <ul className="mt-2 grid gap-0.5 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" aria-label="Why it is held">
          {m.holdReasons.map((r) => <li key={r.rule + r.detail} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{r.detail}</li>)}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-muted">
        To {m.toAddress ?? "—"}{m.templateVersion ? ` · template version ${m.templateVersion}` : ""}{m.documents ? ` · ${m.documents} file${m.documents === 1 ? "" : "s"} attached` : ""}
        {m.autoApproved && m.state === "approved" ? " · will be sent automatically (mode " + m.mode + ")" : ""}{m.edited ? " · edited" : ""}
      </p>
      {m.subject && m.channel === "email" ? <p className="mt-1 text-sm"><span className="text-muted">Subject:</span> {m.subject}</p> : null}
      <details className="mt-1" open={m.state === "held" || m.state === "draft"}>
        <summary className="cursor-pointer text-sm text-muted">Message</summary>
        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-sans text-sm">{m.body}</pre>
      </details>
      {m.state === "sent" ? <p className="mt-2 text-xs text-muted">Sent {m.sentAt ? formatDateTime(m.sentAt) : ""}{m.sentBy?.startsWith("system:") ? " automatically" : ""}</p> : null}
      {m.error ? <p className="mt-2 text-sm text-danger">{m.error}</p> : null}
      {m.cancelledReason ? <p className="mt-2 text-xs text-muted">Cancelled: {m.cancelledReason}</p> : null}
      {canAct && open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.state === "held" ? (
            <ConfirmDialog title="Send although it is held?" confirmLabel={m.channel === "email" ? "Send anyway" : "Open WhatsApp anyway"}
              description={`Held because: ${m.holdReasons.map((r) => r.detail).join("; ")}. Only continue if you checked these.`}
              trigger={<Button size="sm" disabled={pending}><Send />{m.channel === "email" ? "Send" : "Open WhatsApp"}</Button>} onConfirm={() => send(true)} />
          ) : (
            <Button size="sm" disabled={pending} onClick={() => send(false)}><Send />{m.channel === "email" ? (m.state === "failed" ? "Try again" : "Send now") : "Open WhatsApp"}</Button>
          )}
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}><Pencil />Edit</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)}><X />Don&apos;t send</Button>
        </div>
      ) : null}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Edit message" description="Your Gmail signature is added when it is sent. An automatic message you edit waits for you to send it.">
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await editAction(m.id, m.channel === "email" ? String(fd.get("subject") ?? "") || null : null, String(fd.get("body") ?? ""));
              if (r.ok) { toast.success("Saved"); setEditing(false); } else toast.error(r.error);
            });
          }}>
            {m.channel === "email" ? <Field label="Subject" htmlFor={`s-${m.id}`}><Input id={`s-${m.id}`} name="subject" defaultValue={m.subject ?? ""} maxLength={300} /></Field> : null}
            <Field label="Message" htmlFor={`b-${m.id}`}><Textarea id={`b-${m.id}`} name="body" rows={12} defaultValue={m.body} required maxLength={10_000} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" disabled={pending}>Save</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent title="Don't send this message" description="Say why. You can also turn the correction into a rule that holds such messages from now on.">
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const kind = String(fd.get("rule") ?? "");
            const rule: { matchType: RuleMatchType; pattern: string } | null =
              kind === "buyer_email" && m.lead?.email ? { matchType: "buyer_email", pattern: m.lead.email }
              : kind === "buyer_domain" && domain ? { matchType: "buyer_domain", pattern: domain }
              : kind === "text_contains" && String(fd.get("words") ?? "").trim() ? { matchType: "text_contains", pattern: String(fd.get("words")).trim() }
              : null;
            start(async () => {
              const r = await rejectAction(m.id, String(fd.get("reason") ?? ""), rule);
              if (r.ok) { toast.success(r.rule ? "Not sent. Rule added." : "Not sent"); setRejecting(false); } else toast.error(r.error);
            });
          }}>
            <Field label="Why not" htmlFor={`r-${m.id}`}><Input id={`r-${m.id}`} name="reason" required maxLength={300} placeholder="For example: agent, not a buyer" /></Field>
            <Field label="From now on" htmlFor={`k-${m.id}`}>
              <Select id={`k-${m.id}`} name="rule" defaultValue="">
                <option value="">Just this message</option>
                {m.lead?.email ? <option value="buyer_email">Always hold messages to {m.lead.email}</option> : null}
                {domain ? <option value="buyer_domain">Always hold messages to anyone at {domain}</option> : null}
                <option value="text_contains">Always hold when the enquiry mentions…</option>
              </Select>
            </Field>
            <Field label="Words (for the last choice)" htmlFor={`w-${m.id}`}><Input id={`w-${m.id}`} name="words" maxLength={200} placeholder="for example: tender" /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setRejecting(false)}>Cancel</Button><Button type="submit" variant="danger" disabled={pending}>Don&apos;t send</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </li>
  );
}
