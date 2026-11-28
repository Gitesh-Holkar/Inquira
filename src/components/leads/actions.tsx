"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AtSign, Copy, FileSignature, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/primitives";
import { whatsappUrl } from "@/lib/phone";
import { formatDate } from "@/lib/format";
import type { DocumentType } from "@/modules/documents/types";
import { quoteAction, whatsappSentAction, whatsappTextAction } from "@/app/(app)/leads/actions";

export function CopyButton({ value, label, compact, icon }: { value: string; label: string; compact?: boolean; icon?: "email" }) {
  return (
    <Button variant="outline" size={compact ? "icon" : "touch"} aria-label={`Copy ${label}`} title={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.success(`${label[0]!.toUpperCase() + label.slice(1)} copied`);
        } catch {
          toast.error("Couldn't copy. Select and copy it manually.");
        }
      }}>
      {icon === "email" ? <AtSign /> : <Copy />}{compact ? null : <span>Copy {label}</span>}
    </Button>
  );
}

export function CallButton({ phone, compact }: { phone: string; compact?: boolean }) {
  return (
    <Button asChild variant="outline" size={compact ? "icon" : "touch"}>
      <a href={`tel:${phone}`} aria-label="Call" title="Call"><Phone />{compact ? null : <span>Call</span>}</a>
    </Button>
  );
}

/**
 * Opens an editable prefilled message, then wa.me (manual sending only; no WhatsApp automation). Opening WhatsApp
 * counts as sent for this lead (owner's request of 28 Nov 2026); "Move to Pending" undoes a mistake. `record` is off
 * for people who may not send messages: WhatsApp still opens, nothing is recorded.
 */
export function WhatsAppButton({ leadId, phone, compact, openRef, record = true }: { leadId: string; phone: string; compact?: boolean; openRef?: (open: () => void) => void; record?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const load = () => {
    setOpen(true);
    start(async () => {
      const r = await whatsappTextAction(leadId);
      if (r.ok) setText(r.data.text);
      else toast.error(r.error);
    });
  };
  openRef?.(load);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size={compact ? "icon" : "touch"} onClick={load} aria-label="WhatsApp" title="WhatsApp (w)" className="text-success">
        <MessageCircle />{compact ? null : <span>WhatsApp</span>}
      </Button>
      <DialogContent title="WhatsApp message" description={record ? "Edit the message, then open WhatsApp to send it. Opening it counts as sent." : "Edit the message, then open WhatsApp to send it yourself."}>
        <Textarea aria-label="Message" rows={6} value={pending && !text ? "Loading…" : text} onChange={(e) => setText(e.target.value)} disabled={pending && !text} />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          {text.trim() ? (
            <Button asChild>
              <a href={whatsappUrl(phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => {
                setOpen(false);
                if (record) void whatsappSentAction(leadId, text).then((r) => { if (!r.ok) toast.error(r.error); });
              }}>Open WhatsApp</a>
            </Button>
          ) : (
            <Button disabled>Open WhatsApp</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type AttachableDocument = { type: DocumentType; label: string; fileName: string; batch: string | null; expiryDate: string | null };

/**
 * Creates the quotation draft. When valid documents exist for the lead's product (`documents`), it first
 * asks which to attach; the server attaches the latest valid file of each chosen type, never an expired one.
 */
export function QuoteButton({ leadId, disabled, reason, compact, runRef, documents = [] }: {
  leadId: string; disabled?: boolean; reason?: string; compact?: boolean; runRef?: (run: () => void) => void; documents?: AttachableDocument[];
}) {
  const [pending, start] = useTransition();
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<DocumentType[]>([]);
  const create = (attach: DocumentType[]) => {
    setChoosing(false);
    start(async () => {
      const t = toast.loading("Creating Gmail draft…");
      const r = await quoteAction(leadId, undefined, attach);
      toast.dismiss(t);
      if (!r.ok) return void toast.error(r.error);
      if (r.draftUrl) {
        toast.success(r.attached?.length ? `Quotation draft created in Gmail with ${r.attached.join(", ")}` : "Quotation draft created in Gmail",
          { action: { label: "Open draft", onClick: () => window.open(r.draftUrl!, "_blank", "noopener") }, duration: 10_000 });
        if (r.warning) toast.warning(r.warning, { duration: 10_000 });
      } else toast.warning(r.warning ?? "Quotation saved, but no Gmail draft was created.", { duration: 10_000 });
    });
  };
  const run = () => {
    if (disabled) {
      toast.info(reason ?? "Quotes are not available for this lead.");
      return;
    }
    if (documents.length) setChoosing(true);
    else create([]);
  };
  runRef?.(run);
  return (
    <Dialog open={choosing} onOpenChange={setChoosing}>
      <Button variant={compact ? "outline" : "default"} size={compact ? "icon" : "touch"} onClick={run} disabled={pending} aria-disabled={disabled}
        aria-label="Create quote draft" title={disabled ? reason : "Create quote draft (q)"}>
        <FileSignature />{compact ? null : <span>{pending ? "Creating…" : "Create quote draft"}</span>}
      </Button>
      <DialogContent title="Attach documents?" description="The latest valid file of each type you tick is attached to the Gmail draft. Expired files are never attached.">
        <fieldset className="grid gap-2">
          <legend className="sr-only">Documents to attach</legend>
          {documents.map((d) => (
            <label key={d.type} className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <input type="checkbox" className="size-4" checked={picked.includes(d.type)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.type] : p.filter((x) => x !== d.type)))} />
              <span className="min-w-0 flex-1 break-words"><strong>{d.label}</strong> · {d.fileName}{d.batch ? ` · batch ${d.batch}` : ""}{d.expiryDate ? ` · valid until ${formatDate(d.expiryDate)}` : ""}</span>
            </label>
          ))}
        </fieldset>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => create([])}>Without attachments</Button>
          <Button onClick={() => create(picked)} disabled={!picked.length}>Create draft with {picked.length || "no"} file{picked.length === 1 ? "" : "s"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
