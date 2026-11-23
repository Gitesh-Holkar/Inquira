"use client";
import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { restoreProductAction } from "@/app/(app)/rates/actions";

/** Deleted products, each with a Restore button (rates and history come back). Shown only when there are any. */
export function RemovedProducts({ items }: { items: { id: string; name: string; removedAt: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <Card className="mt-4">
      <CardContent className="pt-1">
        <details>
          <summary className="cursor-pointer py-3 text-sm font-semibold">Deleted products <span className="font-normal text-muted">({items.length})</span></summary>
          <ul className="grid gap-2 pb-2">
            {items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
                <span className="min-w-0 break-words">{p.name} <span className="text-muted">· deleted {formatDate(p.removedAt)}</span></span>
                <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => {
                  const r = await restoreProductAction(p.id);
                  if (r.ok) toast.success(`${p.name} restored`); else toast.error(r.error);
                })}><RotateCcw />Restore</Button>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
