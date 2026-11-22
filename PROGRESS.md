# PROGRESS

**Resume prompt** (use this if a session is interrupted):
> Continue Inquira in this repository only. Read `AGENTS.md`, then this file and `QUESTIONS.md`, then `docs/INDEX.md`. Work on the first milestone below that is not done. The goal is `docs/GOAL.md`.

## Current state (18 Nov 2026)

- **Goal:** `docs/GOAL.md` (requirement IDs `G-…`). **Rules:** `AGENTS.md`. **Where things are:** `docs/INDEX.md`, `docs/CODEMAP.md`.
- **Working on:** M5 (AI layer) is built and waits at its owner gate: a Gemini key on Settings → AI (SETUP 6b) for the live check. M4 waits at its gate too (SETUP 6a). Next: M6 (knowledge base and lead score); M1 stays deferred (Q-016).
- **Live site:** deployed on Vercel from this branch. Sign-in is on again. The live database still has the September rates and has **not** had migrations `0003` and `0004` applied.
- **Order note:** the owner sent the November price list and quotation terms on 16 Nov and asked for them, so M3 was done before M1 and M2. Its one dependency on M1 (seed folders) was done with it: `seed/stdm/` and `SEED_DIR`. The fictional `seed/example` and the "nothing in `src/` names the company" test are still M1.

## Handover of 16 Nov 2026

The owner ran a research and audit phase and handed over a wider goal:

1. Inquira becomes an open-source lead desk that also runs on one laptop.
2. STDM will have the IndiaMART CRM API (Push and Pull) and the TradeIndia Inquiry API. The sales mailbox is on Google Workspace.
3. AI becomes three optional tiers (Basic on a free key with redacted input, Advanced on an API key, and the existing Claude connector). The app must work with all of them off.
4. The app will send email through an outbound pipeline with hold rules and modes. "Drafts only" stays in force until that milestone is merged.
5. An audit found bugs in untested paths (milestone M0).
6. A new price list replaces the September one (milestone M3).
7. `AGENTS.md` replaces `CLAUDE.md` as the single rulebook.

Owner's instruction of the same day: **fewer features that are complete, not more that are partial** (now in `AGENTS.md` section 2).

## Plan: milestones

Work in order, one at a time. Stop at every **OWNER GATE**.

| # | Milestone | GOAL requirements | Status |
| --- | --- | --- | --- |
| M0 | Safe and correct: sign-in back on, seven audit bugs, November email fixtures | G-PLT-1, G-SRC-3, G-SRC-4 | Done (17 Nov). Owner still to do `docs/RUNBOOK.md` section 1 |
| M1 | Open-source foundation: licence, seed sets, README, CONTRIBUTING, secret scan | G-OSS-1 to G-OSS-4, P6 | **Deferred by the owner (17 Nov 2026, Q-016).** Seed folders done with M3; example data and the company-name scan come with M2 |
| M2 | Local mode: adapters, local sign-in, Docker packaging, self-hosting guide | G-PLT-5, G-PLT-6 | **Done 18 Nov 2026.** Verified from a fresh install in Docker (`npm run test:e2e:local`), restart keeps keys and data |
| M3 | New price list: import screen and command, diff (**OWNER GATE** before anything is written to a live database); quotation terms | G-KB-6, part of G-KB-2 | Built and tested (17 Nov). **Waiting for the owner:** Q-015 |
| M4 | IndiaMART API: Push, Pull, reconciliation | G-SRC-1, G-SRC-2, G-SRC-6 to G-SRC-8 | **Built 18 Nov 2026, tested against a fake.** OWNER GATE: paste the Pull key and register the push address (SETUP 6a); then compare one lead (Q-019) |
| M5 | AI layer: provider interface, tiers, redaction | G-AI-1 to G-AI-10, G-UND-3, G-UND-4 | **Built 18 Nov 2026, tested against fake providers** (ADR-031). OWNER GATE: Gemini key on Settings → AI, Test connection, then watch the dashboard's AI card for a day (SETUP 6b, Q-020). Left for later milestones: Advanced reading conversations and drafting replies (G-CNV-3, M7), Advanced suggesting Buy Leads (the connector does it today) |
| M6 | Knowledge base: commercial terms, rate validity, document library, sample policy, lead score | G-KB-2 to G-KB-5, G-UND-6 | **Built 22 Nov 2026.** Owner input: fill HSN, lead time and sample flags per product, the sample policy, and upload documents (Q-018, Q-021). Lead score has no order-value part: no portal gives one in its data today |
| M7 | Outbound pipeline: hold rules, modes, sending (**OWNER GATE**: stays in `shadow`) | G-TPL-*, G-OUT-1 to G-OUT-7, G-OUT-9, G-OUT-10, G-CNV-2, G-CNV-3, G-FUP-1 | **Built 22 Nov 2026** (ADR-032), in shadow mode. OWNER GATE: two weeks of drafts that need few edits, then the owner may switch to assisted (Q-022). Not built: WhatsApp Cloud API (G-OUT-8, needs the owner's cost approval) |
| M8 | Operations: follow-ups, time to first reply, members screen, backups | G-FUP-1, G-RPT-*, G-PLT-2, G-PLT-7 | Not started |
| Later | Design seams only: WhatsApp Cloud API, conversation automation, orders, attendance | G-OUT-8, G-CNV-2, G-CNV-3, G-ORD-*, G-ATT-1 | — |

## Feature check of 17 Nov 2026 ("complete before more")

Every service, screen and setting was checked against the rule in `AGENTS.md` section 2.

**Finished in this check**

| Was half-built | Now |
| --- | --- |
| Buy Lead screens and guide described software clicking on IndiaMART, which GOAL R-1 and ADR-020 reject | Suggestions only: wording, service, connector tools and guide changed; nothing can log a purchase |
| Products could be added but never corrected | Rates → Edit product (name, category, other names, grades) |
| A lead could be deleted by a service but not from a screen | Delete on the lead page for owners and admins |
| Price list: no way to load a new one | Rates → Import price list, with its mapping editor |
| Quotations had no payment terms and no MOQ on rates | Payment terms setting; MOQ set by the price list import |
| A settings input for feature switches that nothing read | Removed from the service |
| The price list import says "missing does not mean discontinued, say so", but nothing could mark a product discontinued | Rates → Edit product → Remove product; Removed products → Restore |
| Members screen (G-PLT-2): adding a teammate needed SQL | Settings → Members (built 17 Nov 2026 at the owner's request, before M2; accounts adapter `src/lib/accounts.ts`) |
| Document library (G-KB-4): the storage bucket existed, unused | Documents screen, download route, attachments on quotation drafts (built 17 Nov 2026 at the owner's request; file storage adapter with a disk implementation for M2) |

**Not built, and not shown anywhere in the app** (so nothing on screen leads to a dead end). Checked against `docs/GOAL.md` on 17 Nov 2026 at the owner's request:

| Item | In the goal? | Decision |
| --- | --- | --- |
| Assigning a lead to a person (`leads.assigned_to` exists, nothing uses it) | No | Not built. Revisit with the members screen if a team uses Inquira. |
| Switching between companies for a user who belongs to two (the cookie is read, nothing sets it) | No (one company per install) | Not built. |
| An end date on a rate | Yes, G-KB-3 (M6) | With the knowledge base. |
| Roles QA and Accounts | Yes, G-PLT-2 | Built 18 Nov 2026 with custom access per person (ADR-028). |
| A form for the price list mapping (today it is edited as text on the import screen) | M6, with commercial terms G-KB-2 |
| Priority order of email rules (stored, no control on screen; rules apply in the order they were created) | When a second rule type needs it |
| The `events` table records what happened but nothing consumes it yet | M7 (outbound pipeline) |
| `npm run seed:website` reads the first company's website address from code | Fixed 18 Nov 2026: read from the seed folder's `settings.json` |

## Owner's to-do list (the owner asked on 18 Nov 2026 to be told about these later; repeat it in the next report)

1. Vercel → Settings → Environment Variables: check `SUPABASE_SERVICE_ROLE_KEY` is set (needed by Members and Documents), then redeploy.
2. Documents: upload the COA, TDS and MSDS files with batch and expiry dates (`QUESTIONS.md` Q-018).
3. Settings → Organisation → Payment terms: `100% advance`.
4. Rates → Import price list: save the mapping (`seed/stdm/price-list-map.json`), paste the November list, Apply. The live site still has the September prices.
5. Sign in again and revoke the Claude tokens issued while sign-in was off (`docs/RUNBOOK.md` section 1).
6. IndiaMART: paste the Pull API key and register the push address (`docs/SETUP.md` section 6a); then compare one lead with IndiaMART (Q-019).
7. AI: create a Gemini key in Google AI Studio and turn on Basic AI (`docs/SETUP.md` section 6b, Q-020). Optional: a Claude API key for Advanced.

## Notes for the owner

- This session can only push to the branch `claude/adoring-franklin-51jsvk`, which is also the Vercel production branch. So each milestone is a series of commits on this branch, not a separate pull request. To get pull requests, create `main`, make it the default and the production branch, and say so.
- Git history still contains the September price list and business notes. You decided to keep the repository public as it is; history is not rewritten.

---

## History: first version handover (29 Sep 2026)

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
- **18 Nov 2026 — M5 AI layer.**
  - New module `src/modules/ai`: one provider interface with adapters for Gemini, Anthropic and any OpenAI-compatible API (plain HTTPS, no new dependency); Settings → AI per tier (provider, model, key, on/off, threshold, daily limit); keys encrypted like the TradeIndia key.
  - Leads: request type (intent) by rules, quantity units (MT, quintal, packs of N kg; "1 Jar" stays empty), below-MOQ flag from current rates, who filled each field. What rules leave open goes Basic (redacted) → Advanced → Leads → Needs details. Advanced also sorts review emails.
  - Code checks every answer (schema, known values, threshold, empty fields only); provider errors make the tier wait and the item moves on; daily limits counted by Inquira; every decision logged with corrections; dashboard shows accuracy per tier.
  - Claude connector: `list_leads_needing_details`, `submit_lead_details` (fills empty fields only).
  - Fixed while building: a product named "Sample …" would have been read as a sample request (rules now read only the buyer's message); editing any lead field would have reset a kg value AI had filled.
  - Tests: 252 unit/integration (incl. redaction, injection, malformed answers, escalation, rate limit, daily limit, corrections), 16 browser tests on desktop and phone; every test now fails if it tries to reach anything but localhost. Migrations 0010 and 0011.

