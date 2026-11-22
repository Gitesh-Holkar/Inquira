import { FileText, FolderOpen, Inbox, LayoutDashboard, ListChecks, Send, Settings, ShoppingCart, Tag } from "lucide-react";

/**
 * Main pages, in menu order. `mobile`: shown in the phone's bottom bar first. Shared by the client menus and
 * the server "More" page. The permission each page needs is in `nav-access.ts`.
 */
export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, mobile: true },
  { href: "/leads", label: "Leads", icon: Inbox, mobile: true },
  { href: "/outbox", label: "Outbox", icon: Send, mobile: true },
  { href: "/review", label: "Review", icon: ListChecks, mobile: true },
  { href: "/rates", label: "Rates", icon: Tag, mobile: false },
  { href: "/documents", label: "Documents", icon: FolderOpen, mobile: false },
  { href: "/templates", label: "Templates", icon: FileText, mobile: false },
  { href: "/indiamart", label: "IndiaMART", icon: ShoppingCart, mobile: false },
  { href: "/settings", label: "Settings", icon: Settings, mobile: true },
];
