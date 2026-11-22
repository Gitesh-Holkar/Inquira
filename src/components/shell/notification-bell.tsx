"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { openNotificationsAction } from "@/app/(app)/notifications/actions";

type Item = { id: string; title: string; body: string | null; href: string | null; at: string; unread: boolean };

/** The bell (GOAL G-OUT-9): held messages, failed sends and buyer replies, each told once. */
export function NotificationBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [count, setCount] = useState(unread);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" aria-label={count ? `Notifications, ${count} new` : "Notifications"} className="relative" onClick={() => {
        setOpen(true);
        start(async () => {
          const r = await openNotificationsAction();
          if (!r.ok) return void toast.error(r.error);
          setItems(r.items);
          setCount(0);
        });
      }}>
        <Bell />
        {count > 0 ? <span className="absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white dark:text-black">{count > 99 ? "99+" : count}</span> : null}
      </Button>
      <DialogContent title="Notifications">
        {pending && !items ? <p className="text-sm text-muted">Loading…</p> : !items?.length ? <p className="text-sm text-muted">Nothing yet.</p> : (
          <ul className="grid max-h-[60vh] gap-2 overflow-auto">
            {items.map((n) => (
              <li key={n.id} className={cn("rounded-md border border-border p-2 text-sm", n.unread && "border-primary")}>
                {n.href ? <Link href={n.href} onClick={() => setOpen(false)} className="font-medium text-primary underline-offset-4 hover:underline">{n.title}</Link> : <p className="font-medium">{n.title}</p>}
                {n.body ? <p className="mt-0.5 break-words text-muted">{n.body}</p> : null}
                <p className="mt-0.5 text-xs text-muted">{formatRelative(n.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
