"use client";
import { useState, useTransition } from "react";
import { Pencil, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { removeProductAction, updateProductAction } from "@/app/(app)/rates/actions";

export type EditableProduct = {
  id: string; name: string; category: string | null; aliases: string[]; grades: { id: string; name: string }[];
  hsnCode: string | null; leadTime: string | null; paymentTerms: string | null; sampleAvailable: boolean | null;
};

/**
 * Corrects a product: its name, category, the other names buyers use, its grades (rename, add, remove one no
 * longer sold) and its commercial terms. Prices are edited on the table. With `productId` it opens on that
 * product (the pencil on each product's row); without it, a picker comes first (the page's "Edit product").
 */
export function EditProductButton({ products, productId }: { products: EditableProduct[]; productId?: string }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(productId ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const p = products.find((x) => x.id === id);
  const reset = () => { setId(productId ?? ""); setErrors({}); setRemoving(new Set()); };
  const toggleRemove = (gid: string) => setRemoving((prev) => { const n = new Set(prev); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      {productId ? (
        <Button variant="ghost" size="icon" aria-label={`Edit ${p?.name ?? "product"}`} title="Edit product" onClick={() => setOpen(true)}><Pencil /></Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}><Pencil />Edit product</Button>
      )}
      <DialogContent title={p && productId ? `Edit ${p.name}` : "Edit product"} description="Fix a name, add the other names buyers use, add or remove a grade, fill the terms. Rates and their history stay as they are.">
        <div className="grid gap-3">
          {productId ? null : (
            <Field label="Product" htmlFor="ep-pick">
              <Select id="ep-pick" value={id} onChange={(e) => { setId(e.target.value); setErrors({}); setRemoving(new Set()); }}>
                <option value="">Choose a product…</option>
                {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
          )}
          {p ? (
            <form key={p.id} className="grid gap-3" onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const text = (k: string) => String(fd.get(k) ?? "");
              start(async () => {
                const r = await updateProductAction({
                  productId: p.id, name: text("name"), category: text("category"), aliases: text("aliases"),
                  grades: p.grades.filter((g) => !removing.has(g.id)).map((g) => ({ id: g.id, name: text(`grade-${g.id}`) })), newGrades: text("newGrades"),
                  removeGrades: [...removing],
                  hsnCode: text("hsnCode").trim(), leadTime: text("leadTime").trim(), paymentTerms: text("paymentTerms").trim(),
                  sampleAvailable: text("sampleAvailable") as "" | "yes" | "no",
                });
                if (r.ok) { toast.success(removing.size ? `Product saved; ${removing.size} grade${removing.size === 1 ? "" : "s"} removed` : "Product saved"); setOpen(false); reset(); }
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
                {p.grades.map((g) => {
                  const off = removing.has(g.id);
                  return (
                    <div key={g.id} className="flex items-center gap-2">
                      <Input name={`grade-${g.id}`} aria-label={`Grade ${g.name}`} required={!off} disabled={off} defaultValue={g.name} aria-invalid={!!errors.grades}
                        className={cn("min-w-0 flex-1", off && "line-through opacity-60")} />
                      <Button type="button" variant="outline" onClick={() => toggleRemove(g.id)} aria-pressed={off}
                        aria-label={off ? `Keep grade ${g.name}` : `Remove grade ${g.name}`}>{off ? <><Undo2 />Keep</> : <><Trash2 />Remove</>}</Button>
                    </div>
                  );
                })}
                {removing.size ? <p className="text-xs text-warning">Removed grades leave the Rates screen and quotations when you save. Their rates stay in history; add the same name again to bring one back.</p> : null}
                {errors.grades ? <p className="text-xs text-danger" role="alert">{errors.grades[0]}</p> : null}
              </fieldset>
              <Field label="Add grades (comma separated)" htmlFor="ep-new" hint="Enter their rates on the Rates screen afterwards"><Input id="ep-new" name="newGrades" placeholder="30%, 50%" /></Field>
              <fieldset className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <legend className="pt-3 text-sm font-medium">Commercial terms</legend>
                <p className="text-xs text-muted sm:col-span-2">Printed on quotations when filled. A term the reply needs that is empty makes the reply wait for a person.</p>
                <Field label="HSN code" htmlFor="ep-hsn" error={errors.hsnCode}><Input id="ep-hsn" name="hsnCode" inputMode="numeric" maxLength={10} defaultValue={p.hsnCode ?? ""} /></Field>
                <Field label="Lead time" htmlFor="ep-lead" hint="For example “7 to 10 days”"><Input id="ep-lead" name="leadTime" maxLength={60} defaultValue={p.leadTime ?? ""} /></Field>
                <Field label="Payment terms for this product" htmlFor="ep-pay" hint="Empty = the company's terms" className="sm:col-span-2"><Input id="ep-pay" name="paymentTerms" maxLength={200} defaultValue={p.paymentTerms ?? ""} /></Field>
                <Field label="Free samples" htmlFor="ep-sample" className="sm:col-span-2">
                  <Select id="ep-sample" name="sampleAvailable" defaultValue={p.sampleAvailable === null ? "" : p.sampleAvailable ? "yes" : "no"}>
                    <option value="">Not decided (sample replies wait for a person)</option>
                    <option value="yes">Offered</option>
                    <option value="no">Not offered</option>
                  </Select>
                </Field>
              </fieldset>
              <div className="flex flex-wrap justify-between gap-2">
                <DeleteProductButton product={p} onDone={() => { setOpen(false); reset(); }} label />
                <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save product"}</Button></div>
              </div>
            </form>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deletes a product (it is no longer sold): it leaves rates, quotations, lead matching and Buy Lead suggestions.
 * Its rates and history are kept, and Rates → Deleted products brings it back.
 */
export function DeleteProductButton({ product, onDone, label }: { product: { id: string; name: string }; onDone?: () => void; label?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <ConfirmDialog danger title={`Delete ${product.name}?`} confirmLabel="Delete product"
      description="It disappears from rates, quotations, lead matching and Buy Lead suggestions. Its rates and history are kept, and you can bring it back under Rates → Deleted products."
      trigger={label
        ? <Button type="button" variant="outline" className="text-danger" disabled={pending}><Trash2 />Delete product</Button>
        : <Button type="button" variant="ghost" size="icon" className="text-danger" aria-label={`Delete ${product.name}`} title="Delete product" disabled={pending}><Trash2 /></Button>}
      onConfirm={() => start(async () => {
        const r = await removeProductAction(product.id);
        if (r.ok) { toast.success(`${product.name} deleted`); onDone?.(); } else toast.error(r.error);
      })} />
  );
}
