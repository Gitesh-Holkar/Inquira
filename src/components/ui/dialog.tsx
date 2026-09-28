"use client";
import * as D from "@radix-ui/react-dialog";
import * as A from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content
        className={cn(
          "fixed z-50 max-h-[90dvh] w-full overflow-y-auto border border-border bg-surface p-4 shadow-card",
          "bottom-0 left-0 rounded-t-lg sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg",
          className,
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close"><X /></Button>
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
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
