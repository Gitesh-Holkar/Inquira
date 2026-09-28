"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, Field, Input } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { classifyAction } from "@/app/(app)/review/actions";

export type ReviewEmail = {
  id: string; from: string | null; subject: string | null; receivedAt: string; reason: string | null; body: string;
  domain: string | null; freeMail: boolean; fromName: string | null; fromEmail: string | null; hint: string | null;
  parsed: Record<string, string | null> | null; suggestion: { classification: string; reason: string; by: string } | null;
};

const LEAD_FIELDS: [string, string][] = [["contactName", "Name"], ["companyName", "Company"], ["phone", "Phone"], ["email", "Email"], ["city", "City"], ["state", "State"], ["productText", "Product"], ["quantityText", "Quantity"]];

export function ReviewItem({ e, canRule }: { e: ReviewEmail; canRule: boolean }) {
  const [mode, setMode] = useState<null | "inquiry" | "international">(null);
  const [ignoreSender, setIgnoreSender] = useState(false);
  // For gmail.com & co. only the exact address can be ignored (a domain rule would hit every buyer).
  const ignoreRule = e.freeMail || !e.domain
    ? (e.fromEmail ? { matchType: "sender_email" as const, pattern: e.fromEmail.toLowerCase(), label: e.fromEmail } : null)
    : { matchType: "sender_domain" as const, pattern: e.domain, label: `@${e.domain}` };
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const send = (classification: "inquiry" | "international" | "ignored", lead?: Record<string, string>) =>
    start(async () => {
      const r = await classifyAction({ emailId: e.id, classification, lead, ignoreRule: ignoreSender && ignoreRule ? { matchType: ignoreRule.matchType, pattern: ignoreRule.pattern } : null });
      if (!r.ok) return void toast.error(r.error);
      setDone(true);
      if (r.data.leadId) toast.success("Lead created", { action: { label: "Open", onClick: () => router.push(`/leads/${r.data.leadId}`) } });
      else toast.success(r.data.applied ? `Ignored, and ${r.data.applied} similar email(s) cleared by the new rule` : "Marked as ignored");
    });
  if (done) return null;
  const pre: Record<string, string | null> = { ...(e.parsed ?? {}), contactName: e.parsed?.contactName ?? e.fromName ?? "", email: e.parsed?.email ?? e.fromEmail ?? "", productText: e.parsed?.productText ?? "" };
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">{e.from}</span>
        <span className="text-xs text-muted">{formatDateTime(e.receivedAt)}</span>
        {e.hint ? <Badge tone="warning">Mentions {e.hint}</Badge> : null}
      </div>
      <p className="mt-1 break-words font-semibold">{e.subject}</p>
      {e.suggestion ? <p className="mt-1 text-xs text-info">Claude suggests: <strong>{e.suggestion.classification}</strong> (low confidence) — {e.suggestion.reason}</p> : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-muted">Show email ({e.reason})</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-sans text-sm">{e.body}</pre>
      </details>
      {mode ? (
        <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(ev) => {
          ev.preventDefault();
          send(mode, Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>);
        }}>
          {LEAD_FIELDS.map(([k, label]) => (
            <Field key={k} label={label} htmlFor={`${e.id}-${k}`}><Input id={`${e.id}-${k}`} name={k} defaultValue={pre[k] ?? ""} /></Field>
          ))}
          {mode === "international" ? <Field label="Country" htmlFor={`${e.id}-country`}><Input id={`${e.id}-country`} name="country" defaultValue={e.hint ?? ""} /></Field> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setMode(null)}>Back</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : mode === "inquiry" ? "Create lead" : "Save as international"}</Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="touch" onClick={() => setMode("inquiry")} disabled={pending}>Inquiry → lead</Button>
          <Button size="touch" variant="outline" onClick={() => setMode("international")} disabled={pending}>International</Button>
          <Button size="touch" variant="outline" onClick={() => send("ignored")} disabled={pending}>Ignore</Button>
          {canRule && ignoreRule ? (
            <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
              <input type="checkbox" className="size-4 shrink-0" checked={ignoreSender} onChange={(ev) => setIgnoreSender(ev.target.checked)} />
              <span className="min-w-0 break-all">Always ignore {ignoreRule.label}</span>
            </label>
          ) : null}
          <Link href="/settings?tab=rules" className="ml-auto text-xs text-primary underline-offset-4 hover:underline">Rules</Link>
        </div>
      )}
    </Card>
  );
}
