import Link from "next/link";
import { headers } from "next/headers";
import { AlertTriangle, LogOut } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { listIntegrations, listNotifications } from "@/modules/core/service";
import { getOutboxCounts } from "@/modules/outbound/service";
import { getNotRepliedCount } from "@/modules/leads/service";
import { NotificationBell } from "@/components/shell/notification-bell";
import { getReconciliation } from "@/modules/email/service";
import { BottomNav, Sidebar } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Button } from "@/components/ui/button";
import { signOut } from "../login/actions";
import { can } from "@/modules/core/permissions";
import { PAGE_PERMISSION } from "@/components/shell/nav-access";

export const dynamic = "force-dynamic";

const ROLE_NAMES = { owner: "owner", admin: "admin", sales: "sales", qa: "QA", accounts: "accounts", viewer: "viewer" } as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const [integrations, rec, outbox, notes, notReplied] = await Promise.all([
    can(s.ctx, "integrations.read") ? listIntegrations(s.ctx, {}) : Promise.resolve([]), getReconciliation(s.ctx, {}),
    can(s.ctx, "quotes.read") ? getOutboxCounts(s.ctx, {}) : Promise.resolve({ review: 0 }), listNotifications(s.ctx, { limit: 1 }),
    can(s.ctx, "leads.read") ? getNotRepliedCount(s.ctx, {}) : Promise.resolve(0),
  ]);
  const allowed = Object.entries(PAGE_PERMISSION).filter(([, perm]) => can(s.ctx, perm)).map(([href]) => href);
  const counts = { review: rec.pendingReview + rec.olderBacklog, outbox: outbox.review, leads: notReplied };
  const problems = integrations.filter((i) => i.status !== "connected");
  const isAdmin = can(s.ctx, "integrations.manage");
  // A wrong APP_URL silently breaks Gmail OAuth, the Claude connector URL and email links.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const configuredHost = new URL(appUrl()).host;
  const appUrlMismatch = isAdmin && !!host && host !== configuredHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r border-border bg-surface px-3 py-4 lg:flex">
        <Link href="/" className="flex items-center gap-2 px-3 text-lg font-semibold">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">In</span>
          Inquira
        </Link>
        <Sidebar counts={counts} allowed={allowed} />
        <div className="mt-auto grid gap-2 px-3 text-xs text-muted">
          <p className="truncate" title={s.orgName}>{s.orgName}</p>
          <p className="truncate" title={s.user.email}>{s.user.email} · {ROLE_NAMES[s.role]}</p>
        </div>
      </aside>
      <div className="min-w-0 pb-20 lg:pb-8">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold lg:hidden">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">In</span>
            <span className="sr-only sm:not-sr-only">Inquira</span>
          </Link>
          <p className="hidden min-w-0 truncate text-sm text-muted lg:block">{s.orgName}</p>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell key={notes.unread} unread={notes.unread} />
            <ThemeToggle />
            <form action={signOut}>
              <Button variant="ghost" size="icon" aria-label="Sign out" type="submit"><LogOut /></Button>
            </form>
          </div>
        </header>
        {appUrlMismatch ? (
          <div role="alert" className="border-b border-border bg-danger-soft px-4 py-2 text-sm text-danger">
            <p className="mx-auto max-w-6xl break-words">
              <strong>APP_URL is {appUrl()}</strong> but this site is <strong>https://{host}</strong>. Set APP_URL to https://{host} in Vercel → Settings → Environment Variables, then redeploy. Gmail and Claude connections need it.
            </p>
          </div>
        ) : null}
        {problems.length > 0 ? (
          <div role="status" className="border-b border-border bg-warning-soft px-4 py-2 text-sm text-warning">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {/* One short line: connections grouped by what is wrong ("Gmail, IndiaMART: not connected"). */}
                {[...problems.reduce((m, p) => {
                  const name = p.provider === "gmail" ? "Gmail" : p.provider === "indiamart" ? "IndiaMART" : "TradeIndia";
                  const what = p.status === "reauth_required" ? (p.provider === "gmail" ? "access expired" : p.provider === "indiamart" ? "key rejected" : "credentials rejected") : p.status === "error" ? "sync failing" : "not connected";
                  return m.set(what, [...(m.get(what) ?? []), name]);
                }, new Map<string, string[]>())].map(([what, names]) => <span key={what} className="mr-3 inline-block"><strong>{names.join(", ")}:</strong> {what}</span>)}
              </span>
              {isAdmin ? <Link href="/settings" className="inline-flex min-h-11 items-center font-medium underline underline-offset-2 lg:min-h-0">{problems.some((p) => p.status === "reauth_required" && p.provider === "gmail") ? "Reconnect Gmail" : "Open Settings"}</Link> : null}
            </div>
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-6">{children}</main>
      </div>
      <BottomNav counts={counts} allowed={allowed} />
    </div>
  );
}
