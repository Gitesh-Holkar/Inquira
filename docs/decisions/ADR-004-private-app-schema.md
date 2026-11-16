# ADR-004 — Data lives in a private `app` schema

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
Supabase exposes the `public` schema over its Data API. With data in `public`, a signed-in user could use their token to write rows directly and skip validation and audit.

## Problem
How to stop token holders from bypassing the service layer.

## Options
- `public` with read-only grants (writes would then bypass RLS through the owner connection).
- A private schema the Data API does not expose.

## Decision
All tables are in schema `app`, which the Data API does not expose. `anon` has no access to it. RLS is still enabled on every table as defence in depth.

## Reasoning
The service layer stays the only way to write.

## Consequences
Do not add `app` to Supabase "Exposed schemas".
