"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/primitives";
import { TEMPLATE_PURPOSES, TEMPLATE_PURPOSE_LABELS, WHATSAPP_PURPOSES, type TemplatePurpose } from "@/modules/templates/engine";
import { prepareAction } from "@/app/(app)/outbox/actions";

/** A person asks for a message from a template for this lead; it lands in the Outbox, checked like any other. */
export function PrepareMessageButton({ leadId, hasEmail, hasPhone }: { leadId: string; hasEmail: boolean; hasPhone: boolean }) {
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<TemplatePurpose>("first_quotation");
  const [pending, start] = useTransition();
  const channels = [hasEmail ? "email" : null, hasPhone && WHATSAPP_PURPOSES.includes(purpose) ? "whatsapp" : null].filter(Boolean) as ("email" | "whatsapp")[];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!hasEmail && !hasPhone}><PenLine />Prepare a message</Button>
      <DialogContent title="Prepare a message" description="Built from your template, today's rate and the product's terms. It goes to the Outbox; nothing is sent until you send it there.">
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          const channel = String(new FormData(e.currentTarget).get("channel")) as "email" | "whatsapp";
          start(async () => {
            const r = await prepareAction(leadId, purpose, channel);
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.state === "held" ? "Prepared, but held: see the reasons in the Outbox" : "Prepared: it waits in the Outbox");
            setOpen(false);
          });
        }}>
          <Field label="Kind of message" htmlFor={`pm-p-${leadId}`}>
            <Select id={`pm-p-${leadId}`} value={purpose} onChange={(e) => setPurpose(e.target.value as TemplatePurpose)}>
              {TEMPLATE_PURPOSES.map((p) => <option key={p} value={p}>{TEMPLATE_PURPOSE_LABELS[p]}</option>)}
            </Select>
          </Field>
          <Field label="Channel" htmlFor={`pm-c-${leadId}`}>
            <Select id={`pm-c-${leadId}`} name="channel" key={channels.join()} defaultValue={channels[0]}>
              {channels.map((c) => <option key={c} value={c}>{c === "email" ? "Email" : "WhatsApp"}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !channels.length}>Prepare</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
