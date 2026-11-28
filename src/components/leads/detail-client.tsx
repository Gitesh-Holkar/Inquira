"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { INTENT_LABELS, LEAD_INTENTS, LEAD_STATUSES, STATUS_LABELS, type LeadStatus } from "@/modules/leads/types";
import { addNoteAction, deleteLeadAction, markNotRepliedAction, markRepliedAction, removeNoteAction, setStatusAction, updateLeadAction } from "@/app/(app)/leads/actions";
import { formatRelative } from "@/lib/format";

/** For spam, tests and duplicates. A real enquiry that went nowhere should be marked Lost or Not relevant instead. */
export function DeleteLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <ConfirmDialog danger title="Delete this lead?" confirmLabel="Delete lead"
      description="It disappears from the inbox, the dashboard and Claude. Use this for spam, tests and duplicates; for a real enquiry that went nowhere, set the status to Lost or Not relevant instead."
      trigger={<Button variant="outline" size="sm" disabled={pending}><Trash2 />Delete</Button>}
      onConfirm={() => start(async () => {
        const r = await deleteLeadAction(leadId);
        if (!r.ok) return void toast.error(r.error);
        toast.success("Lead deleted");
        router.push("/leads");
      })} />
  );
}

export function StatusChanger({ leadId, status, disabled }: { leadId: string; status: LeadStatus; disabled?: boolean }) {
  const [value, setValue] = useState(status);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="grid gap-2" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await setStatusAction(leadId, value, reason);
        if (r.ok) { toast.success(r.message ?? "Saved"); setReason(""); } else toast.error(r.error);
      });
    }}>
      <Select aria-label="Status" value={value} onChange={(e) => setValue(e.target.value as LeadStatus)} disabled={disabled}>
        {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </Select>
      <Input aria-label="Reason (optional)" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} disabled={disabled} maxLength={500} />
      <Button type="submit" disabled={disabled || pending || value === status}>{pending ? "Saving…" : "Update status"}</Button>
    </form>
  );
}

export function NoteForm({ leadId, disabled }: { leadId: string; disabled?: boolean }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="grid gap-2" onSubmit={(e) => {
      e.preventDefault();
      if (!body.trim()) return;
      start(async () => {
        const r = await addNoteAction(leadId, body);
        if (r.ok) { toast.success("Note added"); setBody(""); } else toast.error(r.error); // text kept on error
      });
    }}>
      <Textarea aria-label="New note" placeholder="Add a note (called, sent COA, asked for sample…)" rows={3} value={body} onChange={(e) => setBody(e.target.value)} disabled={disabled} maxLength={4000} />
      <div className="flex justify-end"><Button type="submit" size="sm" disabled={disabled || pending || !body.trim()}>{pending ? "Saving…" : "Add note"}</Button></div>
    </form>
  );
}

type EditLead = { [k: string]: string | null | boolean; productId: string | null; isInternational: boolean };
const FIELDS: [string, string][] = [["contactName", "Buyer name"], ["companyName", "Company"], ["phone", "Phone"], ["email", "Email"], ["city", "City"], ["state", "State"], ["country", "Country"], ["productText", "Product (as written)"], ["quantityText", "Quantity"]];

export function EditLeadButton({ leadId, lead, products }: { leadId: string; lead: EditLead; products: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Pencil />Edit</Button>
      <DialogContent title="Edit lead">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const fields: Record<string, string | boolean | null> = {};
          for (const [k] of FIELDS) fields[k] = String(fd.get(k) ?? "");
          fields.productId = String(fd.get("productId") ?? "") || null;
          fields.intent = String(fd.get("intent") ?? "") || null;
          fields.isInternational = fd.get("isInternational") === "on";
          // Send kg only when it was changed here; otherwise it follows the quantity text.
          const kg = String(fd.get("quantityKg") ?? "").trim();
          const sentKg: number | null | undefined = kg === String(lead.quantityKg ?? "") ? undefined : kg ? Number(kg) : null;
          start(async () => {
            const r = await updateLeadAction(leadId, fields, sentKg);
            if (r.ok) { toast.success("Lead saved"); setOpen(false); setErrors({}); } else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
          });
        }}>
          <Field label="Catalog product (used for quotes)" htmlFor="el-product" className="sm:col-span-2" hint="Pick the matching product so the quote uses its current rate.">
            <Select id="el-product" name="productId" defaultValue={lead.productId ?? ""}>
              <option value="">— Not matched —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="What the buyer wants" htmlFor="el-intent">
            <Select id="el-intent" name="intent" defaultValue={String(lead.intent ?? "")}>
              <option value="">— Not set —</option>
              {LEAD_INTENTS.map((i) => <option key={i} value={i}>{INTENT_LABELS[i]}</option>)}
            </Select>
          </Field>
          <Field label="Quantity in kg" htmlFor="el-kg" error={errors.quantityKg} hint="Filled from the quantity text when it states a weight.">
            <Input id="el-kg" name="quantityKg" type="number" inputMode="decimal" min="0" step="any" defaultValue={String(lead.quantityKg ?? "")} />
          </Field>
          {FIELDS.map(([k, label]) => (
            <Field key={k} label={label} htmlFor={`el-${k}`} error={errors[k]}>
              <Input id={`el-${k}`} name={k} defaultValue={String(lead[k] ?? "")} aria-invalid={!!errors[k]} />
            </Field>
          ))}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="isInternational" defaultChecked={lead.isInternational} className="size-4" /> International inquiry (no quotes until USD pricing)
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Removes one note (a typo, the wrong lead); its text stays in the audit trail. */
export function RemoveNoteButton({ noteId }: { noteId: string }) {
  const [pending, start] = useTransition();
  return (
    <ConfirmDialog danger title="Remove this note?" confirmLabel="Remove note" description="It leaves the timeline. Its text stays in the audit trail."
      trigger={<Button type="button" variant="ghost" size="sm" className="text-muted" disabled={pending} aria-label="Remove note"><Trash2 />Remove</Button>}
      onConfirm={() => start(async () => { const r = await removeNoteAction(noteId); if (r.ok) toast.success("Note removed"); else toast.error(r.error); })} />
  );
}

const REPLY_TEXT = {
  not_replied: "Pending: not replied yet.",
  outbox: "Pending: a message for this lead waits, is held or failed in the Outbox.",
  buyer_wrote: "The buyer wrote again after your reply.",
  replied: "Replied",
} as const;

/** Lead page → Reply: whether this lead is answered, with Mark as replied (answered outside Inquira) or the undo. */
export function ReplyState({ leadId, state, repliedAt, canEdit }: { leadId: string; state: keyof typeof REPLY_TEXT; repliedAt: string | null; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2 text-sm">
      <p>{state === "replied" && repliedAt ? `Replied ${formatRelative(repliedAt)}.` : REPLY_TEXT[state]}</p>
      {canEdit ? (
        state === "replied" ? (
          <div><Button variant="outline" disabled={pending} onClick={() => start(async () => {
            const r = await markNotRepliedAction([leadId]);
            if (r.ok) toast.success("Moved to Pending"); else toast.error(r.error);
          })}>Move to Pending</Button></div>
        ) : (
          <div>
            <ConfirmDialog title="Mark as replied?" confirmLabel="Mark as replied"
              description="Use this when you answered on WhatsApp, by phone or outside Inquira. Messages Inquira prepared for this lead and has not sent are stopped."
              trigger={<Button variant="outline" disabled={pending}>Mark as replied</Button>}
              onConfirm={() => start(async () => {
                const r = await markRepliedAction([leadId]);
                if (r.ok) toast.success("Marked as replied"); else toast.error(r.error);
              })} />
          </div>
        )
      ) : null}
    </div>
  );
}
