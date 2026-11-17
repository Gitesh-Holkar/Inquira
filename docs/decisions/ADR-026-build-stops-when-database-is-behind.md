# ADR-026: A hosted build stops when the database is behind the code

- **Status:** Accepted
- **Date:** 17 Nov 2026
- **Requirement:** GOAL G-PLT (the live site must keep working); adds to [ADR-002](ADR-002-local-postgres-and-https-migrations.md)

## Context

The hosting branch deploys on every push. Migrations are applied separately ([ADR-002](ADR-002-local-postgres-and-https-migrations.md)): over HTTPS from an agent session, or with `npm run db:migrate`. On 17 Nov 2026 the access token for the HTTPS route had expired, so two new columns could not be added from the session, while the code that reads them was ready to push.

## Problem

Code that selects a column the database does not have fails on every page that reads it. A push must never be able to put the live site in that state, whoever applies migrations and whenever.

## Options

1. Apply migrations during the build. Rejected for now: it changes who alters the live schema (ADR-002) and needs the owner's approval; it also cannot be verified from an agent session.
2. Hold pushes until someone confirms the migration. Rejected: unpushed work in a temporary container can be lost, and it relies on memory.
3. Let the build check the database and stop if it is behind.

## Decision

Option 3. `next.config.ts` runs a read-only check at the start of a production build on the host (`VERCEL` set, or `CHECK_MIGRATIONS=1`): every migration in `drizzle/meta/_journal.json` must be recorded in `drizzle.__drizzle_migrations`. If one is missing, or the check itself cannot run, the build stops with a plain message. A stopped build never replaces the running deployment.

`npm run db:manual-sql -- <names>` prints the SQL for pending migrations, with the same bookkeeping row the other two routes write, for an owner who has only the database's SQL editor.

## Reasoning

The check fails safe in every case: a missing variable, an unreachable database and a missing migration all leave the current version running. It lives in `next.config.ts` because that file is loaded by every build, whatever build command the host is set to use. It changes nothing in the database, so ADR-002 stands.

## Consequences

- After a push that includes a migration, the new version goes live only when the migration is applied and the deployment is run again (the next push, or Redeploy on the host).
- The host shows a failed deployment in the meantime. That is the check working.
- Local builds and tests are not affected.
