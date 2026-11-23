"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardHeader, CardTitle, Field, Input, Textarea } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_ITEM_BLOCK, PLACEHOLDERS, TEMPLATE_PURPOSE_LABELS, render, unknownPlaceholders, type TemplatePurpose, type TemplateVars } from "@/modules/templates/engine";
import { saveTemplateAction } from "@/app/(app)/templates/actions";

export type TemplateVersionView = { version: number; subject: string | null; body: string; savedAt: string };

/**
 * One template: edit with a live preview, and go back to an earlier saved version or to Inquira's starting
 * text. Going back only fills the editor; saving it makes a new version, so nothing is lost.
 */
export function TemplateEditor({ id, kind, purpose, version, name, subject, body, sample, canEdit, versions = [], starting = null }: {
  id?: string; kind: "quote_email" | "whatsapp"; purpose: TemplatePurpose; version: number | null; name: string; subject: string | null; body: string; sample: TemplateVars; canEdit: boolean;
  versions?: TemplateVersionView[]; starting?: { subject: string | null; body: string } | null;
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
  const load = (t: { subject: string | null; body: string }, what: string) => {
    setB(t.body);
    if (kind === "quote_email") setS(t.subject ?? "");
    setError(null);
    toast.info(`${what} is in the editor. Check the preview, then Save template.`);
  };
  const older = versions.filter((v) => v.version !== version);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{TEMPLATE_PURPOSE_LABELS[purpose]} · {kind === "quote_email" ? "email" : "WhatsApp"}</CardTitle>
          <span className="text-xs text-muted">{version ? `version ${version}` : "not saved yet (starting text)"}</span>
        </CardHeader>
        <CardContent className="grid gap-3">
          {kind === "quote_email" ? (
            <Field label="Subject (used when there is no enquiry thread)" htmlFor={`${kind}-subject`}>
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
                  className="min-h-11 rounded-md border border-border px-2 py-1 font-mono text-xs hover:bg-surface-2 disabled:opacity-50 lg:min-h-0">{`{{${k}}}`}</button>
              ))}
            </div>
          </div>
          {canEdit && (older.length || (starting && starting.body !== body)) ? (
            <details className="rounded-md border border-border px-3 text-sm">
              <summary className="cursor-pointer py-3 font-medium">Earlier versions{older.length ? ` (${older.length})` : ""}</summary>
              <ul className="grid gap-2 pb-3" aria-label={`Earlier versions of the ${kind === "quote_email" ? "email" : "WhatsApp"} template`}>
                {older.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
                    <span className="min-w-0 flex-1 break-words">Version {v.version} · saved {formatDateTime(v.savedAt)}<span className="block truncate text-xs text-muted">{v.body.split("\n").find((l) => l.trim()) ?? ""}</span></span>
                    <Button type="button" size="sm" variant="outline" onClick={() => load(v, `Version ${v.version}`)}>Use this text</Button>
                  </li>
                ))}
                {starting && starting.body !== body ? (
                  <li className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
                    <span className="min-w-0 flex-1">Inquira&apos;s starting text</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => load(starting, "The starting text")}>Use this text</Button>
                  </li>
                ) : null}
              </ul>
            </details>
          ) : null}
          {canEdit ? (
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={!dirty || pending} onClick={() => { setB(body); setS(subject ?? ""); }} title="Undo your unsaved changes">Undo changes</Button>
              <Button disabled={!dirty || pending || unknown.length > 0} onClick={() => start(async () => {
                const r = await saveTemplateAction({ id, kind, purpose, name, subject: kind === "quote_email" ? s : null, body: b });
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
