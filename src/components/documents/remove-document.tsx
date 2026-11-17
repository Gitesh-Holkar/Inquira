"use client";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { removeDocumentAction } from "@/app/(app)/documents/actions";

export function RemoveDocumentButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <ConfirmDialog danger title={`Remove ${name}?`} confirmLabel="Remove document"
      description="It is no longer listed or attached to quotations. Quotations already sent keep their copy."
      trigger={<Button variant="outline" size="sm" disabled={pending} aria-label={`Remove ${name}`}><Trash2 />Remove</Button>}
      onConfirm={() => start(async () => {
        const r = await removeDocumentAction(id);
        if (r.ok) toast.success("Document removed"); else toast.error(r.error);
      })} />
  );
}
