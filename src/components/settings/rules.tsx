"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge, Field, Input, Select } from "@/components/ui/primitives";
import { createRuleAction, updateRuleAction } from "@/app/(app)/settings/actions";

export type RuleView = { id: string; name: string; matchType: string; pattern: string; action: string; priority: number; enabled: boolean; hitCount: number };
const MATCH = { sender_domain: "Sender domain is", sender_email: "Sender email is", subject_contains: "Subject contains", body_contains: "Body contains" } as const;
const ACTION = { ignore: "Ignore", needs_review: "Send to review", international: "Mark international", inquiry: "Treat as inquiry" } as const;

export function RulesEditor({ rules, canEdit }: { rules: RuleView[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        Rules run before the built-in parsers, lowest priority number first. Use them to turn corrections into permanent behaviour (e.g. “sender domain
        packaging-vendor.com → Ignore”).
      </p>
      {canEdit ? (
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
            start(async () => {
              const r = await createRuleAction({
                name: f.name || `${f.matchType} ${f.pattern}`,
                matchType: f.matchType as keyof typeof MATCH,
                pattern: f.pattern ?? "",
                action: f.action as keyof typeof ACTION,
                priority: Number(f.priority || 100),
              });
              if (r.ok) {
                toast.success(r.data.applied ? `Rule added; ${r.data.applied} review email(s) cleared` : "Rule added");
                form.reset();
              } else toast.error(r.error);
            });
          }}
        >
          <Field label="When" htmlFor="r-match">
            <Select id="r-match" name="matchType">
              {Object.entries(MATCH).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Value" htmlFor="r-pattern">
            <Input id="r-pattern" name="pattern" required minLength={2} placeholder="example.com" />
          </Field>
          <Field label="Then" htmlFor="r-action">
            <Select id="r-action" name="action">
              {Object.entries(ACTION).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Name (optional)" htmlFor="r-name">
            <Input id="r-name" name="name" maxLength={120} />
          </Field>
          <Button type="submit" disabled={pending}>Add rule</Button>
        </form>
      ) : null}
      <ul className="grid gap-2">
        {rules.length === 0 ? (
          <li className="text-sm text-muted">No rules yet. Built-in parsers handle IndiaMART/TradeIndia, OTPs, bank alerts and newsletters.</li>
        ) : (
          rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
              <span className="min-w-0 break-words">
                {MATCH[r.matchType as keyof typeof MATCH]} <strong>{r.pattern}</strong> → {ACTION[r.action as keyof typeof ACTION]}
              </span>
              {r.enabled ? <Badge tone="success">on</Badge> : <Badge>off</Badge>}
              {r.hitCount ? <span className="text-xs text-muted">{r.hitCount} hits</span> : null}
              {canEdit ? (
                <span className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const x = await updateRuleAction(r.id, { enabled: !r.enabled });
                        if (!x.ok) toast.error(x.error);
                      })
                    }
                  >
                    {r.enabled ? "Turn off" : "Turn on"}
                  </Button>
                  <ConfirmDialog
                    trigger={<Button size="sm" variant="ghost" className="text-danger">Delete</Button>}
                    danger
                    title="Delete rule?"
                    description="Emails already classified keep their classification."
                    confirmLabel="Delete"
                    onConfirm={() =>
                      start(async () => {
                        const x = await updateRuleAction(r.id, { deleted: true });
                        if (x.ok) toast.success("Rule deleted");
                        else toast.error(x.error);
                      })
                    }
                  />
                </span>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
