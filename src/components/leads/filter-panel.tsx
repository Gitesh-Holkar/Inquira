"use client";
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The lead search and filters (status, source, product, request, order, dates). On phones the filters fold behind
 * a "Filters" button next to the search box so the leads start near the top of the screen; they open by
 * themselves when one is in use. From tablet width up the filter wrapper disappears (`display: contents`) and the
 * filters sit in the form's own grid, always shown.
 */
export function FilterPanel({ active, search, children }: { active: number; search: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(active > 0);
  return (
    <>
      <div className="col-span-2 flex gap-2">
        <div className="relative min-w-0 flex-1">{search}</div>
        <Button type="button" variant="outline" className="shrink-0 md:hidden" aria-expanded={open} aria-controls="lead-filters" onClick={() => setOpen((o) => !o)}>
          <SlidersHorizontal />Filters
          {active ? <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1 text-xs text-primary-foreground" aria-label={`${active} in use`}>{active}</span> : null}
        </Button>
      </div>
      <div id="lead-filters" className={`col-span-2 grid-cols-2 gap-2 md:contents ${open ? "grid" : "hidden"}`}>{children}</div>
    </>
  );
}
