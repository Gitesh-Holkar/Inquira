"use client";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { removeProductAction, updateProductAction } from "@/app/(app)/rates/actions";

export type EditableProduct = {
  id: string; name: string; category: string | null; aliases: string[]; grades: { id: string; name: string }[];
  hsnCode: string | null; leadTime: string | null; paymentTerms: string | null; sampleAvailable: boolean | null;
};

const SAMPLE_CHOICES = [
  ["", "Not decided", "Sample replies wait for a person"],
  ["yes", "Offered", "Sample replies offer a free sample"],
  ["no", "Not offered", "Sample replies say samples are not free"],
] as const;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Corrects a product: its name, category, the other names buyers use, its grades (rename, add, remove one no
 * longer sold) and its quotation terms. Prices are edited on the table. With `productId` it opens on that product
 * (the pencil on each product's row); without it, a picker comes first.
 */
export function EditProductButton({ products, productId }: { products: EditableProduct[]; productId?: string }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(productId ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [newGrades, setNewGrades] = useState<string[]>([]);
  const [draftGrade, setDraftGrade] = useState("");
  const [pending, start] = useTransition();
  const p = products.find((x) => x.id === id);
  const reset = () => { setId(productId ?? ""); setErrors({}); setRemoving(new Set()); setNewGrades([]); setDraftGrade(""); };
  const toggleRemove = (gid: string) => setRemoving((prev) => { const n = new Set(prev); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; });
  const addGrade = () => {
    const g = draftGrade.replace(/,/g, " ").trim();
    if (!g) return;
    const taken = [...(p?.grades.map((x) => x.name) ?? []), ...newGrades].some((x) => x.toLowerCase() === g.toLowerCase());
    if (taken) return void toast.error(`“${g}” is already a grade of this product`);
    setNewGrades((x) => [...x, g]);
    setDraftGrade("");
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      {productId ? (
        <Button variant="ghost" size="icon" aria-label={`Edit ${p?.name ?? "product"}`} title="Edit product" onClick={() => setOpen(true)}><Pencil /></Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}><Pencil />Edit product</Button>
      )}
      <DialogContent size="lg" title={p && productId ? `Edit ${p.name}` : "Edit product"} description="Prices are changed on the Rates table; nothing here changes a price or its history.">
        {productId ? null : (
          <Field label="Product" htmlFor="ep-pick" className="mb-4">
            <Select id="ep-pick" value={id} onChange={(e) => { setId(e.target.value); setErrors({}); setRemoving(new Set()); setNewGrades([]); }}>
              <option value="">Choose a product…</option>
              {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
        )}
        {p ? (
          <form key={p.id} className="grid gap-4" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const text = (k: string) => String(fd.get(k) ?? "");
            const pendingGrade = draftGrade.replace(/,/g, " ").trim();
            start(async () => {
              const r = await updateProductAction({
                productId: p.id, name: text("name"), category: text("category"), aliases: text("aliases"),
                grades: p.grades.filter((g) => !removing.has(g.id)).map((g) => ({ id: g.id, name: text(`grade-${g.id}`) })),
                newGrades: [...newGrades, ...(pendingGrade ? [pendingGrade] : [])].join(","),
                removeGrades: [...removing],
                hsnCode: text("hsnCode").trim(), leadTime: text("leadTime").trim(), paymentTerms: text("paymentTerms").trim(),
                sampleAvailable: text("sampleAvailable") as "" | "yes" | "no",
              });
              if (r.ok) { toast.success(removing.size ? `Product saved; ${removing.size} grade${removing.size === 1 ? "" : "s"} removed` : "Product saved"); setOpen(false); reset(); }
              else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
            });
          }}>
            <Section title="Product">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" htmlFor="ep-name" error={errors.name}><Input id="ep-name" name="name" required minLength={2} defaultValue={p.name} /></Field>
                <Field label="Category" htmlFor="ep-cat"><Input id="ep-cat" name="category" defaultValue={p.category ?? ""} /></Field>
              </div>
              <Field label="Other names buyers use" htmlFor="ep-alias" hint="Separate with commas. Used to match enquiries, Buy Leads and price list lines to this product.">
                <Input id="ep-alias" name="aliases" defaultValue={p.aliases.join(", ")} placeholder="for example: moong starch, mung bean starch" />
              </Field>
            </Section>

            <Section title="Grades" hint="A grade no longer sold can be removed: its rates stay in history, and adding the same name again brings it back.">
              <ul className="grid gap-2" aria-label="Grades">
                {p.grades.map((g) => {
                  const off = removing.has(g.id);
                  return (
                    <li key={g.id} className="flex items-center gap-2">
                      <Input name={`grade-${g.id}`} aria-label={`Grade ${g.name}`} required={!off} disabled={off} defaultValue={g.name} aria-invalid={!!errors.grades}
                        className={cn("min-w-0 flex-1", off && "line-through")} />
                      {off ? (
                        <Button type="button" variant="outline" size="touch" onClick={() => toggleRemove(g.id)} aria-label={`Keep grade ${g.name}`}><Undo2 /><span className="hidden sm:inline">Keep</span></Button>
                      ) : (
                        <Button type="button" variant="ghost" size="icon" className="size-11 text-danger" onClick={() => toggleRemove(g.id)} aria-label={`Remove grade ${g.name}`} title="Remove this grade"><Trash2 /></Button>
                      )}
                    </li>
                  );
                })}
                {newGrades.map((g) => (
                  <li key={`new-${g}`} className="flex items-center gap-2">
                    <span className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-dashed border-primary bg-primary-soft px-3 text-sm">{g} <span className="ml-2 text-xs text-muted">new</span></span>
                    <Button type="button" variant="ghost" size="icon" className="size-11" onClick={() => setNewGrades((x) => x.filter((y) => y !== g))} aria-label={`Don't add grade ${g}`}><X /></Button>
                  </li>
                ))}
              </ul>
              {removing.size ? <p className="text-xs text-warning">Removed grades leave the Rates table and quotations when you save.</p> : null}
              {errors.grades ? <p className="text-xs text-danger" role="alert">{errors.grades[0]}</p> : null}
              <div className="grid gap-1.5">
                <div className="flex items-end gap-2">
                  <Field label="New grade" htmlFor="ep-new" className="min-w-0 flex-1">
                    <Input id="ep-new" value={draftGrade} placeholder="for example 80%" maxLength={60}
                      onChange={(e) => setDraftGrade(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGrade(); } }} />
                  </Field>
                  <Button type="button" variant="outline" onClick={addGrade} disabled={!draftGrade.trim()}><Plus />Add grade</Button>
                </div>
                <p className="text-xs text-muted">Enter its rate on the Rates table afterwards.</p>
              </div>
            </Section>

            <Section title="Quotation terms" hint="Printed on quotations when filled. A reply that needs an empty term waits for a person.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="HSN code" htmlFor="ep-hsn" error={errors.hsnCode}><Input id="ep-hsn" name="hsnCode" inputMode="numeric" maxLength={10} defaultValue={p.hsnCode ?? ""} placeholder="for example 35040010" /></Field>
                <Field label="Lead time" htmlFor="ep-lead"><Input id="ep-lead" name="leadTime" maxLength={60} defaultValue={p.leadTime ?? ""} placeholder="for example 7 to 10 days" /></Field>
              </div>
              <Field label="Payment terms for this product" htmlFor="ep-pay" hint="Leave empty to use the company's payment terms (Settings → Organisation).">
                <Input id="ep-pay" name="paymentTerms" maxLength={200} defaultValue={p.paymentTerms ?? ""} />
              </Field>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-sm font-medium">Free samples</legend>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
                  {SAMPLE_CHOICES.map(([v, label]) => (
                    <label key={v} className="flex min-h-11 cursor-pointer items-center justify-center rounded-md px-2 text-center text-sm font-medium text-muted has-[:checked]:bg-surface has-[:checked]:text-foreground has-[:checked]:shadow-card has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                      <input type="radio" name="sampleAvailable" value={v} className="sr-only" defaultChecked={(p.sampleAvailable === null ? "" : p.sampleAvailable ? "yes" : "no") === v} />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted">Not decided: sample replies wait for a person. The sample size and details are in Settings → Organisation.</p>
              </fieldset>
            </Section>

            <DialogFooter>
              <DeleteProductButton product={p} onDone={() => { setOpen(false); reset(); }} label />
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save product"}</Button>
              </div>
            </DialogFooter>
          </form>
        ) : null}
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
        ? <Button type="button" variant="ghost" className="px-3 text-danger" disabled={pending} aria-label="Delete product" title="Delete product"><Trash2 /><span className="hidden sm:inline">Delete product</span></Button>
        : <Button type="button" variant="ghost" size="icon" className="text-danger" aria-label={`Delete ${product.name}`} title="Delete product" disabled={pending}><Trash2 /></Button>}
      onConfirm={() => start(async () => {
        const r = await removeProductAction(product.id);
        if (r.ok) { toast.success(`${product.name} deleted`); onDone?.(); } else toast.error(r.error);
      })} />
  );
}
