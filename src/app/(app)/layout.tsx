import Link from "next/link";
import { AlertTriangle, LogOut } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { listIntegrations } from "@/modules/core/service";
import { getReconciliation } from "@/modules/email/service";
import { BottomNav, Sidebar } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Button } from "@/components/ui/button";
import { signOut } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const [integrations, rec] = await Promise.all([listIntegrations(s.ctx, {}), getReconciliation(s.ctx, {})]);
  const reviewCount = rec.pendingReview + rec.olderBacklog;
  const problems = integrations.filter((i) => i.status !== "connected");
  const isAdmin = s.role === "owner" || s.role === "admin";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r border-border bg-surface px-3 py-4 lg:flex">
        <Link href="/" className="flex items-center gap-2 px-3 text-lg font-semibold">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">In</span>
          Inquira
        </Link>
        <Sidebar reviewCount={reviewCount} />
        <div className="mt-auto grid gap-2 px-3 text-xs text-muted">
          <p className="truncate" title={s.orgName}>{s.orgName}</p>
          <p className="truncate" title={s.user.email}>{s.user.email} · {s.role}</p>
        </div>
      </aside>
      <div className="min-w-0 pb-20 lg:pb-8">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur">
          <Link href="/" className="flex items-center gap-2 font-semibold lg:hidden">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">In</span>
            <span className="sr-only sm:not-sr-only">Inquira</span>
          </Link>
          <p className="hidden min-w-0 truncate text-sm text-muted lg:block">{s.orgName}</p>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <form action={signOut}>
              <Button variant="ghost" size="icon" aria-label="Sign out" type="submit"><LogOut /></Button>
            </form>
          </div>
        </header>
        {problems.length > 0 ? (
          <div role="status" className="border-b border-border bg-warning-soft px-4 py-2 text-sm text-warning">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {problems.map((p) => (
                  <span key={p.provider} className="mr-3 inline-block">
                    <strong>{p.provider === "gmail" ? "Gmail" : "TradeIndia"}:</strong>{" "}
                    {p.status === "reauth_required" ? (p.provider === "gmail" ? "access expired — Reconnect Gmail" : "credentials rejected") : p.status === "error" ? "sync failing" : "not connected"}
                  </span>
                ))}
              </span>
              {isAdmin ? <Link href="/settings" className="font-medium underline underline-offset-2">{problems.some((p) => p.status === "reauth_required" && p.provider === "gmail") ? "Reconnect Gmail" : "Open Settings"}</Link> : null}
            </div>
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-6">{children}</main>
      </div>
      <BottomNav reviewCount={reviewCount} />
    </div>
  );
}
