"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/primitives";
import { createLeadAction } from "@/app/(app)/leads/actions";

const FIELDS: [string, string, string?][] = [
  ["contactName", "Buyer name"], ["companyName", "Company"], ["phone", "Phone", "tel"], ["email", "Email", "email"],
  ["city", "City"], ["state", "State"], ["productText", "Product"], ["quantityText", "Quantity"],
];

/** For phone inquiries and walk-ins (manual leads). Keeps what was typed if saving fails. */
export function NewLeadButton() {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}><Plus />New lead</Button>
      <DialogContent title="New lead" description="For phone calls and other inquiries that didn't arrive automatically.">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          for (const k of Object.keys(fd)) if (!fd[k]) delete fd[k];
          start(async () => {
            const r = await createLeadAction(fd);
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return void toast.error(r.error);
            }
            toast.success("Lead created");
            setOpen(false);
            router.push(`/leads/${r.leadId}`);
          });
        }}>
          {FIELDS.map(([name, label, type]) => (
            <Field key={name} label={label} htmlFor={`nl-${name}`} error={errors[name]}>
              <Input id={`nl-${name}`} name={name} type={type ?? "text"} required={name === "contactName"} aria-invalid={!!errors[name]} />
            </Field>
          ))}
          <Field label="Message / notes" htmlFor="nl-message" className="sm:col-span-2"><Textarea id="nl-message" name="message" rows={3} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create lead"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
