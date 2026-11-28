"use client";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/primitives";
import { addProductAction } from "@/app/(app)/rates/actions";

/** Rates → Add product: name, category (suggested from the existing ones), grades, other names. Its rate is entered on the table. */
export function AddProductButton({ categories = [] }: { categories?: string[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}><Plus />Add product</Button>
      <DialogContent title="Add product" description="Enter its rate on the Rates table afterwards.">
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          start(async () => {
            const r = await addProductAction({ name: fd.name ?? "", category: fd.category ?? "", grades: fd.grades ?? "", aliases: fd.aliases ?? "" });
            if (r.ok) { toast.success("Product added"); setOpen(false); } else toast.error(r.error);
          });
        }}>
          <Field label="Name" htmlFor="ap-name"><Input id="ap-name" name="name" required minLength={2} /></Field>
          <Field label="Category" htmlFor="ap-cat" hint="Pick one of yours, or type a new one">
            <Input id="ap-cat" name="category" list="ap-cats" placeholder="Proteins" />
            <datalist id="ap-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Grades" htmlFor="ap-grades" hint="Separate with commas. Leave empty for one “Standard” grade."><Input id="ap-grades" name="grades" placeholder="30%, 50%" /></Field>
          <Field label="Other names buyers use" htmlFor="ap-alias" hint="Separate with commas"><Input id="ap-alias" name="aliases" placeholder="pea isolate protein, pea protein" /></Field>
          <DialogFooter className="justify-end"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add product"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
