"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/primitives";
import { fromMap, newRowKey as k, toMap, type State } from "@/modules/catalog/price-list-map-edit";

export type CatalogChoice = { name: string; grades: string[] };

/**
 * The price list mapping as a form (GOAL G-KB-6): terms for every rate, each heading's GST and pack size, the
 * products whose terms differ, which name on the list is which product and grade, and the GST section at the end
 * of the list. `onSave` receives the mapping as JSON text (the same as pasting it).
 */
export function PriceListMapForm({ saved, catalog, pending, onSave }: { saved: unknown; catalog: CatalogChoice[]; pending: boolean; onSave: (json: string) => void }) {
  const [s, setS] = useState<State>(() => fromMap(saved));
  const [error, setError] = useState<string | null>(null);
  const grades = useMemo(() => new Map(catalog.map((c) => [c.name.toLowerCase(), c.grades])), [catalog]);
  const set = (patch: Partial<State>) => { setS((x) => ({ ...x, ...patch })); setError(null); };
  const row = <T extends { key: string }>(list: T[], key: string, patch: Partial<T>) => list.map((r) => (r.key === key ? { ...r, ...patch } : r));

  return (
    <form className="grid gap-5" onSubmit={(e) => {
      e.preventDefault();
      const r = toMap(s);
      if ("error" in r) return setError(r.error);
      onSave(JSON.stringify(r.map, null, 2));
    }}>
      <datalist id="pl-products">{catalog.map((c) => <option key={c.name} value={c.name} />)}</datalist>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">Every rate</legend>
        <Field label="Price basis" htmlFor="plm-basis" hint="For example Ex-factory"><Input id="plm-basis" value={s.basis} maxLength={80} onChange={(e) => set({ basis: e.target.value })} /></Field>
        <Field label="MOQ (kg)" htmlFor="plm-moq" hint="Empty = no MOQ on new rates"><Input id="plm-moq" inputMode="decimal" value={s.moq} onChange={(e) => set({ moq: e.target.value })} /></Field>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Headings on your list</legend>
        <p className="text-xs text-muted">Each heading (the line ending with “:”, such as “Proteins:”) gives the GST % and pack size of the items under it.</p>
        {s.headings.map((h) => (
          <div key={h.key} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end">
            <Field label="Heading" htmlFor={`h-${h.key}`}><Input id={`h-${h.key}`} value={h.heading} onChange={(e) => set({ headings: row(s.headings, h.key, { heading: e.target.value.replace(/:\s*$/, "") }) })} /></Field>
            <Field label="GST %" htmlFor={`hg-${h.key}`}><Input id={`hg-${h.key}`} inputMode="decimal" value={h.gst} onChange={(e) => set({ headings: row(s.headings, h.key, { gst: e.target.value }) })} /></Field>
            <Field label="Pack size" htmlFor={`hp-${h.key}`}><Input id={`hp-${h.key}`} value={h.pack} onChange={(e) => set({ headings: row(s.headings, h.key, { pack: e.target.value }) })} /></Field>
            <Field label="Category for new products" htmlFor={`hc-${h.key}`}><Input id={`hc-${h.key}`} value={h.category} placeholder="Same as heading" onChange={(e) => set({ headings: row(s.headings, h.key, { category: e.target.value }) })} /></Field>
            <Button type="button" variant="outline" aria-label={`Remove heading ${h.heading || "row"}`} onClick={() => set({ headings: s.headings.filter((x) => x.key !== h.key) })}><Trash2 /></Button>
          </div>
        ))}
        <div><Button type="button" variant="outline" onClick={() => set({ headings: [...s.headings, { key: k(), heading: "", gst: "", pack: "", category: "" }] })}><Plus />Add heading</Button></div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Products with different terms</legend>
        <p className="text-xs text-muted">Only for a product whose GST % or pack size is not the one of its heading.</p>
        {s.overrides.map((o) => (
          <div key={o.key} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Product" htmlFor={`o-${o.key}`}><Input id={`o-${o.key}`} list="pl-products" value={o.product} onChange={(e) => set({ overrides: row(s.overrides, o.key, { product: e.target.value }) })} /></Field>
            <Field label="GST %" htmlFor={`og-${o.key}`}><Input id={`og-${o.key}`} inputMode="decimal" value={o.gst} placeholder="Heading's" onChange={(e) => set({ overrides: row(s.overrides, o.key, { gst: e.target.value }) })} /></Field>
            <Field label="Pack size" htmlFor={`op-${o.key}`}><Input id={`op-${o.key}`} value={o.pack} placeholder="Heading's" onChange={(e) => set({ overrides: row(s.overrides, o.key, { pack: e.target.value }) })} /></Field>
            <Button type="button" variant="outline" aria-label={`Remove exception ${o.product || "row"}`} onClick={() => set({ overrides: s.overrides.filter((x) => x.key !== o.key) })}><Trash2 /></Button>
          </div>
        ))}
        <div><Button type="button" variant="outline" onClick={() => set({ overrides: [...s.overrides, { key: k(), product: "", gst: "", pack: "" }] })}><Plus />Add product exception</Button></div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Names on your list</legend>
        <p className="text-xs text-muted">Only for a name that is not the product&apos;s own name or one of its other names, or that means one grade. Type a new product name to have the import add it.</p>
        {s.lines.map((l) => {
          const gl = grades.get(l.product.trim().toLowerCase()) ?? [];
          return (
            <div key={l.key} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
              <Field label="Name on the list" htmlFor={`l-${l.key}`}><Input id={`l-${l.key}`} value={l.name} onChange={(e) => set({ lines: row(s.lines, l.key, { name: e.target.value }) })} /></Field>
              <Field label="Product" htmlFor={`lp-${l.key}`}><Input id={`lp-${l.key}`} list="pl-products" value={l.product} onChange={(e) => set({ lines: row(s.lines, l.key, { product: e.target.value }) })} /></Field>
              <Field label="Grade" htmlFor={`lg-${l.key}`}>
                <Input id={`lg-${l.key}`} list={`lgl-${l.key}`} value={l.grade} onChange={(e) => set({ lines: row(s.lines, l.key, { grade: e.target.value }) })} />
                <datalist id={`lgl-${l.key}`}>{(gl.length ? gl : ["Standard"]).map((g) => <option key={g} value={g} />)}</datalist>
              </Field>
              <Button type="button" variant="outline" aria-label={`Remove name ${l.name || "row"}`} onClick={() => set({ lines: s.lines.filter((x) => x.key !== l.key) })}><Trash2 /></Button>
              <Field label="Other spellings buyers use (comma separated, optional)" htmlFor={`la-${l.key}`} className="sm:col-span-4">
                <Input id={`la-${l.key}`} value={l.aliases} onChange={(e) => set({ lines: row(s.lines, l.key, { aliases: e.target.value }) })} />
              </Field>
            </div>
          );
        })}
        <div><Button type="button" variant="outline" onClick={() => set({ lines: [...s.lines, { key: k(), name: "", product: "", grade: "Standard", aliases: "" }] })}><Plus />Add name</Button></div>
      </fieldset>

      <Field label="GST section at the end of your list (optional)" htmlFor="plm-footer" hint="The lines your list ends with, one per line. When a new list has a different GST section, the import tells you, so a changed GST rate is not missed.">
        <Textarea id="plm-footer" rows={4} value={s.footer} onChange={(e) => set({ footer: e.target.value })} />
      </Field>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex justify-end"><Button type="submit" variant="outline" disabled={pending}>Save mapping</Button></div>
    </form>
  );
}
