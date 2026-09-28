"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { saveOrgAction } from "@/app/(app)/settings/actions";

export function OrgForm({ quoteValidityDays, defaultPriceBasis, canEdit }: { quoteValidityDays: number; defaultPriceBasis: string; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await saveOrgAction({ quoteValidityDays: Number(f.get("days")), defaultPriceBasis: String(f.get("basis") ?? "") });
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
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>Save</Button>
        </div>
      ) : null}
    </form>
  );
}
