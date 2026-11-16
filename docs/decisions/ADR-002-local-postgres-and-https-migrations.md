# ADR-002 — Local Supabase-compatible Postgres for development and tests; migrations over HTTPS

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
The cloud build container cannot open TCP connections to Postgres (only HTTPS through a proxy). At the time it also had no Docker daemon.

## Problem
How to develop and test row-level security against real Postgres, and how to migrate the hosted database, from that container.

## Options
- Supabase CLI (`supabase start` needs Docker; `db push` needs TCP).
- pglite (no roles, so no RLS parity).
- A plain local Postgres with a small shim, plus the Supabase Management API for the hosted project.

## Decision
Development and tests use a local Postgres 16 (`scripts/local-db.sh`) plus `scripts/local-db/supabase-shim.sql`, which provides the `anon`, `authenticated` and `service_role` roles, `auth.users` and `auth.uid()`. The hosted project is migrated with `npm run db:remote:apply` (Management API `POST /v1/projects/{ref}/database/query`) and seeded with `npm run db:remote:seed`. Both use the same bookkeeping table as Drizzle's migrator. From a normal machine, `npm run db:migrate` and `npm run db:seed` work directly.

## Reasoning
RLS policies must be tested against real Postgres semantics, and the hosted project had to be reachable over HTTPS only.

## Consequences
Never edit an applied migration; add a new one. The same shim is the basis of local mode (GOAL G-PLT-5).
