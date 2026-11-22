/**
 * Nightly backups and restore (GOAL G-PLT-7).
 *
 * A backup is one gzipped JSON file per company: every row of every company table (read with `json_agg`, so
 * it restores exactly with `json_populate_recordset`), plus the document files. It is written to the company's
 * own file storage (the Supabase bucket in the cloud, the data folder locally) and kept 14 days; owners
 * download a copy to keep elsewhere. Left out on purpose: encrypted keys and tokens (re-enter them after a
 * restore), the job queue and the event outbox.
 *
 * This module reads every table directly: backup is the one place that must see all of them.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { withSystemTx, type Tx } from "@/db/client";
import { AppError, notFound } from "@/lib/errors";
import { todayIST } from "@/lib/format";
import { audit } from "@/modules/core/audit";
import { defineService } from "@/modules/core/service-kit";
import type { Ctx } from "@/modules/core/types";
import { fileStore, type FileStore } from "@/modules/documents/storage";
import { backups } from "./schema";

export const BACKUP_FORMAT = 1;
const KEEP_DAYS = 14;
/** Document files larger than this in total are left out of one backup (they stay in storage). */
const MAX_FILE_BYTES = 40 * 1024 * 1024;
/** Never in a backup: secrets, sign-in tokens, the job queue, the event outbox, the backup list itself. */
const EXCLUDED = new Set(["integration_secrets", "oauth_clients", "oauth_codes", "oauth_refresh_tokens", "mcp_tokens", "jobs", "events", "backups"]);
/** Export order (restore follows the foreign keys, see `restoreOrderInternal`). */
const FIRST = ["organizations", "org_settings", "memberships"];

export type BackupFile = {
  format: number;
  createdAt: string;
  orgId: string;
  tables: Record<string, unknown[]>;
  files: { storageKey: string; base64: string }[];
  skippedFiles: string[];
};

type Deps = { store?: FileStore | null; now?: Date };

function storeOrFail(deps: Deps): FileStore {
  const s = deps.store === undefined ? fileStore() : deps.store;
  if (!s) throw new AppError("INTEGRATION", "File storage is not set up (FILE_STORAGE, or the Supabase service key), so backups cannot be written.");
  return s;
}

/** Company tables in restore order. */
async function companyTables(tx: Tx): Promise<string[]> {
  const rows = await tx.execute<{ table_name: string }>(sql`select distinct table_name from information_schema.columns where table_schema = 'app' and column_name = 'org_id'`);
  const names = rows.map((r) => r.table_name).filter((n) => !EXCLUDED.has(n));
  return [...FIRST.filter((n) => n === "organizations" || names.includes(n)), ...names.filter((n) => !FIRST.includes(n)).sort()];
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected table name ${name}`);
  return sql.raw(`app."${name}"`);
};

/** Every row of one company, table by table. */
export async function exportCompanyInternal(tx: Tx, orgId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of await companyTables(tx)) {
    const where = t === "organizations" ? sql`id = ${orgId}` : sql`org_id = ${orgId}`;
    const [r] = await tx.execute<{ rows: unknown[] | null }>(sql`select coalesce(json_agg(x), '[]'::json) as rows from ${ident(t)} x where ${where}`);
    out[t] = r?.rows ?? [];
  }
  return out;
}

/** Makes one backup now: writes the file, records it, removes backups older than 14 days. */
export async function runBackupInternal(ctx: Ctx, deps: Deps = {}) {
  const store = storeOrFail(deps);
  const now = deps.now ?? new Date();
  const tables = await withSystemTx((tx) => exportCompanyInternal(tx, ctx.orgId));
  const files: BackupFile["files"] = [];
  const skippedFiles: string[] = [];
  let total = 0;
  for (const d of (tables.documents ?? []) as { storage_key: string; deleted_at: string | null }[]) {
    try {
      const data = await store.get(d.storage_key);
      total += data.byteLength;
      if (total > MAX_FILE_BYTES) { skippedFiles.push(d.storage_key); continue; }
      files.push({ storageKey: d.storage_key, base64: Buffer.from(data).toString("base64") });
    } catch {
      skippedFiles.push(d.storage_key);
    }
  }
  const body: BackupFile = { format: BACKUP_FORMAT, createdAt: now.toISOString(), orgId: ctx.orgId, tables, files, skippedFiles };
  const gz = gzipSync(Buffer.from(JSON.stringify(body)));
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const storageKey = `backups/${ctx.orgId}/${stamp}.json.gz`;
  await store.put(storageKey, new Uint8Array(gz), "application/gzip");
  const counts: Record<string, number> = { ...Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), files: files.length };
  const row = await withSystemTx(async (tx) => {
    const [r] = await tx.insert(backups).values({ orgId: ctx.orgId, storageKey, sizeBytes: gz.byteLength, counts, createdBy: `system:${ctx.actor.kind === "system" ? ctx.actor.job : "backup"}` }).returning();
    await audit(tx, ctx, { action: "backup.create", entityType: "backup", entityId: r!.id, changes: { sizeBytes: gz.byteLength, leads: counts.leads ?? 0, files: files.length, skippedFiles: skippedFiles.length } });
    return r!;
  });
  // Keep 14 days.
  const old = await withSystemTx((tx) => tx.select().from(backups).where(and(eq(backups.orgId, ctx.orgId), isNull(backups.deletedAt), lt(backups.createdAt, new Date(now.getTime() - KEEP_DAYS * 86400_000)))));
  for (const b of old) {
    await store.remove(b.storageKey).catch(() => undefined);
    await withSystemTx((tx) => tx.update(backups).set({ deletedAt: new Date() }).where(eq(backups.id, b.id)));
  }
  return { backup: row, skippedFiles, removed: old.length };
}

/** Whether this install has somewhere to write backups (Settings → Backups warns when it has not). */
export const backupStorageReady = () => fileStore() !== null;

/** Job `backup.nightly`: once a day after 01:00 IST. */
export async function nightlyBackup(ctx: Ctx, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const istHour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  if (istHour < 1) return { skipped: "Waits until 01:00 IST" };
  const today = new Date(`${todayIST(now)}T00:00:00+05:30`);
  const [done] = await withSystemTx((tx) => tx.select({ id: backups.id }).from(backups)
    .where(and(eq(backups.orgId, ctx.orgId), isNull(backups.deletedAt), sql`${backups.createdAt} >= ${today.toISOString()}::timestamptz`)).limit(1));
  if (done) return { skipped: "Already backed up today" };
  if ((deps.store === undefined ? fileStore() : deps.store) === null) return { skipped: "File storage is not set up" };
  const r = await runBackupInternal(ctx, deps);
  return { backupId: r.backup.id, removed: r.removed };
}

export const listBackups = defineService({
  name: "backup.list",
  input: z.object({}).default({}),
  permission: "settings.read",
  handler: (ctx, _i, tx) => tx.select().from(backups).where(and(eq(backups.orgId, ctx.orgId), isNull(backups.deletedAt))).orderBy(desc(backups.createdAt)).limit(30),
});

function assertOwner(ctx: Ctx) {
  if (!(ctx.actor.kind === "human" && ctx.actor.role === "owner")) throw new AppError("FORBIDDEN", "Only an owner can make or download a backup: it holds all the company's data.");
}

/** "Back up now" (Settings → Backups): owners only. */
export async function backupNow(ctx: Ctx, deps: Deps = {}) {
  assertOwner(ctx);
  const r = await runBackupInternal(ctx, deps);
  return { id: r.backup.id, sizeBytes: r.backup.sizeBytes, skippedFiles: r.skippedFiles.length };
}

/** The file of one backup, for download: owners only. */
export async function getBackupFile(ctx: Ctx, raw: { backupId: string }, deps: Deps = {}) {
  assertOwner(ctx);
  const { backupId } = z.object({ backupId: z.string().uuid() }).parse(raw);
  const [b] = await withSystemTx((tx) => tx.select().from(backups).where(and(eq(backups.id, backupId), eq(backups.orgId, ctx.orgId), isNull(backups.deletedAt))));
  if (!b) throw notFound("Backup");
  const data = await storeOrFail(deps).get(b.storageKey);
  await withSystemTx((tx) => audit(tx, ctx, { action: "backup.download", entityType: "backup", entityId: b.id }));
  return { fileName: `inquira-backup-${b.createdAt.toISOString().slice(0, 10)}.json.gz`, data };
}

/** Tables ordered so every table comes after the tables its foreign keys point to (read from the database). */
async function restoreOrderInternal(tx: Tx, names: string[]): Promise<string[]> {
  const fks = await tx.execute<{ child: string; parent: string }>(sql`
    select c.relname as child, p.relname as parent from pg_constraint k
    join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f' and n.nspname = 'app' and c.relname <> p.relname`);
  const wanted = new Set(names);
  const parents = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
  for (const f of fks) if (wanted.has(f.child) && wanted.has(f.parent)) parents.get(f.child)!.add(f.parent);
  const out: string[] = [];
  const done = new Set<string>();
  const visit = (n: string, path: Set<string>) => {
    if (done.has(n) || path.has(n)) return;
    path.add(n);
    for (const p of [...parents.get(n)!].sort()) visit(p, path);
    path.delete(n);
    done.add(n);
    out.push(n);
  };
  for (const n of [...names].sort()) visit(n, new Set());
  return out;
}

export function readBackup(gz: Uint8Array): BackupFile {
  const b = JSON.parse(gunzipSync(gz).toString("utf8")) as BackupFile;
  if (b.format !== BACKUP_FORMAT || !b.orgId || !b.tables?.organizations) throw new Error("This is not an Inquira backup file (or a newer format).");
  return b;
}

/**
 * Restores a backup into a database that has every migration applied and does not have this company yet
 * (`npm run backup:restore`, docs/RUNBOOK.md). Rows go back exactly as they were; memberships are matched to
 * existing sign-in accounts by email; connections come back as "not connected" because keys are never in a
 * backup; document files are written back to file storage.
 */
export async function restoreBackupInternal(tx: Tx, file: BackupFile, deps: Deps & { createLocalAccounts?: boolean } = {}) {
  const [exists] = await tx.execute<{ id: string }>(sql`select id from app.organizations where id = ${file.orgId}`);
  if (exists) throw new Error("This company already exists in this database. Restore into an empty database (or remove it first).");
  const order = await restoreOrderInternal(tx, Object.keys(file.tables));
  const counts: Record<string, number> = {};
  for (const t of order) {
    if (EXCLUDED.has(t)) continue;
    const rows = file.tables[t] ?? [];
    if (!rows.length) continue;
    await tx.execute(sql`insert into ${ident(t)} select * from json_populate_recordset(null::${ident(t)}, ${JSON.stringify(rows)}::json)`);
    counts[t] = rows.length;
  }
  await tx.execute(sql`update app.integrations set status = 'not_connected', backoff_until = null where org_id = ${file.orgId}`);
  await tx.execute(sql`
    update app.memberships m set user_id = u.id from auth.users u
    where m.org_id = ${file.orgId} and lower(u.email) = lower(m.email) and m.user_id <> u.id`);
  // Local mode (AUTH_MODE=local) keeps its own sign-in accounts: give each member without one an account with no
  // password, so `npm run local:sign-in-link -- <email>` can let them in. Cloud mode uses Supabase Auth instead.
  let accounts = 0;
  if (deps.createLocalAccounts) {
    const made = await tx.execute(sql`
      insert into auth.users (id, email)
      select distinct on (lower(m.email)) m.user_id, lower(m.email) from app.memberships m
      where m.org_id = ${file.orgId} and m.email is not null
        and not exists (select 1 from auth.users u where lower(u.email) = lower(m.email) or u.id = m.user_id)
      order by lower(m.email), m.created_at
      returning id`);
    accounts = made.length;
  }
  if (file.files.length) {
    const store = storeOrFail(deps);
    for (const f of file.files) {
      // A file that survived (same storage) is left as it is; only missing ones are written back.
      const present = await store.get(f.storageKey).then(() => true, () => false);
      if (!present) await store.put(f.storageKey, new Uint8Array(Buffer.from(f.base64, "base64")), "application/octet-stream");
    }
  }
  return { counts, files: file.files.length, skippedFiles: file.skippedFiles, accounts };
}
