"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { NAV_ITEMS } from "./nav-items";
import { cn } from "@/lib/utils";

export { NAV_ITEMS };
const ITEMS = NAV_ITEMS;

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

/** `allowed` lists the pages this person may open (from their permissions); the others are not shown. */
/** Badge counts: emails to review, messages waiting for a person. */
export type NavCounts = { review: number; outbox: number };
const badge = (href: string, c: NavCounts) => (href === "/review" ? c.review : href === "/outbox" ? c.outbox : 0);

export function Sidebar({ counts, allowed }: { counts: NavCounts; allowed: readonly string[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="grid gap-1">
      {ITEMS.filter((i) => allowed.includes(i.href)).map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} aria-current={active(path, href) ? "page" : undefined}
          className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-foreground",
            active(path, href) && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary")}>
          <Icon className="size-4" aria-hidden />
          <span className="flex-1">{label}</span>
          {badge(href, counts) > 0 ? <span className="rounded-full bg-danger-soft px-2 text-xs text-danger" aria-label={`${badge(href, counts)} waiting`}>{badge(href, counts)}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Phones: the main allowed pages, and "More" (a list of every page the person may open) when they do not all fit,
 * so a page such as Documents is always reachable, whatever the role.
 */
export function BottomNav({ counts, allowed }: { counts: NavCounts; allowed: readonly string[] }) {
  const path = usePathname();
  const ok = ITEMS.filter((i) => allowed.includes(i.href));
  const ranked = [...ok.filter((i) => i.mobile), ...ok.filter((i) => !i.mobile)];
  const items: { href: string; label: string; icon: typeof MoreHorizontal }[] = ranked.length <= 5
    ? [...ranked].sort((a, b) => ITEMS.indexOf(a) - ITEMS.indexOf(b))
    : [...ranked.slice(0, 4).sort((a, b) => ITEMS.indexOf(a) - ITEMS.indexOf(b)), { href: "/more", label: "More", icon: MoreHorizontal }];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link href={href} aria-current={active(path, href) ? "page" : undefined}
              className={cn("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted", active(path, href) && "text-primary")}>
              <Icon className="size-5" aria-hidden />
              {label}
              {badge(href, counts) > 0 ? <span className="absolute right-[22%] top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white dark:text-black">{badge(href, counts) > 99 ? "99+" : badge(href, counts)}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
