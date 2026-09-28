"use client";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/primitives";
import { addProductAction } from "@/app/(app)/rates/actions";

export function AddProductButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}><Plus />Add product</Button>
      <DialogContent title="Add product" description="Add the rate on the Rates screen afterwards.">
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          start(async () => {
            const r = await addProductAction({ name: fd.name ?? "", category: fd.category ?? "", grades: fd.grades ?? "", aliases: fd.aliases ?? "" });
            if (r.ok) { toast.success("Product added"); setOpen(false); } else toast.error(r.error);
          });
        }}>
          <Field label="Name" htmlFor="ap-name"><Input id="ap-name" name="name" required minLength={2} /></Field>
          <Field label="Category" htmlFor="ap-cat"><Input id="ap-cat" name="category" placeholder="Proteins" /></Field>
          <Field label="Grades (comma separated)" htmlFor="ap-grades" hint="Leave empty for a single “Standard” grade"><Input id="ap-grades" name="grades" placeholder="30%, 50%" /></Field>
          <Field label="Other names buyers use (comma separated)" htmlFor="ap-alias"><Input id="ap-alias" name="aliases" placeholder="pea isolate protein, pea protein" /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>Add</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
