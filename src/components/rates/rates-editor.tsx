"use client";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { History, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge, Card, Input } from "@/components/ui/primitives";
import { formatDate, formatDateTime, formatINR, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rateHistoryAction, saveRatesAction, type RateChange } from "@/app/(app)/rates/actions";

export type RateRow = {
  gradeId: string; productName: string; category: string | null; gradeName: string; price: string | null; gst: string | null;
  moq: string | null; basis: string | null; pack: string | null; validFrom: string | null; confirm: boolean; updatedAt: string | null;
};
type Editable = { price: string; gst: string; moq: string; basis: string; pack: string };
const COLS: { key: keyof Editable; label: string; width: string; inputMode?: "decimal" }[] = [
  { key: "price", label: "Price ₹/kg", width: "w-28", inputMode: "decimal" },
  { key: "gst", label: "GST %", width: "w-20", inputMode: "decimal" },
  { key: "moq", label: "MOQ kg", width: "w-24", inputMode: "decimal" },
  { key: "basis", label: "Price basis", width: "w-32" },
  { key: "pack", label: "Pack", width: "w-24" },
];

function initial(r: RateRow): Editable {
  const num = (v: string | null) => (v === null ? "" : String(Number(v)));
  return { price: num(r.price), gst: num(r.gst), moq: num(r.moq), basis: r.basis ?? "", pack: r.pack ?? "" };
}

function validate(e: Editable): string | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(e.price)) return "Price must be a number like 350 or 350.50";
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(e.gst) || Number(e.gst) > 28) return "GST % must be between 0 and 28";
  if (e.moq && !/^\d{1,10}(\.\d{1,2})?$/.test(e.moq)) return "MOQ must be a number of kg";
  if (!e.basis.trim()) return "Price basis is required (e.g. Ex-factory)";
  return null;
}

export function RatesEditor({ rows, canEdit, today, defaultBasis, initialQuery }: { rows: RateRow[]; canEdit: boolean; today: string; defaultBasis: string; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [edits, setEdits] = useState<Record<string, Editable>>({});
  const [validFrom, setValidFrom] = useState(today);
  const [pending, start] = useTransition();
  const base = useMemo(() => Object.fromEntries(rows.map((r) => [r.gradeId, initial(r)])), [rows]);

  const changed = useMemo(() => Object.entries(edits).filter(([id, e]) => COLS.some((c) => e[c.key] !== base[id]![c.key])), [edits, base]);
  const errors = useMemo(() => Object.fromEntries(changed.map(([id, e]) => [id, validate(e)]).filter(([, v]) => v)), [changed]);
  const visible = rows.filter((r) => !query || `${r.productName} ${r.gradeName} ${r.category ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  const set = (id: string, key: keyof Editable, value: string) => setEdits((p) => ({ ...p, [id]: { ...(p[id] ?? base[id]!), [key]: value } }));
  const val = (id: string, key: keyof Editable) => (edits[id] ?? base[id]!)[key];
  const isChanged = (id: string, key: keyof Editable) => !!edits[id] && edits[id]![key] !== base[id]![key];

  const save = () => start(async () => {
    const items: RateChange[] = changed.map(([gradeId, e]) => ({
      gradeId, pricePerKgInr: e.price, gstPercent: e.gst, priceBasis: e.basis || defaultBasis, moqKg: e.moq || null, packSize: e.pack || null, needsConfirmation: false,
    }));
    const r = await saveRatesAction(items, validFrom);
    if (!r.ok) return void toast.error(r.error); // edits kept so nothing is lost
    toast.success(`Saved ${r.data.count} rate${r.data.count === 1 ? "" : "s"} (valid from ${formatDate(r.data.validFrom)})`);
    setEdits({});
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter products…" aria-label="Filter products" className="pl-9" />
        </div>
        {canEdit ? (
          <label className="flex items-center gap-2 text-sm">Valid from <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="w-40" /></label>
        ) : <Badge>Read-only — only admins can change rates</Badge>}
      </div>

      {/* Desktop: spreadsheet */}
      <Card className="hidden lg:block">
        <table className="w-full text-sm">
          <thead className="sticky top-14 z-10 bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">Product / grade</th>
              {COLS.map((c) => <th key={c.key} className="px-2 py-2 font-medium">{c.label}</th>)}
              <th className="px-2 py-2 font-medium">Since</th><th className="sr-only">History</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, idx) => {
              const header = idx === 0 || visible[idx - 1]!.category !== r.category;
              return (
                <Rows key={r.gradeId} header={header ? r.category ?? "Other" : null}>
                  <tr className={cn("border-b border-border", errors[r.gradeId] && "bg-danger-soft/40")}>
                    <td className="px-3 py-1.5">
                      <span className="font-medium">{r.productName}</span>{r.gradeName !== "Standard" ? <span className="text-muted"> · {r.gradeName}</span> : null}
                      {r.confirm ? <Badge tone="warning" className="ml-2" title="Flagged when importing the rates file; see QUESTIONS.md">Confirm</Badge> : null}
                      {!r.price ? <Badge className="ml-2">No rate</Badge> : null}
                      {errors[r.gradeId] ? <p className="text-xs text-danger" role="alert">{errors[r.gradeId]}</p> : null}
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className="px-2 py-1">
                        <Input aria-label={`${r.productName} ${r.gradeName} ${c.label}`} inputMode={c.inputMode} disabled={!canEdit}
                          value={val(r.gradeId, c.key)} onChange={(e) => set(r.gradeId, c.key, e.target.value)}
                          className={cn("h-8", c.width, isChanged(r.gradeId, c.key) && "border-warning bg-warning-soft font-semibold")} />
                      </td>
                    ))}
                    <td className="px-2 py-1 text-xs text-muted">{r.validFrom ? formatDate(r.validFrom) : "—"}</td>
                    <td className="px-2 py-1"><HistoryButton gradeId={r.gradeId} title={`${r.productName} · ${r.gradeName}`} /></td>
                  </tr>
                </Rows>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Phones/tablets: cards, no horizontal scroll */}
      <div className="grid gap-2 lg:hidden">
        {visible.map((r) => (
          <Card key={r.gradeId} className={cn("p-3", errors[r.gradeId] && "border-danger")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{r.productName}{r.gradeName !== "Standard" ? <span className="text-muted"> · {r.gradeName}</span> : null}</p>
                <p className="text-sm text-muted">{r.price ? <>{formatINR(r.price)}/kg + GST {formatPercent(r.gst)}%</> : "No rate yet"}{r.confirm ? " · needs confirmation" : ""}</p>
              </div>
              <HistoryButton gradeId={r.gradeId} title={`${r.productName} · ${r.gradeName}`} />
            </div>
            {canEdit ? (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {COLS.map((c) => (
                  <label key={c.key} className="grid gap-1 text-xs text-muted">{c.label}
                    <Input aria-label={`${r.productName} ${r.gradeName} ${c.label}`} inputMode={c.inputMode} value={val(r.gradeId, c.key)} onChange={(e) => set(r.gradeId, c.key, e.target.value)}
                      className={cn(isChanged(r.gradeId, c.key) && "border-warning bg-warning-soft font-semibold")} />
                  </label>
                ))}
              </div>
            ) : null}
            {errors[r.gradeId] ? <p className="mt-1 text-xs text-danger" role="alert">{errors[r.gradeId]}</p> : null}
          </Card>
        ))}
      </div>

      {canEdit && changed.length > 0 ? (
        <div className="sticky bottom-20 z-20 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 shadow-card lg:bottom-4">
          <p className="text-sm"><strong>{changed.length}</strong> unsaved change{changed.length === 1 ? "" : "s"} · old rates stay in history</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEdits({})} disabled={pending}>Discard</Button>
            <ConfirmDialog trigger={<Button disabled={pending || Object.keys(errors).length > 0}>{pending ? "Saving…" : `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`}</Button>}
              title={`Save ${changed.length} rate change${changed.length === 1 ? "" : "s"}?`} description={`New quotes will use these rates from ${formatDate(validFrom)}. Previous rates are kept in the history and can't be edited.`}
              confirmLabel="Save rates" onConfirm={save} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function Rows({ header, children }: { header: string | null; children: React.ReactNode }) {
  return (
    <>
      {header ? <tr><th colSpan={8} scope="colgroup" className="bg-surface-2 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">{header}</th></tr> : null}
      {children}
    </>
  );
}

type Hist = { id: string; price: string; gst: string; moq: string | null; basis: string; pack: string | null; validFrom: string; by: string; at: string; note: string | null; confirm: boolean };

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
                <p><strong>{formatINR(h.price)}/kg</strong> + GST {formatPercent(h.gst)}% · {h.basis}{h.moq ? ` · MOQ ${formatPercent(h.moq)} kg` : ""}{h.pack ? ` · ${h.pack}` : ""} {i === 0 ? <Badge tone="success">Current</Badge> : null}</p>
                <p className="text-xs text-muted">From {formatDate(h.validFrom)} · entered {formatDateTime(h.at)} by {h.by.startsWith("human:") ? "team member" : h.by}</p>
                {h.note ? <p className="text-xs text-muted">{h.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
