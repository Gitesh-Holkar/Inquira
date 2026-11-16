# ADR-005 — How row-level security applies

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
People, MCP tokens and background jobs all reach the same tables.

## Problem
Which callers run under RLS and how the others are kept inside one company.

## Options
- Everything under RLS with per-request tokens.
- People under RLS; system actors as table owner with explicit company filters.

## Decision
**Human requests** run inside a transaction that does `set local role authenticated` and sets `request.jwt.claims` to `{sub:<user id>}`, exactly as Supabase's Data API does, so the membership policies apply. **System actors** (cron, MCP tokens) connect as the table owner, which bypasses RLS; their services always filter by `org_id`, and tests cover cross-company isolation. Members can read their company's data; owner, admin and sales can write operational tables; only owner and admin can write catalogue, rates, templates, rules, settings and integrations; `mcp_tokens` is owner and admin only; `integration_secrets` and the OAuth tables allow no access at all to `authenticated`.

## Reasoning
RLS protects against mistakes in human paths; explicit filters plus tests protect system paths.

## Consequences
`tests/rls.test.ts` proves company A cannot read or modify company B's data. New tables extend that test.
