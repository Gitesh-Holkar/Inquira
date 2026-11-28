"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Link2, RefreshCw, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { formatDateTime, formatRelative } from "@/lib/format";
import { connectGmailAction, createIndiaMartPushAddressAction, disconnectGmailAction, disconnectIndiaMartAction, disconnectTradeIndiaAction, saveGmailClientAction, saveIndiaMartKeyAction, saveTradeIndiaAction, syncNowAction, testIndiaMartAction, testTradeIndiaAction } from "@/app/(app)/settings/actions";

export type IntegrationView = { provider: "gmail" | "tradeindia" | "indiamart"; status: string; accountEmail: string | null; lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null; config: Record<string, unknown> };
export type RunView = { id: string; provider: string; kind: string; startedAt: string; status: string; fetched: number; created: number; duplicates: number; errors: number; errorMessage: string | null };

const STATUS: Record<string, { label: string; tone: "success" | "neutral" | "danger" | "warning" }> = {
  connected: { label: "Connected", tone: "success" }, configured: { label: "Not connected yet", tone: "warning" }, not_connected: { label: "Not connected", tone: "neutral" },
  error: { label: "Error", tone: "danger" }, reauth_required: { label: "Reconnect needed", tone: "danger" },
};

function Health({ i }: { i: IntegrationView }) {
  const st = STATUS[i.status] ?? STATUS.not_connected!;
  return (
    <div className="grid gap-1 text-sm">
      <p><Badge tone={st.tone}>{st.label}</Badge>{i.accountEmail ? <span className="ml-2 text-muted">{i.accountEmail}</span> : null}</p>
      <p className="text-muted">{i.lastSuccessAt ? `Last successful sync ${formatRelative(i.lastSuccessAt)} (${formatDateTime(i.lastSuccessAt)})` : "Never synced"}</p>
      {i.lastError ? <p className="break-words text-danger">Last error: {i.lastError}</p> : null}
    </div>
  );
}

function SyncNow({ provider, disabled }: { provider: "gmail" | "tradeindia" | "indiamart"; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={disabled || pending} onClick={() => start(async () => {
      const r = await syncNowAction(provider);
      if (!r.ok) return void toast.error(r.error);
      const d = r.data as { fetched: number; created: number; duplicates: number; errors: number; skipped?: string; more?: boolean; errorMessages?: string[] };
      if (d.skipped) toast.info(`Skipped: ${d.skipped}`);
      else if (d.errors) toast.warning(`Synced with errors: ${d.errorMessages?.[0] ?? ""}`);
      else if (d.more) toast.info(`Fetched ${d.fetched} so far, new leads ${d.created}. The rest continues automatically on the next run.`);
      else toast.success(`Fetched ${d.fetched}, new leads ${d.created}, duplicates ${d.duplicates}`);
    })}><RefreshCw className={pending ? "animate-spin" : ""} />{pending ? "Syncing…" : "Sync now"}</Button>
  );
}

export function TradeIndiaCard({ i, canManage }: { i: IntegrationView; canManage: boolean }) {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const cfg = i.config as { userId?: string; profileId?: string };
  return (
    <Card>
      <CardHeader><CardTitle>TradeIndia</CardTitle><Badge>Inquiry API</Badge></CardHeader>
      <CardContent className="grid gap-4">
        <Health i={i} />
        {canManage ? (
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => {
            e.preventDefault();
            const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            start(async () => {
              const r = await saveTradeIndiaAction({ userId: fd.userId ?? "", profileId: fd.profileId ?? "", key: fd.key ?? "" });
              if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
              setErrors({});
              toast.success("Saved. Now click Test connection.");
            });
          }}>
            <Field label="User ID" htmlFor="ti-user" error={errors.userId}><Input id="ti-user" name="userId" defaultValue={cfg.userId ?? ""} required autoComplete="off" /></Field>
            <Field label="Profile ID" htmlFor="ti-profile" error={errors.profileId}><Input id="ti-profile" name="profileId" defaultValue={cfg.profileId ?? ""} required autoComplete="off" /></Field>
            <Field label="API key" htmlFor="ti-key" error={errors.key} hint={i.status !== "not_connected" ? "Saved (hidden). Enter again to change." : "My TradeIndia → My Inquiry API"}><Input id="ti-key" name="key" type="password" required autoComplete="off" /></Field>
            <div className="flex flex-wrap gap-2 sm:col-span-3">
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save credentials"}</Button>
              <Button type="button" variant="outline" disabled={pending || i.status === "not_connected"} onClick={() => start(async () => {
                const r = await testTradeIndiaAction();
                if (r.ok) toast.success(`Connected to TradeIndia (${r.data.sample} inquiries in the last day). Backfilling 30 days…`); else toast.error(r.error);
              })}><PlugZap />Test connection</Button>
              <SyncNow provider="tradeindia" disabled={i.status !== "connected" && i.status !== "error"} />
              {i.status !== "not_connected" ? (
                <ConfirmDialog danger title="Disconnect TradeIndia?" confirmLabel="Disconnect"
                  description="Inquira forgets the saved User ID, Profile ID and key and stops checking TradeIndia. Enquiries already imported stay. TradeIndia emails in Gmail are still read."
                  trigger={<Button type="button" variant="ghost" className="text-danger" disabled={pending}>Disconnect</Button>}
                  onConfirm={() => start(async () => { const r = await disconnectTradeIndiaAction(); if (r.ok) toast.success("TradeIndia disconnected"); else toast.error(r.error); })} />
              ) : null}
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * IndiaMART Lead Manager. Step 1, Push (enough on its own): Inquira makes an https address, shown once, which is
 * pasted into IndiaMART's Push API page; IndiaMART then sends each lead within seconds. The "CRM Push key"
 * IndiaMART shows or emails is not needed. Step 2, optional: a Pull API key (a different key) for the leads from
 * before Push was on, and as a safety net.
 */
export function IndiaMartCard({ i, canManage, httpsReady }: { i: IntegrationView; canManage: boolean; httpsReady: boolean }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pushUrl, setPushUrl] = useState<string | null>(null);
  const cfg = i.config as { pushAddressCreatedAt?: string; lastPushAt?: string; lastEmptyPushAt?: string; pullSavedAt?: string };
  // Before 28 Nov 2026 only a Pull key moved IndiaMART out of "not connected", so that also means a key is saved.
  const pullSaved = !!cfg.pullSavedAt || (!cfg.pushAddressCreatedAt && i.status !== "not_connected");
  return (
    <Card>
      <CardHeader><CardTitle>IndiaMART</CardTitle><Badge>Lead Manager API</Badge></CardHeader>
      <CardContent className="grid gap-4">
        {i.status === "reauth_required" ? <Alert tone="danger" title="IndiaMART refused the Pull key">Generate a new Pull API key in IndiaMART&apos;s Lead Manager and paste it under Step 2. Push is not affected.</Alert> : null}
        <Health i={i} />

        <section aria-labelledby="im-push" className="grid gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="im-push" className="text-sm font-semibold">Step 1 · Push: each lead within seconds</h3>
            <Badge tone={cfg.lastPushAt ? "success" : cfg.pushAddressCreatedAt ? "warning" : "neutral"}>
              {cfg.lastPushAt ? `Last lead ${formatRelative(cfg.lastPushAt)}` : cfg.pushAddressCreatedAt ? "Waiting for the first lead" : "Not set up"}
            </Badge>
          </div>
          <ol className="grid list-decimal gap-1 pl-5 text-sm">
            <li>{cfg.pushAddressCreatedAt ? <>Address created {formatDateTime(cfg.pushAddressCreatedAt)}. Lost it? Make a new one and paste that instead.</> : <>Press <strong>Create push address</strong> and copy it (it is shown once).</>}</li>
            <li>In IndiaMART: <strong>Lead Manager → ⋮ → Import/Export Leads → Push API</strong>. Choose <strong>Other</strong>, type <strong>Inquira</strong> as the CRM name, paste the address as the <strong>Webhook Listener URL</strong>, and confirm with the OTP sent to your mobile.</li>
            <li>Press <strong>Test</strong> there: it should show <strong>200</strong>. If the test adds a sample lead to Leads, tick it and delete it.</li>
          </ol>
          <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
            <strong className="text-foreground">The Push key IndiaMART gives you is not needed here.</strong> IndiaMART sends each lead to the address above, and the
            secret part of the address is what protects it. Keep the key private, like a password.
          </p>
          {cfg.lastEmptyPushAt ? (
            <p className="text-xs text-muted">IndiaMART sent a request without a lead {formatRelative(cfg.lastEmptyPushAt)} (its Test button, or a format Inquira cannot read). Inquira answered OK so IndiaMART keeps Push on; if real leads do not arrive, they still come in by email.</p>
          ) : null}
          {canManage ? (
            httpsReady ? (
              <div>
                <ConfirmDialog title={cfg.pushAddressCreatedAt ? "Create a new push address?" : "Create the push address?"} confirmLabel="Create address"
                  description={cfg.pushAddressCreatedAt ? "The current address stops working at once. Paste the new one into IndiaMART's Push API page straight away." : "You paste this address into IndiaMART's Lead Manager → Push API → Other. It is shown only once."}
                  trigger={<Button type="button" variant={cfg.pushAddressCreatedAt ? "outline" : "default"} disabled={pending}><Link2 />{cfg.pushAddressCreatedAt ? "New push address" : "Create push address"}</Button>}
                  onConfirm={() => start(async () => {
                    const r = await createIndiaMartPushAddressAction();
                    if (r.ok) setPushUrl(r.data.url); else toast.error(r.error);
                  })} />
              </div>
            ) : <Alert tone="warning" title="Push needs the cloud site">IndiaMART only sends to a public https address, so Push works on the cloud site, not on a computer-only install. Use Step 2 and the IndiaMART emails instead.</Alert>
          ) : null}
          {pushUrl ? (
            <Alert tone="success" title="Push address (shown once)">
              <span className="mt-1 grid gap-2">
                <code className="break-all rounded bg-surface px-2 py-1 text-xs">{pushUrl}</code>
                <span>Paste it in IndiaMART as the Webhook Listener URL (Push API → Other), then confirm with the OTP.</span>
                <span><Button type="button" variant="outline" size="sm" onClick={async () => {
                  try { await navigator.clipboard.writeText(pushUrl); toast.success("Address copied"); } catch { toast.error("Couldn't copy. Select the address and copy it."); }
                }}><Copy />Copy address</Button></span>
              </span>
            </Alert>
          ) : null}
        </section>

        <section aria-labelledby="im-pull" className="grid gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="im-pull" className="text-sm font-semibold">Step 2 · Pull key: older leads and a safety net</h3>
            <Badge>{pullSaved ? "Key saved" : "Optional"}</Badge>
          </div>
          <p className="text-sm text-muted">
            Brings in the last 30 days and anything Push missed, checking every 10 minutes. This is a <strong>different key</strong> from the Push key:
            Lead Manager → ⋮ → Import/Export Leads → <strong>Pull API</strong> → Generate key. Skip it if IndiaMART does not offer it to you; Push and the emails are enough.
          </p>
          {canManage ? (
            <>
              <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={(e) => {
                e.preventDefault();
                const key = String(new FormData(e.currentTarget).get("key") ?? "");
                start(async () => {
                  const r = await saveIndiaMartKeyAction(key);
                  if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
                  setErrors({});
                  toast.success("Key saved. Now click Test Pull key.");
                });
              }}>
                <Field label="Pull API key" htmlFor="im-key" error={errors.key} hint={pullSaved ? "Saved (hidden). Paste again to change." : undefined}>
                  <Input id="im-key" name="key" type="password" autoComplete="off" required minLength={10} />
                </Field>
                <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save key"}</Button>
              </form>
              {pullSaved ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={pending} onClick={() => start(async () => {
                    const r = await testIndiaMartAction();
                    if (r.ok) toast.success(`IndiaMART accepted the Pull key (${r.data.sample} leads in the last hour). Loading the last 30 days, one week per run…`); else toast.error(r.error);
                  })}><PlugZap />Test Pull key</Button>
                  <SyncNow provider="indiamart" disabled={i.status === "reauth_required"} />
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        {canManage && (i.status !== "not_connected" || cfg.pushAddressCreatedAt) ? (
          <div>
            <ConfirmDialog danger title="Disconnect IndiaMART?" confirmLabel="Disconnect"
              description="Inquira turns the push address off, forgets the Pull key and stops checking IndiaMART. Leads already imported stay. IndiaMART emails in Gmail are still read. Also switch Push off in IndiaMART's Lead Manager."
              trigger={<Button type="button" variant="ghost" className="text-danger" disabled={pending}>Disconnect IndiaMART</Button>}
              onConfirm={() => start(async () => { const r = await disconnectIndiaMartAction(); if (r.ok) { setPushUrl(null); toast.success("IndiaMART disconnected"); } else toast.error(r.error); })} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function GmailCard({ i, canManage, redirectUri }: { i: IntegrationView; canManage: boolean; redirectUri: string }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const hasClient = i.status !== "not_connected";
  const connect = () => start(async () => {
    const r = await connectGmailAction();
    if (r.ok) window.location.href = r.data.url; else toast.error(r.error);
  });
  return (
    <Card>
      <CardHeader><CardTitle>Gmail</CardTitle><Badge>read + drafts only</Badge></CardHeader>
      <CardContent className="grid gap-4">
        {i.status === "reauth_required" ? (
          <Alert tone="danger" title="Gmail access expired or was revoked" action={canManage ? <Button onClick={connect} disabled={pending}>Reconnect Gmail</Button> : undefined}>
            New emails are not being read and quote drafts can&apos;t be created until you reconnect.
          </Alert>
        ) : null}
        <Health i={i} />
        {canManage ? (
          <>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
              start(async () => {
                const r = await saveGmailClientAction({ clientId: fd.clientId ?? "", clientSecret: fd.clientSecret ?? "" });
                if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
                setErrors({});
                toast.success("OAuth client saved. Now click Connect Gmail.");
              });
            }}>
              <Field label="Google OAuth Client ID" htmlFor="g-id" error={errors.clientId} hint={typeof i.config.clientIdSuffix === "string" ? `Saved: ${i.config.clientIdSuffix}` : undefined}>
                <Input id="g-id" name="clientId" required autoComplete="off" placeholder="1234-abc.apps.googleusercontent.com" />
              </Field>
              <Field label="Client secret" htmlFor="g-secret" error={errors.clientSecret}><Input id="g-secret" name="clientSecret" type="password" required autoComplete="off" /></Field>
              <p className="text-xs text-muted sm:col-span-2">Authorised redirect URI to add in Google Cloud: <code className="break-all rounded bg-surface-2 px-1">{redirectUri}</code></p>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" variant="outline" disabled={pending}>Save OAuth client</Button>
                <Button type="button" onClick={connect} disabled={pending || !hasClient}>{i.status === "connected" ? "Reconnect Gmail" : "Connect Gmail"}</Button>
                <SyncNow provider="gmail" disabled={i.status !== "connected" && i.status !== "error"} />
                {i.status === "connected" ? (
                  <ConfirmDialog trigger={<Button variant="ghost" className="text-danger">Disconnect</Button>} danger title="Disconnect Gmail?"
                    description="Inquira will stop reading new mail and can't create quote drafts until you connect again. Emails already imported stay." confirmLabel="Disconnect"
                    onConfirm={() => start(async () => { const r = await disconnectGmailAction(); if (r.ok) toast.success("Gmail disconnected"); else toast.error(r.error); })} />
                ) : null}
              </div>
            </form>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SyncRuns({ runs }: { runs: RunView[] }) {
  if (!runs.length) return <p className="text-sm text-muted">No sync runs yet.</p>;
  return (
    <ul className="grid gap-1.5 text-sm">
      {runs.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border pb-1.5">
          <Badge tone={r.status === "ok" ? "success" : r.status === "running" ? "info" : r.status === "partial" ? "warning" : "danger"}>{r.status}</Badge>
          <span className="font-medium">{r.provider === "gmail" ? "Gmail" : "TradeIndia"} · {r.kind}</span>
          <span className="text-muted">{formatDateTime(r.startedAt)}</span>
          <span className="tabular-nums">fetched {r.fetched} · new {r.created} · dup {r.duplicates} · errors {r.errors}</span>
          {r.errorMessage ? <span className="w-full break-words text-xs text-danger">{r.errorMessage}</span> : null}
        </li>
      ))}
    </ul>
  );
}
