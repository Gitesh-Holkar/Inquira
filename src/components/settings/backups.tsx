"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Download, HardDriveDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { backupNowAction } from "@/app/(app)/settings/actions";

export type BackupView = { id: string; createdAt: string; sizeBytes: number; leads: number; files: number };

/** Settings → Backups (GOAL G-PLT-7): the last 14 days of nightly backups; owners make and download them. */
export function Backups({ items, isOwner, storageReady }: { items: BackupView[]; isOwner: boolean; storageReady: boolean }) {
  const [pending, start] = useTransition();
  const mb = (b: number) => (b < 1_000_000 ? `${Math.max(1, Math.round(b / 1000))} KB` : `${Math.round(b / 100_000) / 10} MB`);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">Every night after 1 AM IST Inquira saves all your data (leads, emails, prices, templates, documents) to your own file storage and keeps 14 days. Download one now and then and keep it somewhere else, for example Google Drive. Keys and passwords are never in a backup.</p>
      {!storageReady ? (
        <p role="alert" className="rounded-md bg-warning-soft p-2 text-sm text-warning">File storage is not set up, so no backup can be made. In the cloud, add <strong>SUPABASE_SERVICE_ROLE_KEY</strong> in Vercel → Settings → Environment Variables and redeploy (docs/SETUP.md section 2).</p>
      ) : null}
      {isOwner && storageReady ? (
        <div><Button disabled={pending} onClick={() => start(async () => {
          const r = await backupNowAction();
          if (r.ok) toast.success("Backup made"); else toast.error(r.error);
        })}><HardDriveDownload />{pending ? "Backing up…" : "Back up now"}</Button></div>
      ) : !isOwner ? <p className="text-sm text-muted">Only an owner can make or download a backup.</p> : null}
      {items.length === 0 ? (storageReady ? <p className="text-sm text-muted">No backup yet. The first one runs tonight.</p> : null) : (
        <ul className="grid gap-2" aria-label="Backups">
          {items.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
              <span className="min-w-0 flex-1">{formatDateTime(b.createdAt)} · {mb(b.sizeBytes)} · {b.leads} leads, {b.files} files</span>
              {isOwner ? <Button asChild size="sm" variant="outline"><a href={`/api/backups/${b.id}`}><Download />Download</a></Button> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">To restore: docs/RUNBOOK.md, “Restore a backup”.</p>
    </div>
  );
}
