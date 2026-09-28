# PROGRESS

**Resume prompt (use this if a session is interrupted):**
> Resume the Inquira build in the `inquira` repository only. Read CLAUDE.md, then PROGRESS.md, and continue from "Next step". Follow all rules in docs/ and CLAUDE.md.

**Current task:** 1 — Repo, docs skeleton, CLAUDE.md
**Next step:** Scaffold the Next.js app (package.json, tsconfig, Tailwind, shadcn/ui primitives), then write the docs skeleton.

## Checklist (build order, brief §8)
- [x] 0. Phase A: Gmail samples → `fixtures/emails/` (17 anonymised), `docs/EMAIL_FORMATS.md`, `seed/rates.json` (70 rates), `seed/products.json` (62 products), resume scheduled. Supabase is **not** connected from this container (network policy); see QUESTIONS Q-004.
- [ ] 1. Repo, docs skeleton, CLAUDE.md, PROGRESS.md
- [ ] 2. Schema, migrations, RLS + RLS tests; auth; seed org + owner
- [ ] 3. Service layer, audit log, events, roles/permissions
- [ ] 4. Catalog, rates import, rates UI
- [ ] 5. Leads, contacts dedup, inbox, lead detail, WhatsApp button
- [ ] 6. Gmail OAuth, sync, parsers + fixtures/tests, classification rules, review queue
- [ ] 7. TradeIndia adapter + sync, backfill, run logs, API↔email duplicate check
- [ ] 8. Templates, quote drafts with signature + threading
- [ ] 9. MCP server + auth + tools; buy-lead rules UI, buy-lead MCP tools, COWORK_INDIAMART_TASK.md
- [ ] 10. Dashboard
- [ ] 11. Hardening: headers, rate limiting, error/empty/loading states
- [ ] 12. Final pass: docs, tests, typecheck, lint, Playwright smoke, SETUP.md walkthrough

## Session log
- **2026-09-29 02:15 IST (session 1, Phase A).**
  - Repo was empty.
  - The container's network policy blocks supabase.com, stdmfood.com and tradeindia.com, and raw Postgres ports are closed. Local Postgres 16 binaries are available, so development and tests run against a local Supabase-compatible Postgres.
  - Gmail connector read-only sampling is done.
  - Website products come from search results plus the rates file.
