"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, ListChecks, Settings, Tag, FileText, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, mobile: true },
  { href: "/leads", label: "Leads", icon: Inbox, mobile: true },
  { href: "/review", label: "Review", icon: ListChecks, mobile: true },
  { href: "/rates", label: "Rates", icon: Tag, mobile: true },
  { href: "/templates", label: "Templates", icon: FileText, mobile: false },
  { href: "/indiamart", label: "IndiaMART", icon: ShoppingCart, mobile: false },
  { href: "/settings", label: "Settings", icon: Settings, mobile: true },
];

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function Sidebar({ reviewCount }: { reviewCount: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="grid gap-1">
      {ITEMS.map(({ href, label, icon: Icon }) => (
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

export function BottomNav({ reviewCount }: { reviewCount: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid grid-cols-5">
        {ITEMS.filter((i) => i.mobile).map(({ href, label, icon: Icon }) => (
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
