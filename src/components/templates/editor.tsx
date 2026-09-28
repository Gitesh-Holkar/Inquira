"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardHeader, CardTitle, Field, Input, Textarea } from "@/components/ui/primitives";
import { DEFAULT_ITEM_BLOCK, PLACEHOLDERS, render, unknownPlaceholders, type TemplateVars } from "@/modules/templates/engine";
import { saveTemplateAction } from "@/app/(app)/templates/actions";

export function TemplateEditor({ id, kind, name, subject, body, sample, canEdit }: {
  id?: string; kind: "quote_email" | "whatsapp"; name: string; subject: string | null; body: string; sample: TemplateVars; canEdit: boolean;
}) {
  const [s, setS] = useState(subject ?? "");
  const [b, setB] = useState(body);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const vars = useMemo<TemplateVars>(() => ({ ...sample, items_block: render(DEFAULT_ITEM_BLOCK, sample) }), [sample]);
  const unknown = unknownPlaceholders(`${s}\n${b}`);
  const insert = (key: string) => {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) return setB((x) => x + token);
    const [a, z] = [el.selectionStart, el.selectionEnd];
    setB(b.slice(0, a) + token + b.slice(z));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  };
  const dirty = b !== body || (s || null) !== (subject ?? null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>{kind === "quote_email" ? "Quotation email" : "WhatsApp message"}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {kind === "quote_email" ? (
            <Field label="Subject (used when there is no inquiry thread)" htmlFor={`${kind}-subject`}>
              <Input id={`${kind}-subject`} value={s} onChange={(e) => setS(e.target.value)} disabled={!canEdit} />
            </Field>
          ) : null}
          <Field label="Body" htmlFor={`${kind}-body`} error={error ?? (unknown.length ? `Unknown placeholder: ${unknown.map((u) => `{{${u}}}`).join(", ")}` : null)}
            hint={kind === "quote_email" ? "No sign-off here: your real Gmail signature is added to every draft." : "You can edit the message before WhatsApp opens."}>
            <Textarea ref={ref} id={`${kind}-body`} rows={kind === "quote_email" ? 14 : 6} value={b} onChange={(e) => { setB(e.target.value); setError(null); }} disabled={!canEdit} className="font-mono text-sm" />
          </Field>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Insert placeholder</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(PLACEHOLDERS).map(([k, desc]) => (
                <button key={k} type="button" title={desc} disabled={!canEdit} onClick={() => insert(k)}
                  className="rounded-md border border-border px-2 py-1 font-mono text-xs hover:bg-surface-2 disabled:opacity-50">{`{{${k}}}`}</button>
              ))}
            </div>
          </div>
          {canEdit ? (
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={!dirty || pending} onClick={() => { setB(body); setS(subject ?? ""); }}>Reset</Button>
              <Button disabled={!dirty || pending || unknown.length > 0} onClick={() => start(async () => {
                const r = await saveTemplateAction({ id, kind, name, subject: kind === "quote_email" ? s : null, body: b });
                if (r.ok) toast.success("Template saved"); else { setError(r.fieldErrors?.body?.[0] ?? r.error); toast.error(r.error); }
              })}>{pending ? "Saving…" : "Save template"}</Button>
            </div>
          ) : <Alert tone="neutral" title="Read-only — only admins can change templates" />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Live preview</CardTitle><span className="text-xs text-muted">sample lead & today&apos;s example rate</span></CardHeader>
        <CardContent>
          {kind === "quote_email" ? <p className="mb-2 text-sm"><span className="text-muted">Subject:</span> {render(s || "Quotation – {{product}}", vars)}</p> : null}
          <pre data-testid={`${kind}-preview`} className={`whitespace-pre-wrap break-words rounded-md p-3 font-sans text-sm ${kind === "whatsapp" ? "bg-success-soft" : "bg-surface-2"}`}>{render(b, vars)}</pre>
          {kind === "quote_email" ? <p className="mt-2 text-xs text-muted">+ your Gmail signature (fetched from Gmail when the draft is created)</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
