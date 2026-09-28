"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, FileSignature, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/primitives";
import { whatsappUrl } from "@/lib/phone";
import { quoteAction, whatsappTextAction } from "@/app/(app)/leads/actions";

export function CopyButton({ value, label, compact }: { value: string; label: string; compact?: boolean }) {
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
      <Copy />{compact ? null : <span>Copy {label}</span>}
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

/** Opens an editable prefilled message, then wa.me (manual sending only; no WhatsApp automation). */
export function WhatsAppButton({ leadId, phone, compact, openRef }: { leadId: string; phone: string; compact?: boolean; openRef?: (open: () => void) => void }) {
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
      <DialogContent title="WhatsApp message" description="Edit the message, then open WhatsApp to send it yourself.">
        <Textarea aria-label="Message" rows={6} value={pending && !text ? "Loading…" : text} onChange={(e) => setText(e.target.value)} disabled={pending && !text} />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button asChild disabled={!text}>
            <a href={whatsappUrl(phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Open WhatsApp</a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function QuoteButton({ leadId, disabled, reason, compact, runRef }: { leadId: string; disabled?: boolean; reason?: string; compact?: boolean; runRef?: (run: () => void) => void }) {
  const [pending, start] = useTransition();
  const run = () => {
    if (disabled) {
      toast.info(reason ?? "Quotes are not available for this lead.");
      return;
    }
    start(async () => {
      const t = toast.loading("Creating Gmail draft…");
      const r = await quoteAction(leadId);
      toast.dismiss(t);
      if (!r.ok) return void toast.error(r.error);
      if (r.draftUrl) toast.success("Quotation draft created in Gmail", { action: { label: "Open draft", onClick: () => window.open(r.draftUrl!, "_blank", "noopener") }, duration: 10_000 });
      else toast.warning(r.warning ?? "Quotation saved, but no Gmail draft was created.", { duration: 10_000 });
    });
  };
  runRef?.(run);
  return (
    <Button variant={compact ? "outline" : "default"} size={compact ? "icon" : "touch"} onClick={run} disabled={pending} aria-disabled={disabled}
      aria-label="Create quote draft" title={disabled ? reason : "Create quote draft (q)"}>
      <FileSignature />{compact ? null : <span>{pending ? "Creating…" : "Create quote draft"}</span>}
    </Button>
  );
}
