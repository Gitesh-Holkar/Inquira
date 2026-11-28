"use client";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { History, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge, Card, Input } from "@/components/ui/primitives";
import { formatDate, formatDateTime, formatINR, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rateHistoryAction, saveRatesAction, type RateChange } from "@/app/(app)/rates/actions";
import { DeleteProductButton, EditProductButton, type EditableProduct } from "./edit-product";

export type RateRow = {
  productId: string; gradeId: string; productName: string; category: string | null; gradeName: string; price: string | null; gst: string | null;
  moq: string | null; basis: string | null; pack: string | null; validFrom: string | null; confirm: boolean; updatedAt: string | null;
  validTo: string | null; floor: string | null; ceiling: string | null;
};
type Editable = { price: string; gst: string; moq: string; basis: string; pack: string; floor: string; ceiling: string };
const COLS: { key: keyof Editable; label: string; width: string; inputMode?: "decimal" }[] = [
  { key: "price", label: "Price ₹/kg", width: "w-24", inputMode: "decimal" },
  { key: "gst", label: "GST %", width: "w-16", inputMode: "decimal" },
  { key: "moq", label: "MOQ kg", width: "w-20", inputMode: "decimal" },
  { key: "basis", label: "Price basis", width: "w-28" },
  { key: "pack", label: "Pack", width: "w-24" },
  { key: "floor", label: "Lowest ₹/kg", width: "w-20", inputMode: "decimal" },
  { key: "ceiling", label: "Highest ₹/kg", width: "w-20", inputMode: "decimal" },
];

function initial(r: RateRow): Editable {
  const num = (v: string | null) => (v === null ? "" : String(Number(v)));
  return { price: num(r.price), gst: num(r.gst), moq: num(r.moq), basis: r.basis ?? "", pack: r.pack ?? "", floor: num(r.floor), ceiling: num(r.ceiling) };
}

function validate(e: Editable): string | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(e.price)) return "Price must be a number like 350 or 350.50";
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(e.gst) || Number(e.gst) > 28) return "GST % must be between 0 and 28";
  if (e.moq && !/^\d{1,10}(\.\d{1,2})?$/.test(e.moq)) return "MOQ must be a number of kg";
  if (!e.basis.trim()) return "Price basis is required (e.g. Ex-factory)";
  if (e.floor && (!/^\d{1,10}(\.\d{1,2})?$/.test(e.floor) || Number(e.floor) > Number(e.price))) return "The lowest price must be a number not above the price";
  if (e.ceiling && (!/^\d{1,10}(\.\d{1,2})?$/.test(e.ceiling) || Number(e.ceiling) < Number(e.price))) return "The highest price must be a number not below the price";
  return null;
}

/**
 * The rate book: a calm table on desktop (click a value to change it), short cards on phones ("Change rate" opens
 * the fields). Changes collect in the bar at the bottom with the dates they apply from; nothing is saved until
 * "Save". `products` (for people who may change the catalogue) adds Edit and Delete on each product's first row.
 */
export function RatesEditor({ rows, canEdit, today, defaultBasis, initialQuery, products = [] }: { rows: RateRow[]; canEdit: boolean; today: string; defaultBasis: string; initialQuery?: string; products?: EditableProduct[] }) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [edits, setEdits] = useState<Record<string, Editable>>({});
  // Flagged rates ("Confirm" badge) the user marked as correct without changing them.
  const [acks, setAcks] = useState<Record<string, true>>({});
  const [validFrom, setValidFrom] = useState(today);
  const [validTo, setValidTo] = useState("");
  const [showRange, setShowRange] = useState(() => rows.some((r) => r.floor || r.ceiling));
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const base = useMemo(() => Object.fromEntries(rows.map((r) => [r.gradeId, initial(r)])), [rows]);
  const cols = showRange ? COLS : COLS.filter((c) => c.key !== "floor" && c.key !== "ceiling");

  const changed = useMemo(() => {
    const ids = new Set(Object.entries(edits).filter(([id, e]) => COLS.some((c) => e[c.key] !== base[id]![c.key])).map(([id]) => id));
    for (const id of Object.keys(acks)) ids.add(id);
    return [...ids].map((id) => [id, edits[id] ?? base[id]!] as const);
  }, [edits, acks, base]);
  const errors = useMemo(() => Object.fromEntries(changed.map(([id, e]) => [id, validate(e)]).filter(([, v]) => v)), [changed]);
  const visible = rows.filter((r) => !query || `${r.productName} ${r.gradeName} ${r.category ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const byProduct = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const firstOfProduct = (idx: number) => idx === 0 || visible[idx - 1]!.productId !== visible[idx]!.productId;
  /** Edit and Delete for a product, on its first visible row. */
  const productActions = (r: RateRow, idx: number) => {
    const p = byProduct.get(r.productId);
    if (!p || !firstOfProduct(idx)) return null;
    return <><EditProductButton products={products} productId={p.id} /><DeleteProductButton product={p} /></>;
  };

  const toggleAck = (id: string) => setAcks((p) => {
    const next = { ...p };
    if (next[id]) delete next[id];
    else next[id] = true;
    return next;
  });
  const set = (id: string, key: keyof Editable, value: string) => setEdits((p) => ({ ...p, [id]: { ...(p[id] ?? base[id]!), [key]: value } }));
  const val = (id: string, key: keyof Editable) => (edits[id] ?? base[id]!)[key];
  const isChanged = (id: string, key: keyof Editable) => !!edits[id] && edits[id]![key] !== base[id]![key];
  const toggleCard = (id: string) => setOpenCards((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = () => start(async () => {
    const items: RateChange[] = changed.map(([gradeId, e]) => ({
      gradeId, pricePerKgInr: e.price, gstPercent: e.gst, priceBasis: e.basis || defaultBasis, moqKg: e.moq || null, packSize: e.pack || null, needsConfirmation: false,
      floorPerKgInr: e.floor || null, ceilingPerKgInr: e.ceiling || null,
    }));
    const r = await saveRatesAction(items, validFrom, validTo || null);
    if (!r.ok) return void toast.error(r.error); // edits kept so nothing is lost
    toast.success(`Saved ${r.data.count} rate${r.data.count === 1 ? "" : "s"} (valid from ${formatDate(r.data.validFrom)})`);
    setEdits({});
    setAcks({});
    setValidTo("");
    setOpenCards(new Set());
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products…" aria-label="Filter products" className="pl-9" />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="size-4" checked={showRange} onChange={(e) => setShowRange(e.target.checked)} />
          Show lowest / highest price
        </label>
        {!canEdit ? <Badge>Read-only: only admins change rates</Badge> : null}
      </div>
      {canEdit ? <p className="mb-2 hidden text-xs text-muted lg:block">Click a value to change it. Changes are saved together with the bar at the bottom; old rates stay in history.</p> : null}

      {/* Desktop: a table that fits the page */}
      <Card className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          {/* Not sticky: inside a sideways-scrolling card a sticky header would sit over the first rows. */}
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">Product / grade</th>
              {cols.map((c) => <th key={c.key} className="px-1.5 py-2 font-medium">{c.label}</th>)}
              <th className="px-1.5 py-2 font-medium">Since</th>
              <th className="px-1.5 py-2"><span className="sr-only">History and product actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, idx) => {
              const header = idx === 0 || visible[idx - 1]!.category !== r.category;
              const first = firstOfProduct(idx);
              return (
                <Rows key={r.gradeId} header={header ? r.category ?? "Other" : null} span={cols.length + 3}>
                  <tr className={cn("border-b border-border hover:bg-surface-2/50", errors[r.gradeId] && "bg-danger-soft/40", !first && "border-t-0")}>
                    <td className="px-3 py-1.5">
                      {first ? <span className="font-medium">{r.productName}</span> : <span className="pl-3 text-muted" aria-hidden>↳ </span>}
                      {r.gradeName !== "Standard" || !first ? <span className="text-muted">{first ? " · " : ""}{r.gradeName}</span> : null}
                      {!first ? <span className="sr-only">{r.productName}</span> : null}
                      {r.confirm ? <ConfirmFlag acked={!!acks[r.gradeId]} canEdit={canEdit && !!r.price} onToggle={() => toggleAck(r.gradeId)} /> : null}
                      {!r.price ? <Badge tone="warning" className="ml-2">No rate</Badge> : null}
                      {errors[r.gradeId] ? <p className="text-xs text-danger" role="alert">{errors[r.gradeId]}</p> : null}
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className="px-1.5 py-1">
                        {canEdit ? (
                          <Input aria-label={`${r.productName} ${r.gradeName} ${c.label}`} inputMode={c.inputMode}
                            value={val(r.gradeId, c.key)} onChange={(e) => set(r.gradeId, c.key, e.target.value)}
                            className={cn("h-9 border-transparent bg-surface-2/60 px-2 hover:border-border focus:border-ring focus:bg-surface", c.width,
                              isChanged(r.gradeId, c.key) && "border-warning bg-warning-soft font-semibold")} />
                        ) : <span className={cn("inline-block px-2", c.width)}>{val(r.gradeId, c.key) || "—"}</span>}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-1.5 py-1 text-xs text-muted">{r.validFrom ? formatDate(r.validFrom) : "—"}{r.validTo ? <><br />until {formatDate(r.validTo)}</> : null}</td>
                    <td className="px-1 py-1">
                      <span className="flex items-center justify-end">
                        <HistoryButton gradeId={r.gradeId} title={`${r.productName} · ${r.gradeName}`} />
                        {products.length ? <span className="flex w-20 justify-end">{productActions(r, idx)}</span> : null}
                      </span>
                    </td>
                  </tr>
                </Rows>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Phones and tablets: short cards; "Change rate" opens the fields */}
      <div className="grid gap-2 lg:hidden">
        {visible.map((r, idx) => {
          const e = edits[r.gradeId] ?? base[r.gradeId]!;
          const open = openCards.has(r.gradeId) || !!errors[r.gradeId] || COLS.some((c) => isChanged(r.gradeId, c.key));
          const summary = [e.moq ? `MOQ ${formatNumber(e.moq)} kg` : null, e.pack || null, e.basis || null].filter(Boolean).join(" · ");
          return (
            <Card key={r.gradeId} className={cn("p-3", errors[r.gradeId] && "border-danger")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.productName}{r.gradeName !== "Standard" ? <span className="text-muted"> · {r.gradeName}</span> : null}</p>
                  <p className="text-sm">{r.price ? <><strong>{formatINR(r.price)}</strong>/kg + GST {formatPercent(r.gst)}%</> : <span className="text-warning">No rate yet</span>}</p>
                  {summary || r.validTo ? <p className="text-xs text-muted">{summary}{r.validTo ? `${summary ? " · " : ""}until ${formatDate(r.validTo)}` : ""}</p> : null}
                  {r.confirm ? <ConfirmFlag acked={!!acks[r.gradeId]} canEdit={canEdit && !!r.price} onToggle={() => toggleAck(r.gradeId)} /> : null}
                </div>
                <span className="-mr-1 -mt-1 flex shrink-0 items-center">
                  {productActions(r, idx)}
                  <HistoryButton gradeId={r.gradeId} title={`${r.productName} · ${r.gradeName}`} />
                </span>
              </div>
              {canEdit ? (
                open ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
                    {cols.map((c) => (
                      <label key={c.key} className="grid gap-1 text-xs text-muted">{c.label}
                        <Input aria-label={`${r.productName} ${r.gradeName} ${c.label}`} inputMode={c.inputMode} value={val(r.gradeId, c.key)} onChange={(ev) => set(r.gradeId, c.key, ev.target.value)}
                          className={cn(isChanged(r.gradeId, c.key) && "border-warning bg-warning-soft font-semibold")} />
                      </label>
                    ))}
                    {!COLS.some((c) => isChanged(r.gradeId, c.key)) ? (
                      <Button variant="ghost" className="col-span-2" onClick={() => toggleCard(r.gradeId)}>Close</Button>
                    ) : null}
                  </div>
                ) : (
                  <Button variant="outline" size="touch" className="mt-2 w-full" onClick={() => toggleCard(r.gradeId)}
                    aria-label={`Change rate for ${r.productName} · ${r.gradeName}`}><Pencil />{r.price ? "Change rate" : "Enter rate"}</Button>
                )
              ) : null}
              {errors[r.gradeId] ? <p className="mt-1 text-xs text-danger" role="alert">{errors[r.gradeId]}</p> : null}
            </Card>
          );
        })}
      </div>

      {canEdit && changed.length > 0 ? (
        <div role="region" aria-label="Unsaved rate changes" className="sticky bottom-20 z-20 mt-4 grid gap-3 rounded-lg border border-border bg-surface p-3 shadow-card lg:bottom-4 lg:flex lg:flex-wrap lg:items-center">
          <p className="text-sm"><strong>{changed.length}</strong> unsaved change{changed.length === 1 ? "" : "s"}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <label className="flex items-center gap-2">Valid from <Input type="date" value={validFrom} min={today} onChange={(e) => setValidFrom(e.target.value)} className="w-40" /></label>
            <label className="flex items-center gap-2" title="Optional. After this day the rate stops: quotes need a new rate.">until <Input type="date" value={validTo} min={validFrom} onChange={(e) => setValidTo(e.target.value)} className="w-40" aria-label="Valid until (optional)" /></label>
          </div>
          <div className="flex gap-2 lg:ml-auto">
            <Button variant="outline" onClick={() => { setEdits({}); setAcks({}); setOpenCards(new Set()); }} disabled={pending}>Discard</Button>
            <ConfirmDialog trigger={<Button disabled={pending || Object.keys(errors).length > 0}>{pending ? "Saving…" : `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`}</Button>}
              title={`Save ${changed.length} rate change${changed.length === 1 ? "" : "s"}?`} description={`New quotes will use these rates from ${formatDate(validFrom)}${validTo ? ` until ${formatDate(validTo)}` : ""}. Previous rates are kept in the history and can't be edited.`}
              confirmLabel="Save rates" onConfirm={save} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/** "Confirm" badge on rates flagged during import (QUESTIONS.md Q-005), with a one-click "Mark correct". */
function ConfirmFlag({ acked, canEdit, onToggle }: { acked: boolean; canEdit: boolean; onToggle: () => void }) {
  if (!canEdit) return <Badge tone="warning" className="ml-2" title="Marked to be checked when this rate was imported. The reason is in the rate's history.">Confirm</Badge>;
  return (
    <span className="ml-2 inline-flex items-center gap-1">
      <Badge tone={acked ? "success" : "warning"} title="Flagged when importing the rates file; see QUESTIONS.md">{acked ? "Will confirm" : "Confirm"}</Badge>
      <button type="button" onClick={onToggle} className="min-h-8 rounded px-1.5 text-xs text-primary underline-offset-4 hover:underline">{acked ? "Undo" : "Mark correct"}</button>
    </span>
  );
}

function Rows({ header, span, children }: { header: string | null; span: number; children: React.ReactNode }) {
  return (
    <>
      {header ? <tr><th colSpan={span} scope="colgroup" className="bg-surface-2 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">{header}</th></tr> : null}
      {children}
    </>
  );
}

type Hist = { id: string; price: string; gst: string; moq: string | null; basis: string; pack: string | null; validFrom: string; validTo: string | null; floor: string | null; ceiling: string | null; by: string; at: string; note: string | null; confirm: boolean };

function HistoryButton({ gradeId, title }: { gradeId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Hist[] | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" aria-label={`Rate history for ${title}`} title="Rate history" onClick={() => {
        setOpen(true);
        start(async () => { const r = await rateHistoryAction(gradeId); if (r.ok) setRows(r.data); else toast.error(r.error); });
      }}><History /></Button>
      <DialogContent title="Rate history" description={title}>
        {pending && !rows ? <p className="text-sm text-muted">Loading…</p> : !rows?.length ? <p className="text-sm text-muted">No rates yet.</p> : (
          <ol className="grid gap-2 text-sm">
            {rows.map((h, i) => (
              <li key={h.id} className={cn("rounded-md border border-border p-2", i === 0 && "border-primary")}>
                <p><strong>{formatINR(h.price)}/kg</strong> + GST {formatPercent(h.gst)}% · {h.basis}{h.moq ? ` · MOQ ${formatNumber(h.moq)} kg` : ""}{h.pack ? ` · ${h.pack}` : ""} {i === 0 ? <Badge tone="success">Current</Badge> : null}</p>
                {h.floor || h.ceiling ? <p className="text-xs">Range {h.floor ? formatINR(h.floor) : "—"} to {h.ceiling ? formatINR(h.ceiling) : "—"} per kg (internal)</p> : null}
                <p className="text-xs text-muted">From {formatDate(h.validFrom)}{h.validTo ? ` until ${formatDate(h.validTo)}` : ""} · entered {formatDateTime(h.at)} by {h.by.startsWith("human:") ? "team member" : h.by}</p>
                {h.note ? <p className="text-xs text-muted">{h.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
