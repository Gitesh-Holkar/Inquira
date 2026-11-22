/**
 * Restores an Inquira backup (GOAL G-PLT-7) into the database in DATABASE_URL.
 *
 *   npm run backup:restore -- <inquira-backup-YYYY-MM-DD.json.gz>            # show what is inside, write nothing
 *   npm run backup:restore -- <file> --confirm                               # restore it
 *
 * The database must have every migration applied (npm run db:migrate) and must not have this company yet.
 * Document files go back to the file storage this install uses (FILE_STORAGE / the Supabase bucket).
 * In local mode (AUTH_MODE=local) members without a local account get one with no password (see local:sign-in-link).
 * Afterwards: sign in, then re-enter the Gmail, TradeIndia, IndiaMART and AI keys (they are never in a
 * backup). Steps: docs/RUNBOOK.md, "Restore a backup".
 */
import { readFileSync } from "node:fs";
import { closeDb, withSystemTx } from "@/db/client";
import { readBackup, restoreBackupInternal } from "@/modules/backup/service";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: npm run backup:restore -- <backup.json.gz> [--confirm]");
    return 1;
  }
  const b = readBackup(new Uint8Array(readFileSync(file)));
  const org = (b.tables.organizations?.[0] ?? {}) as { name?: string };
  console.log(`Backup of "${org.name ?? b.orgId}" made ${b.createdAt}`);
  for (const [t, rows] of Object.entries(b.tables)) if (rows.length) console.log(`  ${t.padEnd(24)} ${rows.length}`);
  console.log(`  document files            ${b.files.length}${b.skippedFiles.length ? ` (${b.skippedFiles.length} could not be included: missing from storage or over the size limit; they stay in file storage)` : ""}`);
  if (!args.includes("--confirm")) {
    console.log("\nNothing written. Add --confirm to restore.");
    return 0;
  }
  const local = process.env.AUTH_MODE === "local";
  const r = await withSystemTx((tx) => restoreBackupInternal(tx, b, { createLocalAccounts: local }));
  console.log(`\nRestored ${Object.values(r.counts).reduce((a, n) => a + n, 0)} rows and ${r.files} files.`);
  if (local && r.accounts) console.log(`Made ${r.accounts} sign-in accounts without a password: npm run local:sign-in-link -- <email> gives each person a link to set one.`);
  console.log("Next: sign in, then re-enter the Gmail, TradeIndia, IndiaMART and AI keys in Settings (they are never in a backup).");
  return 0;
}

main().then((c) => closeDb().then(() => process.exit(c)), (e) => { console.error((e as Error).message); closeDb().then(() => process.exit(1)); });
