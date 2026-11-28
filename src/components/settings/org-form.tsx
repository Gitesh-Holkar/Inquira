"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { renameOrgAction, saveOrgAction } from "@/app/(app)/settings/actions";

/** Company name: owners only (it is printed on quotations and emails). */
export function CompanyNameForm({ name, isOwner }: { name: string; isOwner: boolean }) {
  const [pending, start] = useTransition();
  return (
    <form className="mb-4 grid gap-2 border-b border-border pb-4 sm:max-w-md" onSubmit={(e) => {
      e.preventDefault();
      const value = String(new FormData(e.currentTarget).get("orgName") ?? "").trim();
      start(async () => { const r = await renameOrgAction(value); if (r.ok) toast.success("Company name saved"); else toast.error(r.error); });
    }}>
      <Field label="Company name" htmlFor="org-name" hint={isOwner ? "Shown in Inquira and printed where a template uses {{org_name}}." : "Only an owner can change it."}>
        <Input id="org-name" name="orgName" required minLength={2} maxLength={120} defaultValue={name} disabled={!isOwner} />
      </Field>
      {isOwner ? <div><Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save name"}</Button></div> : null}
    </form>
  );
}

export type SamplePolicyView = { freeSampleSize: string | null; requiredDetails: string[]; note: string | null };

export function OrgForm({ quoteValidityDays, defaultPriceBasis, paymentTerms, samplePolicy, removeRepliedAfterDays, canEdit }: { quoteValidityDays: number; defaultPriceBasis: string; paymentTerms: string; samplePolicy: SamplePolicyView; removeRepliedAfterDays: number | null; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const text = (k: string) => String(f.get(k) ?? "").trim();
          const r = await saveOrgAction({
            quoteValidityDays: Number(f.get("days")), defaultPriceBasis: text("basis"), paymentTerms: text("payment"),
            removeRepliedAfterDays: text("removeDays") ? Number(text("removeDays")) : null,
            samplePolicy: {
              freeSampleSize: text("sampleSize") || null,
              requiredDetails: text("sampleDetails").split(",").map((x) => x.trim()).filter(Boolean),
              note: text("sampleNote") || null,
            },
          });
          if (r.ok) toast.success("Saved");
          else toast.error(r.error);
        });
      }}
    >
      <Field label="Quotation validity (days)" htmlFor="org-days" hint="“Valid until” date on new quotes">
        <Input id="org-days" name="days" type="number" min={1} max={60} defaultValue={quoteValidityDays} disabled={!canEdit} />
      </Field>
      <Field label="Default price basis" htmlFor="org-basis">
        <Input id="org-basis" name="basis" defaultValue={defaultPriceBasis} disabled={!canEdit} />
      </Field>
      <Field label="Payment terms" htmlFor="org-payment" hint="Printed on every quotation, for example “100% advance”. Leave empty to leave the line out.">
        <Input id="org-payment" name="payment" defaultValue={paymentTerms} maxLength={200} disabled={!canEdit} />
      </Field>
      <Field label="Remove replied leads after (days)" htmlFor="org-remove-days"
        hint="A lead leaves Leads → Replied this many days after its reply. It is kept hidden (so the same enquiry is never imported twice) and comes back if the buyer writes again. Empty = keep them.">
        <Input id="org-remove-days" name="removeDays" type="number" min={1} max={365} defaultValue={removeRepliedAfterDays ?? ""} disabled={!canEdit} />
      </Field>
      <fieldset className="grid gap-3 border-t border-border pt-3">
        <legend className="pt-3 text-sm font-semibold">Sample policy</legend>
        <p className="text-xs text-muted">Used for replies to sample requests. Which products have samples is set per product (Rates → Edit product). While the size is empty, sample replies wait for a person.</p>
        <Field label="Free sample size" htmlFor="org-sample-size" hint="As you would write it to a buyer, for example “250 g”">
          <Input id="org-sample-size" name="sampleSize" defaultValue={samplePolicy.freeSampleSize ?? ""} maxLength={60} disabled={!canEdit} />
        </Field>
        <Field label="Details the buyer must send (comma separated)" htmlFor="org-sample-details" hint="For example: Company name, GST number, Delivery address">
          <Input id="org-sample-details" name="sampleDetails" defaultValue={samplePolicy.requiredDetails.join(", ")} disabled={!canEdit} />
        </Field>
        <Field label="Anything else the reply should say" htmlFor="org-sample-note" hint="For example who pays for the courier">
          <Input id="org-sample-note" name="sampleNote" defaultValue={samplePolicy.note ?? ""} maxLength={300} disabled={!canEdit} />
        </Field>
      </fieldset>
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>Save</Button>
        </div>
      ) : null}
    </form>
  );
}
