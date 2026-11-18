"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, ListChecks, Settings, Tag, FileText, ShoppingCart, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/** Main pages and the permission each needs (the page itself checks it too). */
export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, mobile: true },
  { href: "/leads", label: "Leads", icon: Inbox, mobile: true },
  { href: "/review", label: "Review", icon: ListChecks, mobile: true },
  { href: "/rates", label: "Rates", icon: Tag, mobile: true },
  { href: "/documents", label: "Documents", icon: FolderOpen, mobile: false },
  { href: "/templates", label: "Templates", icon: FileText, mobile: false },
  { href: "/indiamart", label: "IndiaMART", icon: ShoppingCart, mobile: false },
  { href: "/settings", label: "Settings", icon: Settings, mobile: true },
];
const ITEMS = NAV_ITEMS;

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

/** `allowed` lists the pages this person may open (from their permissions); the others are not shown. */
export function Sidebar({ reviewCount, allowed }: { reviewCount: number; allowed: readonly string[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="grid gap-1">
      {ITEMS.filter((i) => allowed.includes(i.href)).map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} aria-current={active(path, href) ? "page" : undefined}
          className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-foreground",
            active(path, href) && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary")}>
          <Icon className="size-4" aria-hidden />
          <span className="flex-1">{label}</span>
          {href === "/review" && reviewCount > 0 ? <span className="rounded-full bg-danger-soft px-2 text-xs text-danger" aria-label={`${reviewCount} to review`}>{reviewCount}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Phones: up to five allowed pages; when a main one (such as Settings) is not allowed, the next allowed page takes its place. */
export function BottomNav({ reviewCount, allowed }: { reviewCount: number; allowed: readonly string[] }) {
  const path = usePathname();
  const ok = ITEMS.filter((i) => allowed.includes(i.href));
  const items = [...ok.filter((i) => i.mobile), ...ok.filter((i) => !i.mobile)].slice(0, 5).sort((a, b) => ITEMS.indexOf(a) - ITEMS.indexOf(b));
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link href={href} aria-current={active(path, href) ? "page" : undefined}
              className={cn("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted", active(path, href) && "text-primary")}>
              <Icon className="size-5" aria-hidden />
              {label}
              {href === "/review" && reviewCount > 0 ? <span className="absolute right-[22%] top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white dark:text-black">{reviewCount > 99 ? "99+" : reviewCount}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
