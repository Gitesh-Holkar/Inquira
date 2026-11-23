import Link from "next/link";
import type { Metadata } from "next";
import { requireSession, type AppSession } from "@/lib/auth";
import { accountKind } from "@/lib/accounts";
import { listMembers } from "@/modules/core/members";
import { appUrl } from "@/lib/env";
import { can } from "@/modules/core/permissions";
import type { Ctx } from "@/modules/core/types";
import { getOrgSettings, listIntegrations, listSyncRuns } from "@/modules/core/service";
import { listMcpTokens } from "@/modules/mcp/service";
import { listClassificationRules } from "@/modules/email/service";
import { getBuyleadRules } from "@/modules/buyleads/service";
import { gmailRedirectUri } from "@/modules/sources/gmail/service";
import { Alert, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { GmailCard, IndiaMartCard, SyncRuns, TradeIndiaCard, type IntegrationView } from "@/components/settings/integrations";
import { McpTokens } from "@/components/settings/tokens";
import { RulesEditor } from "@/components/settings/rules";
import { BuyleadRulesEditor } from "@/components/settings/buylead-rules";
import { CompanyNameForm, OrgForm } from "@/components/settings/org-form";
import { samplePolicySchema } from "@/modules/catalog/types";
import { Members } from "@/components/settings/members";
import { AiIntro, AiTierCard } from "@/components/settings/ai";
import { getAiSettings } from "@/modules/ai/service";
import { getOutboundSettings } from "@/modules/outbound/service";
import { listProducts } from "@/modules/catalog/service";
import { SendingForm, TeamRules } from "@/components/settings/sending";
import { Backups } from "@/components/settings/backups";
import { backupStorageReady, listBackups } from "@/modules/backup/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  ["integrations", "Integrations"],
  ["ai", "AI"],
  ["sending", "Sending"],
  ["mcp", "Claude / MCP"],
  ["rules", "Email rules"],
  ["buyleads", "IndiaMART rules"],
  ["org", "Organisation"],
  ["members", "Members"],
  ["backups", "Backups"],
] as const;

type SP = { tab?: string; gmail?: string; gmail_error?: string; account?: string };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession("settings.read");
  const sp = await searchParams;
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : "integrations";
  const admin = can(s.ctx, "integrations.manage");

  return (
    <>
      <PageHeader title="Settings" description={admin ? "Only owners and admins can change these." : "You can view settings; ask an admin to change them."} />
      {/* Phones: these pages aren't in the bottom bar. */}
      <p className="-mt-2 mb-2 flex flex-wrap gap-x-4 text-sm lg:hidden">
        <Link href="/rates" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">Rates</Link>
        <Link href="/documents" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">Documents</Link>
        <Link href="/templates" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">Templates</Link>
        <Link href="/indiamart" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">IndiaMART log</Link>
      </p>
      {sp.gmail === "connected" ? (
        <Alert tone="success" className="mb-4" title={`Gmail connected${sp.account ? ` (${sp.account})` : ""}`}>
          The first sync reads the last 14 days. It runs within 10 minutes, or click Sync now.
        </Alert>
      ) : null}
      {sp.gmail_error ? (
        <Alert tone="danger" className="mb-4" title="Gmail was not connected">
          {sp.gmail_error}
        </Alert>
      ) : null}
      <nav aria-label="Settings sections" className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1 text-sm">
        {TABS.map(([t, label]) => (
          <Link
            key={t}
            href={`/settings?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-md px-3 py-2 font-medium text-muted", tab === t && "bg-surface text-foreground shadow-card")}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "integrations" ? <IntegrationsTab ctx={s.ctx} admin={admin} /> : null}
      {tab === "ai" ? <AiTab ctx={s.ctx} canManage={can(s.ctx, "integrations.manage")} /> : null}
      {tab === "sending" ? <SendingTab ctx={s.ctx} isOwner={s.role === "owner"} canEdit={can(s.ctx, "settings.write")} /> : null}
      {tab === "mcp" ? (
        can(s.ctx, "mcp_tokens.manage") ? <McpTab ctx={s.ctx} /> : <Alert tone="neutral" title="Only owners and admins can manage Claude / MCP access." />
      ) : null}
      {tab === "rules" ? <RulesTab ctx={s.ctx} canEdit={can(s.ctx, "rules.write")} /> : null}
      {tab === "buyleads" ? <BuyleadTab ctx={s.ctx} canEdit={can(s.ctx, "buylead.rules.write")} /> : null}
      {tab === "org" ? <OrgTab ctx={s.ctx} canEdit={can(s.ctx, "settings.write")} /> : null}
      {tab === "members" ? <MembersTab s={s} /> : null}
      {tab === "backups" ? <BackupsTab ctx={s.ctx} isOwner={s.role === "owner"} /> : null}
    </>
  );
}

async function IntegrationsTab({ ctx, admin }: { ctx: Ctx; admin: boolean }) {
  const [ints, runs] = await Promise.all([listIntegrations(ctx, {}), listSyncRuns(ctx, { limit: 15 })]);
  const view = (p: "gmail" | "tradeindia" | "indiamart"): IntegrationView => {
    const i = ints.find((x) => x.provider === p) ?? { provider: p, status: "not_connected", accountEmail: null, lastSyncAt: null, lastSuccessAt: null, lastError: null, config: {} };
    return {
      provider: p,
      status: i.status,
      accountEmail: i.accountEmail,
      lastSyncAt: i.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: i.lastSuccessAt?.toISOString() ?? null,
      lastError: i.lastError,
      config: i.config,
    };
  };
  return (
    <div className="grid gap-4">
      <TradeIndiaCard i={view("tradeindia")} canManage={admin} />
      <IndiaMartCard i={view("indiamart")} canManage={admin} httpsReady={appUrl().startsWith("https://")} />
      <GmailCard i={view("gmail")} canManage={admin} redirectUri={gmailRedirectUri()} />
      <Card>
        <CardHeader>
          <CardTitle>Recent sync runs</CardTitle>
          <span className="text-xs text-muted">every 10 minutes via cron</span>
        </CardHeader>
        <CardContent>
          <SyncRuns
            runs={runs.map((r) => ({
              id: r.id,
              provider: r.provider,
              kind: r.kind,
              startedAt: r.startedAt.toISOString(),
              status: r.status,
              fetched: r.fetched,
              created: r.created,
              duplicates: r.duplicates,
              errors: r.errors,
              errorMessage: r.errorMessage,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

async function BackupsTab({ ctx, isOwner }: { ctx: Ctx; isOwner: boolean }) {
  const items = await listBackups(ctx, {});
  return (
    <Card>
      <CardHeader><CardTitle>Backups</CardTitle></CardHeader>
      <CardContent>
        <Backups isOwner={isOwner} storageReady={backupStorageReady()} items={items.map((b) => ({ id: b.id, createdAt: b.createdAt.toISOString(), sizeBytes: b.sizeBytes, leads: b.counts.leads ?? 0, files: b.counts.files ?? 0 }))} />
      </CardContent>
    </Card>
  );
}

async function SendingTab({ ctx, isOwner, canEdit }: { ctx: Ctx; isOwner: boolean; canEdit: boolean }) {
  const [{ settings, rules }, products] = await Promise.all([getOutboundSettings(ctx, {}), listProducts(ctx, {})]);
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader><CardTitle>Sending</CardTitle></CardHeader>
        <CardContent><SendingForm s={settings} isOwner={isOwner} canEdit={canEdit} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Your hold rules</CardTitle><span className="text-xs text-muted">on top of the built-in ones</span></CardHeader>
        <CardContent><TeamRules rules={rules} canEdit={canEdit} products={products.map((p) => ({ id: p.id, name: p.name }))} /></CardContent>
      </Card>
    </div>
  );
}

async function AiTab({ ctx, canManage }: { ctx: Ctx; canManage: boolean }) {
  const ai = await getAiSettings(ctx, {});
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return (
    <div className="grid gap-4">
      <AiIntro waitingLeads={ai.waitingLeads} anyOn={ai.tiers.some((t) => t.enabled)} />
      {ai.tiers.map((t) => (
        <AiTierCard key={t.tier} canManage={canManage} providers={ai.providers}
          t={{ ...t, lastErrorAt: iso(t.lastErrorAt), lastSuccessAt: iso(t.lastSuccessAt), backoffUntil: iso(t.backoffUntil) }} />
      ))}
    </div>
  );
}

async function McpTab({ ctx }: { ctx: Ctx }) {
  const tokens = await listMcpTokens(ctx, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude / MCP access</CardTitle>
      </CardHeader>
      <CardContent>
        <McpTokens
          mcpUrl={`${appUrl()}/api/mcp`}
          tokens={tokens.map((t) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            tokenPrefix: t.tokenPrefix,
            createdAt: t.createdAt.toISOString(),
            lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
            expiresAt: t.expiresAt?.toISOString() ?? null,
            revokedAt: t.revokedAt?.toISOString() ?? null,
          }))}
        />
      </CardContent>
    </Card>
  );
}

async function RulesTab({ ctx, canEdit }: { ctx: Ctx; canEdit: boolean }) {
  const rules = await listClassificationRules(ctx, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email classification rules</CardTitle>
      </CardHeader>
      <CardContent>
        <RulesEditor
          canEdit={canEdit}
          rules={rules.map((r) => ({ id: r.id, name: r.name, matchType: r.matchType, pattern: r.pattern, action: r.action, priority: r.priority, enabled: r.enabled, hitCount: r.hitCount }))}
        />
      </CardContent>
    </Card>
  );
}

async function BuyleadTab({ ctx, canEdit }: { ctx: Ctx; canEdit: boolean }) {
  const r = await getBuyleadRules(ctx, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>IndiaMART Buy Lead rules</CardTitle>
      </CardHeader>
      <CardContent>
        <BuyleadRulesEditor
          canEdit={canEdit}
          rules={{
            productTerms: r.productTerms,
            excludedTerms: r.excludedTerms,
            allowedCountries: r.allowedCountries,
            allowedStates: r.allowedStates,
            excludedStates: r.excludedStates,
            minQuantityKg: r.minQuantityKg,
            maxQuantityKg: r.maxQuantityKg,
            dailyCap: r.dailyCap,
          }}
        />
      </CardContent>
    </Card>
  );
}

async function OrgTab({ ctx, canEdit }: { ctx: Ctx; canEdit: boolean }) {
  const s = await getOrgSettings(ctx, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>{s.orgName}</CardTitle>
      </CardHeader>
      <CardContent>
        <CompanyNameForm name={s.orgName} isOwner={ctx.actor.kind === "human" && ctx.actor.role === "owner"} />
        <OrgForm canEdit={canEdit} quoteValidityDays={s.quoteValidityDays} defaultPriceBasis={s.defaultPriceBasis} paymentTerms={s.paymentTerms ?? ""}
          samplePolicy={samplePolicySchema.catch({ freeSampleSize: null, requiredDetails: [], note: null }).parse(s.samplePolicy ?? {})} />
      </CardContent>
    </Card>
  );
}

async function MembersTab({ s }: { s: AppSession }) {
  const members = await listMembers(s.ctx, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent>
        <Members me={s.user.id} myRole={s.role} canManage={can(s.ctx, "members.manage")} accountKind={accountKind()} loginUrl={`${appUrl()}/login`}
          members={members.map((m) => ({ id: m.id, userId: m.userId, email: m.email, role: m.role, granted: m.granted, revoked: m.revoked, createdAt: m.createdAt.toISOString() }))} />
      </CardContent>
    </Card>
  );
}
