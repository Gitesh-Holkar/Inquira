# ADR-029: Local mode runs in Docker with its own sign-in, scheduler and file storage

- **Status:** Accepted
- **Date:** 18 Nov 2026
- **Requirement:** GOAL G-PLT-5 (local mode), G-PLT-6 (adapters), G-OSS-2 (example data by default)

## Context

The owner wants to run Inquira himself, on his own computer, and has deferred the open-source release. The app depended on Supabase for sign-in and storage and on Supabase `pg_cron` for scheduling.

## Problem

How does Inquira run on one computer, with one command, without Supabase, while every feature keeps working and the cloud version stays unchanged?

## Options

1. A native installer per operating system. Rejected: three installers to build and test, and Postgres to install by hand.
2. `npm run` scripts on the host. Kept for developers only: needs Node and Postgres installed.
3. **Docker Compose:** Postgres, the app and a worker in three containers, started with `docker compose up -d`.

## Decision

Option 3, with three seams:

- **Sign-in** `AUTH_MODE=local` (`src/lib/local-auth.ts`): scrypt password hashes in the local `auth.users` table, a session cookie signed with `APP_ENCRYPTION_KEY` over the user id, expiry and a fingerprint of the password hash (a new password ends old sessions). New members set their password with a one-time link (hash stored, 7 days, single use) shown on the Members screen; there is no email. A fresh install with a company and no members shows **Create the owner account** once; it closes for good when anyone is a member and never opens in any other mode.
- **Scheduler:** the `worker` container calls the same `/api/cron/tick` endpoint as `pg_cron` ([ADR-007](ADR-007-jobs-and-one-cron-endpoint.md)), every 10 minutes.
- **File storage:** the disk implementation from [ADR-027](ADR-027-documents-and-accounts-through-the-server.md), on a Docker volume.

`scripts/local-setup.ts` runs before the app on every start: it creates the keys once (saved in the data volume), applies the shim and migrations, and seeds `SEED_DIR` (default `seed/example`, a fictional company) without an owner. The port is bound to `127.0.0.1` by default.

## Reasoning

Docker Desktop is one install on Windows and Mac and gives the same Postgres everywhere. Reusing the tick endpoint and the shim keeps one code path for cloud and local. Local sign-in is real authentication (not development sign-in, which stays refused in production builds), so `tests/sign-in.test.ts` includes it.

## Consequences

- The image is large (about 2 GB) because it keeps the build tools that run migrations and the seed on start.
- Local mode uses plain http; sharing it on a network is documented as "trusted networks only".
- Claude on the web cannot reach a local install; Claude Code or Claude Desktop on the same computer can.
- Development sign-in (`AUTH_MODE=dev`) remains for tests and development.
