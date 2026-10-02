# PROGRESS

**Resume prompt** (use this if a session is interrupted):
> Resume the Inquira build in the `inquira` repository only. Read CLAUDE.md, then PROGRESS.md, and continue from "Next step". Follow all rules in docs/ and CLAUDE.md.

**Current task:** Full code audit + fixes (done, 2 Oct 2026). See the session log below.
**Next step:** Gitesh finishes setup (sign-in per docs/SETUP.md §4, then Gmail, TradeIndia, cron, Claude). A future session picks up from the ROADMAP or from open QUESTIONS. Start with docs/CODEMAP.md to find code.

---

## Morning handover (29 Sep 2026)

### 1. What's done and working
The whole MVP from the brief (§7) is built, tested and pushed to branch `claude/adoring-franklin-51jsvk`:
- **Lead inbox and lead detail:**
  - filters (source, status, product, dates), search, International view
  - one-tap WhatsApp (editable text → wa.me), Call, Copy phone/email, Create quote draft
  - keyboard shortcuts `j k e w q ?`
  - notes, status timeline, audit trail
  - phone cards and bottom navigation on mobile
- **Syncing:**
  - Gmail: history-ID incremental with fallback, OAuth connect/reconnect.
  - TradeIndia API: 30-day backfill, then every 10 minutes.
  - Deterministic parsers for all 9 IndiaMART/TradeIndia email formats found in your mailbox, with 17 anonymised fixtures.
  - API and email copies of the same TradeIndia inquiry become one lead (matched by `rfi_id`).
- **Review queue** for emails the parsers can't decide. Claude handles them through MCP; low-confidence ones wait for you. "Always ignore @domain" turns a correction into a rule.
- **Rates:**
  - 66 products and 70 rates from your file and stdmfood.com
  - spreadsheet-style bulk editor with highlighted changes and "Save N changes"
  - append-only history
- **Quote drafts:**
  - uses the current rate, keeps a price snapshot, adds a validity date (3 days, configurable)
  - uses **your real Gmail signature**
  - the draft goes **in the inquiry's Gmail thread**; the app never sends
- **Templates** (quotation email and WhatsApp) with a live preview, worded like your sent quotations.
- **MCP server** `/api/mcp`:
  - 12 tools
  - OAuth 2.1 so claude.ai custom connectors work, plus bearer tokens for Claude Code and the Inspector
  - untrusted-email delimiting
  - every call audited
- **IndiaMART buy-lead** rules and MCP tools, a decision log and a dashboard card, plus the ready-to-paste Cowork prompt with test mode (`docs/COWORK_INDIAMART_TASK.md`).
- **Dashboard:** new leads by source, needing action, review queue, reconciliation ("X received, Y classified, Z pending"), integration health.
- **Security:**
  - RLS on all 26 tables, with an org-isolation test
  - AES-256-GCM for stored credentials; hashed tokens
  - security headers and rate limits
  - private `app` schema
- **Supabase project `inquira` (Mumbai):** all 3 migrations applied and seeded (1 org, 66 products, 70 rates, your owner account, RLS 26/26, private `documents` bucket). Last checked from a helper session at 03:44 IST.
- **Quality:**
  - 109 unit/integration tests (incl. every service as a signed-in role under RLS), 10 Playwright tests (desktop 1440 + phone 390)
  - typecheck, lint and `next build` all pass
  - screenshots in `docs/screenshots/`

**How to open it:** deploy per [SETUP §3](docs/SETUP.md#3-deploy-to-vercel) (about 10 min), then sign in per [§4](docs/SETUP.md#4-your-first-sign-in). To look around locally without any accounts, see [SETUP §9](docs/SETUP.md#9-run-on-your-own-computer-optional) ("Without Supabase"): demo data plus dev sign-in.

### 2. What's incomplete / not verified
- **Not tested against the live Gmail and TradeIndia APIs.** No credentials were available overnight. Both are covered by tests against faithful fakes built from your real email formats. TradeIndia's JSON field names come from its public integration format and the adapter tolerates variants; see [TRADEINDIA_API.md](docs/TRADEINDIA_API.md). **The first real sync is the real test:** check Settings → Recent sync runs.
- The **pg_cron schedule** (SETUP §8) needs your app URL first, so it's one of your steps. All 3 migrations are applied, including the private `documents` storage bucket for future COA/TDS files.
- **Deliberately not built:**
  - an in-app members screen (add teammates with the SQL in SETUP §4)
  - CIMD (claude.ai falls back to DCR, which works)
  - a nonce-based CSP

  See SECURITY "Known limitations" and ROADMAP.

### 3. Your steps (about 45 minutes)
1. **Deploy to Vercel** and set the environment variables → [SETUP §2–3](docs/SETUP.md#2-environment-variables). Generate `APP_ENCRYPTION_KEY` and `CRON_SECRET` there.
2. **Supabase login URLs** (Site URL + `/auth/callback`) → [SETUP §1](docs/SETUP.md#1-supabase).
3. **Set your password** with "Forgot password? / First time here?" (there is no sign-up button; the owner account already exists) → [SETUP §4](docs/SETUP.md#4-your-first-sign-in).
4. **Google Cloud OAuth client** (Gmail API, both scopes, publish to *Production*, the redirect URI) → **Connect Gmail** → [SETUP §5](docs/SETUP.md#5-connect-gmail).
5. **TradeIndia**: User ID / Profile ID / Key → Test connection → [SETUP §6](docs/SETUP.md#6-connect-tradeindia).
6. **pg_cron** 10-minute schedule → [SETUP §8](docs/SETUP.md#8-schedule-the-10-minute-sync).
7. **Connect Claude** (claude.ai → Connectors → `https://YOUR-APP/api/mcp`) → [SETUP §7](docs/SETUP.md#7-connect-claude-mcp-server).
8. **Cowork IndiaMART task** in test mode → [COWORK_INDIAMART_TASK.md](docs/COWORK_INDIAMART_TASK.md).
9. Review the **4 flagged rates** on the Rates screen (orange "Confirm" badge): fix the value, or click **Mark correct**, then **Save**.

### 4. Most important questions ([QUESTIONS.md](QUESTIONS.md))
- **Q-001:** Are the rates GST-exclusive? I assumed yes (your sent quotes say "GST extra").
- **Q-002:** MOQ is left empty. Should it be 100 kg by default, as in your emails?
- **Q-003:** The website says "Concentrate" but the rates file says "Isolate" for quinoa, oats, lentil and hemp. Which is correct?
- **Q-005:** 4 rates flagged: Spirulina "White", Soya Isoflavones GST, Oats Fiber, Soya Flour pack size.
- **Q-009:** Quotes to IndiaMART buyers with no email address. The draft is created without a recipient; is that OK?

---

## Checklist (build order, brief §8)
- [x] 0. Phase A: Gmail samples → 17 anonymised fixtures + `docs/EMAIL_FORMATS.md`; `seed/rates.json` (70), `seed/products.json` (66, after crawling 50 stdmfood.com pages); resume scheduled (trigger `trig_01MkFUSSb63XEULCu98HgQZQ`, 04:10 IST); Supabase verified.
- [x] 1. Repo, docs skeleton, CLAUDE.md, PROGRESS.md
- [x] 2. Schema (26 tables, private `app` schema), migrations, RLS + tests; Supabase Auth + dev auth; seed — **applied to the real Supabase project**
- [x] 3. Service layer (`defineService`), audit, events, roles and permissions
- [x] 4. Catalog, rates import, rates UI (bulk edit + history)
- [x] 5. Leads, contacts dedupe, inbox, lead detail, WhatsApp
- [x] 6. Gmail OAuth, sync, parsers + fixtures + tests, classification rules, review queue
- [x] 7. TradeIndia adapter + sync, backfill, run logs, API↔email dedupe
- [x] 8. Templates, quote drafts with signature + threading
- [x] 9. MCP server + OAuth 2.1 + tools; buy-lead rules UI + MCP tools + COWORK_INDIAMART_TASK.md
- [x] 10. Dashboard
- [x] 11. Hardening: security headers, rate limiting, error/empty/loading states, global error pages
- [x] 12. Final pass: docs, tests/typecheck/lint/build, Playwright + screenshots

## Session log
- **02:15 IST — Phase A.**
  - Repo was empty.
  - The network blocked Supabase, stdmfood.com and TradeIndia.
  - Gmail sampling done, fixtures anonymised, rates parsed.
- **02:36 IST.**
  - Gitesh configured Supabase, env vars and the network.
  - Website crawled.
  - Supabase connectivity verified from a child session (the build container itself can't see new env vars and has no Postgres TCP).
- **02:40–03:20 IST.** Schema, RLS, catalog, leads, parsers (31 fixture tests), Gmail/TradeIndia sync, quotes, MCP + OAuth (94 tests).
- **03:20–03:35 IST.**
  - UI (Next 16).
  - Playwright found and fixed a mobile grid overflow, a hydration/dev-origin issue (use `localhost`) and empty-env parsing.
- **03:38 IST.**
  - Real Supabase migrated (0000–0001) and seeded over HTTPS by helper sessions.
  - `SEED_OWNER_EMAIL` had angle brackets; the parser now accepts that.
- **03:45 IST.**
  - Docs (SETUP, ARCHITECTURE, SECURITY, DECISIONS, …).
  - Migration 0002 (storage bucket) applied to Supabase.
  - Safety fix: the review queue never offers domain-wide ignore for gmail.com etc.
  - Hash-token password links handled.
  - Final checks green: typecheck, lint, 95 tests, `next build`, 6/6 Playwright.
- **01 Oct 2026.** Vercel project had no production deployment; pushed a note to trigger the first production build from the production branch.
- **2 Oct 2026 — full audit (backend + frontend), fixes, CODEMAP.**
  - **Critical, fixed:** saving Gmail/TradeIndia credentials, Connect Gmail and Disconnect failed for every signed-in user ("permission denied for table integration_secrets"): those services ran under RLS, and `authenticated` can't touch secrets. Now `defineService({ runAs: "system" })`; network-calling services use the new `defineExternalService`. Tests only used system contexts, so this was missed → new `tests/human-paths.test.ts` runs every service as owner/sales/viewer under RLS.
  - **Sign-in:** clear messages for "no password yet", expired link, link opened in another browser, Supabase email rate limit, and accounts without an organisation (previously a silent loop back to the login page); email links and redirects use the address actually in use (a wrong APP_URL no longer breaks them); `token_hash` links supported (SETUP §4); admin banner when APP_URL ≠ the site address.
  - **Sync:** Gmail stops after a 35 s budget (backlog continues next run), skips already-stored ids, drops messages deleted in Gmail (were retried forever), retries 403 rate limits; cron starts no new job after 20 s and claims one at a time.
  - **Correctness:** dashboard "new today" counts by arrival (a 30-day backfill showed as today); back-dated rates refused (they never became current); flagged rates can be confirmed ("Mark correct"); buy-lead cap counted correctly in test mode and clicks in test mode flagged; manual lead with invalid phone rejected; lead can't link another org's product; phone search ignores spaces/leading 0; quote From/headers encoded and injection-safe; OAuth client secret compared in constant time; missing audit rows added (rule bulk-apply, token refresh, bootstrap rows).
  - **UI:** Enter on a focused button no longer opens the selected lead; viewers don't see classify buttons; WhatsApp can't open with empty text; status picker follows outside changes; Templates/IndiaMART reachable on phones; "always ignore" rule failure reported separately.
  - **Cleanup:** removed dead functions (getEmail, getContact, addGrade, previewTemplate, countEventsSinceInternal, diff, conflict, truncate, collapseWhitespace, DialogTrigger/Close) and 9 unused npm packages. `npm audit --omit=dev`: 0 vulnerabilities.
  - **Docs:** new `docs/CODEMAP.md` (every file/function/route/job → purpose, plus "I want to change X → edit Y"); CLAUDE.md requires keeping it current.
  - Checks: typecheck, lint, 109 tests, `next build`, 10/10 Playwright all green.
