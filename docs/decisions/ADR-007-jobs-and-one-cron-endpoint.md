# ADR-007 — Background work: outbox, job table and one cron endpoint

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
Free hosting has no always-on worker and only short function runs.

## Problem
How to run syncs and future background work reliably.

## Options
- Vercel Cron (the Hobby plan is daily only).
- An always-on worker (not available on free hosting).
- A job table drained by one endpoint that a database cron calls.

## Decision
The `events` table is the domain outbox. The `jobs` table is the work queue: jobs are claimed with `FOR UPDATE SKIP LOCKED` and retried with exponential backoff (10 minutes doubling, capped at 6 hours); a `dedupe_key` allows only one queued sync per company per type. `POST /api/cron/tick` (header `x-cron-secret`) enqueues the sync jobs for every company and then runs due jobs. Supabase `pg_cron` plus `pg_net` calls it every 10 minutes.

## Reasoning
It needs no extra service and survives function time limits.

## Consequences
Every job needs a time budget and a saved position. Local mode replaces the database cron with a small worker loop (GOAL G-PLT-5).
