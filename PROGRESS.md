# PROGRESS

**Resume prompt (use this if a session is interrupted):**
> Resume the Inquira build in the `inquira` repository only. Read CLAUDE.md, then PROGRESS.md, and continue from "Next step". Follow all rules in docs/ and CLAUDE.md.

**Current task:** 3–5 — service layer, catalog, leads (in progress)
**Next step:** Write `scripts/seed.ts`, then the email parsers and UI.

## Checklist (build order, brief §8)
- [x] 0. Phase A:
  - Gmail samples → `fixtures/emails/` (17 anonymised) and `docs/EMAIL_FORMATS.md`.
  - `seed/rates.json`: 70 rates.
  - `seed/products.json`: 66 products; the 50 stdmfood.com product pages were crawled.
  - Resume scheduled for 04:10 IST (trigger `trig_01MkFUSSb63XEULCu98HgQZQ`).
  - **Supabase verified** from a fresh session in the updated environment (child session `session_012ZTD6R1V3eiZRetBsnxisW`, 02:36 IST): 7/7 env vars, project in ap-south-1, `select 1` OK on Postgres 17.6, Auth health 200, admin API 200, DATABASE_URL = 6543 pooler for the right ref.
  - The running build container gets network changes live but **not env vars**. Remote DB work (apply migrations + seed) is therefore done from a fresh session: `npm run db:remote:apply && npm run db:seed`.
- [x] 1. Repo, docs skeleton, CLAUDE.md, PROGRESS.md
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
- **2026-09-29 02:36 IST.**
  - Gitesh finished the Supabase setup.
  - The network is opened for supabase/stdmfood/tradeindia.
  - Website crawled.
  - Supabase connectivity verified via a child session.
- **02:40 IST.**
  - Schema (26 tables, `app` schema) and RLS migrations are done.
  - RLS isolation tests pass.
  - Catalog and leads services are done, with tests for dedupe and permissions.
