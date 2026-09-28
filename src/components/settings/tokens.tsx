"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, Badge, Field, Input, Select } from "@/components/ui/primitives";
import { formatDateTime, formatRelative } from "@/lib/format";
import { CopyButton } from "@/components/leads/actions";
import { createTokenAction, revokeTokenAction } from "@/app/(app)/settings/actions";

export type TokenView = { id: string; name: string; kind: string; tokenPrefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null };

export function McpTokens({ tokens, mcpUrl }: { tokens: TokenView[]; mcpUrl: string }) {
  const [shown, setShown] = useState<{ name: string; token: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-4">
      <Alert tone="info" title="Connect Claude">
        In claude.ai → Settings → Connectors → <em>Add custom connector</em>, paste <code className="break-all">{mcpUrl}</code>. Claude will ask you to sign in here and approve (OAuth). For the MCP Inspector or Claude Code you can use a token below as <code>Authorization: Bearer …</code>.
      </Alert>
      {shown ? (
        <Alert tone="warning" title={`Copy the token for “${shown.name}” now — it won't be shown again`}>
          <code className="mt-1 block break-all rounded bg-surface px-2 py-1 text-foreground">{shown.token}</code>
          <div className="mt-2 flex gap-2"><CopyButton value={shown.token} label="token" /><Button variant="ghost" onClick={() => setShown(null)}>Done</Button></div>
        </Alert>
      ) : null}
      <form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const name = String(fd.get("name") ?? "");
        const exp = String(fd.get("expires") ?? "");
        start(async () => {
          const r = await createTokenAction(name, exp ? Number(exp) : null);
          if (r.ok) { setShown({ name: r.data.name, token: r.data.token }); (e.target as HTMLFormElement).reset(); } else toast.error(r.error);
        });
      }}>
        <Field label="Token name" htmlFor="tok-name" hint="Shown in the audit log as mcp:<name>"><Input id="tok-name" name="name" required minLength={2} maxLength={60} placeholder="claude-code-laptop" /></Field>
        <Field label="Expires" htmlFor="tok-exp"><Select id="tok-exp" name="expires" defaultValue="90"><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="">Never</option></Select></Field>
        <Button type="submit" disabled={pending}>Create token</Button>
      </form>
      <ul className="grid gap-2">
        {tokens.length === 0 ? <li className="text-sm text-muted">No tokens yet.</li> : tokens.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
            <span className="font-medium">{t.name}</span>
            <Badge>{t.kind === "oauth" ? "OAuth (claude.ai)" : "manual"}</Badge>
            {t.revokedAt ? <Badge tone="danger">revoked</Badge> : t.expiresAt && new Date(t.expiresAt) < new Date() ? <Badge tone="warning">expired</Badge> : <Badge tone="success">active</Badge>}
            <code className="text-xs text-muted">{t.tokenPrefix}…</code>
            <span className="text-xs text-muted">created {formatDateTime(t.createdAt)} · {t.lastUsedAt ? `used ${formatRelative(t.lastUsedAt)}` : "never used"}</span>
            {!t.revokedAt ? (
              <ConfirmDialog trigger={<Button variant="ghost" size="sm" className="ml-auto text-danger">Revoke</Button>} danger title={`Revoke “${t.name}”?`}
                description="Anything using this token (Claude, scripts) loses access immediately. This can't be undone." confirmLabel="Revoke"
                onConfirm={() => start(async () => { const r = await revokeTokenAction(t.id); if (r.ok) toast.success("Token revoked"); else toast.error(r.error); })} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
