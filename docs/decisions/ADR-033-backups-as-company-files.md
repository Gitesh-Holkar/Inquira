# ADR-033: Backups are one file per company in the company's own file storage

- **Status:** Accepted
- **Date:** 22 Nov 2026
- **Requirement:** GOAL G-PLT-7 (nightly backup and a tested restore)

## Context

Inquira runs in two ways: in the cloud (Supabase and Vercel) and on one computer (Docker, ADR-029). Supabase's own database backups depend on the plan; a local install has none. The owner must be able to keep a copy of the company's data somewhere else and get it back.

## Problem

How does every install get a nightly backup and a restore that is tested, without a new service, a new dependency or database superuser rights?

## Options

1. **`pg_dump` from a job.** Needs the `pg_dump` program next to the app (not on Vercel) and dumps every company in a database together; restoring one company is not possible.
2. **Rely on the host** (Supabase backups, Docker volume exports). Different in each mode, outside the app, nothing to test, and the owner cannot download a copy from the app.
3. **One gzipped JSON file per company, written by the app.** Every row of every table with an `org_id` (read with `json_agg`, so it restores exactly with `json_populate_recordset`), plus the document files, written by a nightly job to the same file storage as documents (Supabase bucket or a folder).

## Decision

Option 3.

- Job `backup.nightly` runs once a day after 01:00 IST; backups older than 14 days are removed. Owners can make one now and download any of them (Settings → Backups); both are audited.
- Never in a backup: encrypted keys, Claude connector tokens and sign-in codes, the job queue, the event outbox. After a restore, connections come back as "not connected" and are entered again.
- Document files are included up to 40 MB in total per backup; the rest stay in file storage and are listed in the file.
- `npm run backup:restore` restores into a database that has every migration and does not have the company yet, in one transaction, in foreign-key order read from the database. Members are matched to sign-in accounts by email; in local mode, members without an account get one without a password (a one-time link sets it).

## Reasoning

- The same code and the same test (`tests/operations.test.ts`) cover both modes, and the restore is exercised end to end on every test run.
- A new table is backed up without anyone remembering to add it; only tables that hold secrets need listing, and that list is small and tested.
- No new library: Node's `zlib` and Postgres' JSON functions are enough.

## Consequences

- A backup lives next to the data it protects. Owners must download one now and then and keep it elsewhere; Settings, `docs/SETUP.md` and `docs/RUNBOOK.md` say so.
- In the cloud, backups need `SUPABASE_SERVICE_ROLE_KEY` (file storage). Without it the screen says backups cannot run.
- A company with very many rows makes a large file in memory. Fine for one supplier's leads for years; revisit (stream table by table) if a backup passes about 100 MB.
- Restoring over a live company is refused on purpose. Going back to an older state of a running install means restoring into a fresh database and switching to it.
