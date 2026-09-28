"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { LEAD_STATUSES, STATUS_LABELS, type LeadStatus } from "@/modules/leads/types";
import { addNoteAction, setStatusAction, updateLeadAction } from "@/app/(app)/leads/actions";

export function StatusChanger({ leadId, status, disabled }: { leadId: string; status: LeadStatus; disabled?: boolean }) {
  const [value, setValue] = useState(status);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => {
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
          fields.isInternational = fd.get("isInternational") === "on";
          start(async () => {
            const r = await updateLeadAction(leadId, fields);
            if (r.ok) { toast.success("Lead saved"); setOpen(false); setErrors({}); } else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
          });
        }}>
          <Field label="Catalog product (used for quotes)" htmlFor="el-product" className="sm:col-span-2" hint="Pick the matching product so the quote uses its current rate.">
            <Select id="el-product" name="productId" defaultValue={lead.productId ?? ""}>
              <option value="">— Not matched —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
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
