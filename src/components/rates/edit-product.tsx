"use client";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/primitives";
import { removeProductAction, updateProductAction } from "@/app/(app)/rates/actions";

export type EditableProduct = { id: string; name: string; category: string | null; aliases: string[]; grades: { id: string; name: string }[] };

/**
 * Corrects a product: its name, category, the other names buyers use, and its grades. Grades can be
 * renamed and added but not removed, because their rates are history. Prices are edited on the table.
 * "Remove product" takes a discontinued product out of the catalogue; Rates → Removed products restores it.
 */
export function EditProductButton({ products }: { products: EditableProduct[] }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const p = products.find((x) => x.id === id);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setId(""); setErrors({}); } }}>
      <Button variant="outline" onClick={() => setOpen(true)}><Pencil />Edit product</Button>
      <DialogContent title="Edit product" description="Fix a name, add the other names buyers use, or add a grade. Rates and their history stay as they are.">
        <div className="grid gap-3">
          <Field label="Product" htmlFor="ep-pick">
            <Select id="ep-pick" value={id} onChange={(e) => { setId(e.target.value); setErrors({}); }}>
              <option value="">Choose a product…</option>
              {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          {p ? (
            <form key={p.id} className="grid gap-3" onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const text = (k: string) => String(fd.get(k) ?? "");
              start(async () => {
                const r = await updateProductAction({
                  productId: p.id, name: text("name"), category: text("category"), aliases: text("aliases"),
                  grades: p.grades.map((g) => ({ id: g.id, name: text(`grade-${g.id}`) })), newGrades: text("newGrades"),
                });
                if (r.ok) { toast.success("Product saved"); setOpen(false); setId(""); setErrors({}); }
                else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
              });
            }}>
              <Field label="Name" htmlFor="ep-name" error={errors.name}><Input id="ep-name" name="name" required minLength={2} defaultValue={p.name} /></Field>
              <Field label="Category" htmlFor="ep-cat"><Input id="ep-cat" name="category" defaultValue={p.category ?? ""} /></Field>
              <Field label="Other names buyers use (comma separated)" htmlFor="ep-alias" hint="Used to match enquiries, Buy Leads and price list lines to this product">
                <Input id="ep-alias" name="aliases" defaultValue={p.aliases.join(", ")} />
              </Field>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Grades</legend>
                {p.grades.map((g) => (
                  <Input key={g.id} name={`grade-${g.id}`} aria-label={`Grade ${g.name}`} required defaultValue={g.name} aria-invalid={!!errors.grades} />
                ))}
                {errors.grades ? <p className="text-xs text-danger" role="alert">{errors.grades[0]}</p> : null}
              </fieldset>
              <Field label="Add grades (comma separated)" htmlFor="ep-new" hint="Enter their rates on the Rates screen afterwards"><Input id="ep-new" name="newGrades" placeholder="30%, 50%" /></Field>
              <div className="flex flex-wrap justify-between gap-2">
                <ConfirmDialog danger title={`Remove ${p.name}?`} confirmLabel="Remove product"
                  description="It disappears from rates, quotations, lead matching and Buy Lead suggestions. Its rates and history are kept, and you can restore it under Rates → Removed products."
                  trigger={<Button type="button" variant="outline" disabled={pending}><Trash2 />Remove product</Button>}
                  onConfirm={() => start(async () => {
                    const r = await removeProductAction(p.id);
                    if (r.ok) { toast.success(`${p.name} removed`); setOpen(false); setId(""); } else toast.error(r.error);
                  })} />
                <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save product"}</Button></div>
              </div>
            </form>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
