"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, Card, CardContent, CardHeader, CardTitle, Field, Textarea } from "@/components/ui/primitives";
import { applyPriceListAction, planPriceListAction, savePriceListMapAction, type PriceListPreview } from "@/app/(app)/rates/actions";
import { PriceListMapForm, type CatalogChoice } from "./price-list-map-form";

const rates = (n: number) => `${n} rate${n === 1 ? "" : "s"}`;

/**
 * Two steps: "Show changes" only reads and lists what the pasted list would do; "Apply" writes exactly
 * that. Editing the text after a preview hides the preview, so what is applied is what was shown.
 *
 * The mapping (folded away below the list) is the company's own reading of its list: which heading has
 * which GST % and pack size, and which name on the list is which product. It is edited as a form; a mapping
 * someone prepared can also be pasted as text. `savedMap` is its JSON text; `catalog` fills the product lists.
 */
export function PriceListImport({ savedMap, catalog = [] }: { savedMap: string; catalog?: CatalogChoice[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [map, setMap] = useState(savedMap);
  const [current, setCurrent] = useState(savedMap);
  const [formKey, setFormKey] = useState(0);
  const [hasMap, setHasMap] = useState(!!savedMap);
  const [preview, setPreview] = useState<PriceListPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const show = () => start(async () => {
    setError(null);
    const r = await planPriceListAction(text);
    if (r.ok) setPreview(r.data);
    else { setPreview(null); setError(r.error); }
  });
  const saveMap = (json: string, fromText: boolean) => start(async () => {
    const r = await savePriceListMapAction(json);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Mapping saved");
    setHasMap(true);
    setPreview(null);
    setCurrent(json);
    setMap(json);
    if (fromText) setFormKey((n) => n + 1); // show the pasted mapping in the form
  });
  const parsedCurrent = (() => { try { return current ? JSON.parse(current) : {}; } catch { return {}; } })();
  const apply = () => start(async () => {
    const r = await applyPriceListAction(text);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Saved ${rates(r.data.ratesWritten)}`);
    router.push("/rates");
  });

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-3 pt-4">
          <Field label="Price list" htmlFor="pl-text" hint="One item per line, as in your own list: “Pea Isolate Protein - 350 Rs/Kg”. Headings such as “Proteins:” can stay. Copy the text from Word or Excel and paste it here.">
            <Textarea id="pl-text" rows={12} value={text} placeholder={"Proteins:\nPea Isolate Protein - 350 Rs/Kg"}
              onChange={(e) => { setText(e.target.value); setPreview(null); setError(null); }} />
          </Field>
          <div className="flex justify-end">
            <Button onClick={show} disabled={pending || text.trim().length < 5}>{pending && !preview ? "Reading…" : "Show changes"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <details open={!hasMap}>
            <summary className="cursor-pointer py-3 text-sm font-semibold">How Inquira reads your list (mapping){hasMap ? "" : ": not set yet"}</summary>
            <div className="mt-2 grid gap-3">
              <p className="text-sm text-muted">
                This tells Inquira which heading on your list has which GST % and pack size, the MOQ and price basis for every rate, and which name on the list is which product.
                Without it, lines are matched by product names only, and a product that is not in the catalogue cannot be added. Prices are never part of it: they come from the list.
              </p>
              <PriceListMapForm key={formKey} saved={parsedCurrent} catalog={catalog} pending={pending} onSave={(json) => saveMap(json, false)} />
              <details className="rounded-md border border-border px-3">
                <summary className="cursor-pointer py-3 text-sm font-medium">Paste a mapping as text instead</summary>
                <div className="grid gap-2 pb-3">
                  <Field label="Mapping" htmlFor="pl-map" hint="Paste the mapping exactly as it was given to you, then save. Prices are never part of it.">
                    <Textarea id="pl-map" rows={8} className="font-mono text-xs sm:text-xs" spellCheck={false} value={map} onChange={(e) => setMap(e.target.value)} />
                  </Field>
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => saveMap(map, true)} disabled={pending || map.trim().length < 2 || map === current}>Save pasted mapping</Button>
                  </div>
                </div>
              </details>
            </div>
          </details>
        </CardContent>
      </Card>

      {error ? <Alert tone="danger" title="This list could not be read">{error}</Alert> : null}

      {preview ? (
        <Card data-testid="price-list-preview">
          <CardHeader>
            <CardTitle>What will change</CardTitle>
            <p className="text-sm text-muted">
              {preview.counts.read} lines read: {preview.counts.toWrite} to save, {preview.counts.unchanged} unchanged{preview.counts.problems ? `, ${preview.counts.problems} with a problem` : ""}.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            {preview.counts.read === 0 ? <Alert tone="warning" title="No prices were found in this text">Each item needs a name, a dash and a price per kg, for example “Pea Isolate Protein - 350 Rs/Kg”.</Alert> : null}
            {preview.sections.map((s) => {
              const lines = (
                <ul className="mt-1 grid gap-1 text-sm">
                  {s.lines.map((l, i) => <li key={i} className="break-words rounded-md bg-surface-2 px-2 py-1">{l}</li>)}
                </ul>
              );
              const count = <span className="font-normal text-muted">({s.lines.length})</span>;
              return (
                <section key={s.title} aria-label={s.title}>
                  {s.folded ? (
                    <details>
                      <summary className="cursor-pointer py-3 text-sm font-semibold">{s.title} {count}</summary>
                      {lines}
                    </details>
                  ) : (
                    <>
                      <h3 className="text-sm font-semibold">{s.title} {count}</h3>
                      {lines}
                    </>
                  )}
                </section>
              );
            })}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {preview.counts.toWrite === 0 ? <p className="text-sm text-muted">Nothing to save: your rates already match this list.</p> : (
                <ConfirmDialog title={`Save ${rates(preview.counts.toWrite)}?`} confirmLabel="Save rates" onConfirm={apply}
                  description="New rates start today and are used for new quotations. Today's rates move to history. Lines listed under “Will NOT be written” are left out."
                  trigger={<Button disabled={pending}>{pending ? "Saving…" : `Apply ${preview.counts.toWrite} change${preview.counts.toWrite === 1 ? "" : "s"}`}</Button>} />
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
