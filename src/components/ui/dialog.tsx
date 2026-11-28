"use client";
import * as D from "@radix-ui/react-dialog";
import * as A from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Dialog = D.Root;

/**
 * A dialog: a bottom sheet on phones, centred on larger screens. The title bar stays at the top while the content
 * scrolls; put the buttons in `DialogFooter` so they stay visible too. `size="lg"` for forms with two columns.
 */
export function DialogContent({ title, description, children, className, size = "md" }: { title: string; description?: string; children: React.ReactNode; className?: string; size?: "md" | "lg" }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content
        className={cn(
          "fixed z-50 max-h-[90dvh] w-full overflow-y-auto overscroll-contain border border-border bg-surface px-4 pb-4 shadow-card",
          "bottom-0 left-0 rounded-t-xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg",
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg",
          className,
        )}
      >
        <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-start justify-between gap-3 border-b border-border bg-surface px-4 pb-3 pt-4">
          <div className="min-w-0">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close" className="-mr-2 shrink-0"><X /></Button>
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

/** The buttons of a dialog form: stays at the bottom of the dialog while the content scrolls. */
export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("sticky -bottom-4 z-10 -mx-4 -mb-4 mt-4 flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)}>
      {children}
    </div>
  );
}

/** Confirmation for destructive or irreversible actions (brief §7.8). */
export function ConfirmDialog({ trigger, title, description, confirmLabel = "Confirm", onConfirm, danger }: {
  trigger: React.ReactNode; title: string; description: string; confirmLabel?: string; onConfirm: () => void | Promise<void>; danger?: boolean;
}) {
  return (
    <A.Root>
      <A.Trigger asChild>{trigger}</A.Trigger>
      <A.Portal>
        <A.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <A.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface p-4 shadow-card">
          <A.Title className="text-base font-semibold">{title}</A.Title>
          <A.Description className="mt-2 text-sm text-muted">{description}</A.Description>
          <div className="mt-4 flex justify-end gap-2">
            <A.Cancel asChild><Button variant="outline">Cancel</Button></A.Cancel>
            <A.Action asChild><Button variant={danger ? "danger" : "default"} onClick={() => void onConfirm()}>{confirmLabel}</Button></A.Action>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
