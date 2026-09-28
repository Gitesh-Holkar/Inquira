# Decision records (ADR-lite)

Each record gives the context, the decision, the alternatives, and the consequences. Newest decisions are at the bottom. Changing a decision means adding a new record that supersedes the old one.

---

## ADR-001 — Stack versions
- **Context:** The brief fixes the stack. On 29 Sep 2026 the current majors are Next.js 16, React 19.3, TypeScript 7.0 (the new native Go compiler), zod 4, Vitest 5 and ESLint 10.
- **Decision:** Use Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind 4, Drizzle 0.45, zod 4, Vitest 5 and Playwright 1.63. **Pin TypeScript 5.9.3** and **ESLint 9.39**.
  - TypeScript 7 drops the JS compiler API that Next's build-time type check uses.
  - `eslint-config-next` is tested against ESLint 9.
- **Alternatives:** TypeScript 7 (risk of breaking the Next build); Next 15 (older and soon out of support).
- **Consequences:** Upgrade TypeScript once Next officially supports TS 7. `next dev` appends a short "agent rules" block to CLAUDE.md; keep it.

## ADR-002 — Local Supabase-compatible Postgres for development and tests; migrations over HTTPS
- **Context:** The overnight build container can't open TCP connections to Postgres (only HTTPS through a proxy). It also has no Docker daemon.
- **Decision:**
  - Development and tests use a local Postgres 16 (`scripts/local-db.sh`) plus `scripts/local-db/supabase-shim.sql`. The shim provides the `anon`/`authenticated`/`service_role` roles, `auth.users` and `auth.uid()`.
  - The real project is migrated with `npm run db:remote:apply` (Supabase Management API `POST /v1/projects/{ref}/database/query`) and seeded with `npm run db:remote:seed`. Both use the same bookkeeping table as drizzle's migrator.
  - From a normal machine, use `npm run db:migrate` / `npm run db:seed`.
- **Alternatives:** Supabase CLI (`supabase start` needs Docker; `db push` needs TCP); pglite (no roles/RLS parity).
- **Consequences:** RLS policies are tested against real Postgres semantics. Never edit an applied migration; add a new one.

## ADR-003 — Modules + one service kit
- **Decision:** The code lives in `src/modules/<name>/{schema,service,types}.ts`. Public service functions are built with `defineService`, which:
  - validates input with zod
  - checks the permission
  - opens one transaction
  - lets the handler write the audit row and events in that same transaction

  Cross-module calls go through the other module's `...Internal(tx, ctx, …)` functions. ESLint enforces it:
  - A module can't import another module's `schema`.
  - UI code can't import `@/db` or any schema.
- **Consequences:** The UI (server actions), the MCP tools and the cron jobs share the same code path, so permissions, validation and audit can't be skipped.

## ADR-004 — Data lives in a private `app` schema
- **Context:** Supabase exposes `public` over PostgREST. If data were in `public`, a signed-in user could use their JWT to write rows directly and skip validation and audit.
- **Decision:**
  - All tables are in schema `app`, which the Data API doesn't expose. `anon` has no access to it.
  - RLS is still enabled on every table as defence in depth.
- **Alternatives:** `public` with read-only grants (writes would then bypass RLS through the owner connection).
- **Consequences:** Don't add `app` to Supabase "Exposed schemas".

## ADR-005 — How RLS applies
- **Decision:**
  - **Human requests** run inside a transaction that does `set local role authenticated` and sets `request.jwt.claims` to `{sub:<user id>}`. This is exactly what Supabase's Data API does, so the org-membership policies apply.
  - **System actors** (cron, MCP tokens) connect as the table owner, which bypasses RLS. Their services always filter by `org_id`, and tests cover MCP cross-org isolation.
- **Policies:**
  - Members can read their org's data.
  - owner, admin and sales can write operational tables.
  - Only owner and admin can write catalog, rates, templates, rules, settings and integrations.
  - `mcp_tokens` is owner/admin only.
  - `integration_secrets` and the OAuth tables allow no access at all to `authenticated`.
- **Consequences:** `tests/rls.test.ts` proves org A can't read or modify org B's data, among other things.

## ADR-006 — Append-only rate book; rates imported as GST-exclusive, ex-factory
- **Decision:**
  - `price_entries` can only be inserted into. A trigger rejects UPDATE and DELETE.
  - The current rate for a grade is the newest entry that is valid today.
  - Every quotation stores a snapshot of the exact entries it used.
  - The rates file doesn't say whether prices include GST. STDM's sent quotations quote the **same numbers** with "GST x% extra" and "Ex-Factory", so the import uses `gst_inclusive=false` and basis `Ex-factory`. The assumption is recorded in QUESTIONS Q-001.
- **Alternatives:** A `valid_to` column updated in place (that is mutation, and loses the audit trail).

## ADR-007 — Background work: outbox + job table + one cron endpoint
- **Decision:**
  - The `events` table is the domain outbox; future features subscribe by `type`.
  - The `jobs` table is the work queue. Jobs are claimed with `FOR UPDATE SKIP LOCKED` and retried with exponential backoff (10 min doubling, capped at 6 h). A `dedupe_key` means only one queued sync per org per type.
  - `POST /api/cron/tick` (header `x-cron-secret`) enqueues `gmail.sync` and `tradeindia.sync` for every org, then drains due jobs.
  - Supabase `pg_cron` + `pg_net` calls it every 10 minutes (SETUP.md §8).
- **Alternatives:** Vercel Cron (Hobby plan is daily only); an always-on worker (the brief forbids it).

## ADR-008 — Contact de-duplication
- **Decision:**
  - Match lowercase email first, then E.164 phone. Portal placeholder emails such as `noreply@noreply.tradeindia.com` are dropped.
  - Existing contact fields are never overwritten; only empty ones are filled.
  - Each **lead keeps its own company name**, so different companies sharing one mobile number are never merged. They share the contact but show their own company on each lead.

## ADR-009 — Lead de-duplication, including TradeIndia API ↔ notification email
- **Decision:**
  1. There is a unique key on `(org_id, source, source_ref)`. For TradeIndia, `source_ref` = `rfi_id`, from both the API and the email.
     - The email carries it in the base64 `ext=` parameter of the "check inquiry" link and in the read-pixel URL.
     - The API copy and the email copy therefore collide exactly. The second one only fills empty fields and is recorded in `alternate_refs` with method `source_ref`.
  2. When an email has **no** inquiry ID (`__RFI_ID__` placeholder, IndiaMART mails), `source_ref` = `gmail:<messageId>`. A later lead from the **same source** with the **same phone or email** and the **same catalog product** (or the same product text) within **±48 hours** is merged, with method `contact_time_window`.
     - If the newcomer has a real inquiry ID, the email-only lead's `source_ref` is upgraded to it.
- **Alternatives:** Fuzzy matching on name or company (too many false merges).
- **Consequences:** The same buyer asking for two different products gives two leads, which is intended.

## ADR-010 — Gmail access: `gmail.readonly` + `gmail.compose`, drafts only
- **Context:** The app needs to read mail (sync), read the signature (`users.settings.sendAs.list`) and create drafts.
- **Decision:**
  - Request exactly `https://www.googleapis.com/auth/gmail.readonly` (read, history, sendAs/signature) and `https://www.googleapis.com/auth/gmail.compose` (`drafts.create`). This is Google's documented minimum for those calls. `gmail.settings.basic` isn't needed because `gmail.readonly` also covers `sendAs.list`.
  - The client (`src/modules/sources/gmail/client.ts`) has **no send method**. The test fake throws if any `/send` endpoint is called.
  - The refresh token is AES-256-GCM encrypted.
  - OAuth uses PKCE plus a hashed, single-use, 10-minute `state` bound to the user.
- **Caveat:** `gmail.compose` technically also allows sending. Google has no "drafts only" scope, so the guarantee comes from our code, not from Google. Both are *restricted* scopes: an unverified app shows a warning screen, and verification is only needed above 100 users.

## ADR-011 — Dev-only sign-in
- **Decision:** `AUTH_MODE=dev` enables a signed-cookie sign-in for local development and Playwright, where Supabase Auth isn't reachable. It's refused when `NODE_ENV=production` or `VERCEL` is set.

## ADR-012 — TradeIndia sync windows
- **Decision:**
  - Call `my_inquiry.html` with `from_date`/`to_date` in **7-day windows**, `limit=50`, paging with `page_no` until a short page, and 1.5 s between calls.
  - The first run backfills 30 days. Later runs read from (last success − 2 days) to now; the overlap is safe because upserts are idempotent.
  - HTTP 429 → `RATE_LIMITED` and backoff.
  - Invalid credentials → `reauth_required`.
  - Field names are read through alias lists.
- **Consequences:** It's conservative until the real limits are confirmed (docs/TRADEINDIA_API.md).

## ADR-013 — MCP authentication: OAuth 2.1 (DCR + PKCE) and bearer tokens
- **Context:** claude.ai custom connectors (checked 29 Sep 2026 on claude.com/docs/connectors/building/authentication) support:
  - OAuth with Dynamic Client Registration or CIMD
  - static headers (beta, limited)
  - no auth

  They need a `401` carrying `WWW-Authenticate: Bearer resource_metadata=…`, RFC 9728/8414 metadata, S256 PKCE, the redirect `https://claude.ai/api/mcp/auth_callback`, port-agnostic loopback redirects for Claude Code, form-encoded token requests, `invalid_grant` errors and rotating refresh tokens.
- **Decision:** Inquira is its own authorization server:
  - `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
  - `/api/oauth/register` (DCR)
  - `/oauth/authorize`: a consent screen for a signed-in owner/admin, which shows the redirect host
  - `/api/oauth/token`: 1 h access tokens and 30-day **rotating** refresh tokens

  Manual bearer tokens (Settings → Claude / MCP) also work, for the MCP Inspector and Claude Code. Every token is stored only as a SHA-256 hash.
- **Transport:** Stateless Streamable HTTP (`WebStandardStreamableHTTPServerTransport`, JSON responses), with a fresh server per request. It suits serverless and needs no session store.
- **Alternatives:** CIMD (not advertised yet; DCR is the default fallback); Supabase Auth as the AS (it doesn't support DCR).

## ADR-014 — Classification pipeline order
- **Decision:** Messages are checked in this order:
  1. our own mail
  2. **user rules**
  3. portal parsers (IndiaMART, TradeIndia)
  4. thread already linked to a lead → conversation
  5. OTP / bank / newsletter heuristics
  6. otherwise `needs_review`

  Direct email inquiries always go to review, for Claude or a person, because code can't extract product and quantity reliably. Vendor pitches are never auto-ignored; a person turns them into a rule. International mail gets a *hint*, never an automatic drop.

## ADR-015 — Templates
- **Decision:**
  - Templates are plain `{{placeholder}}` substitution with no logic, which is safe for text edited in the UI.
  - Unknown placeholders are rejected.
  - A sign-off in the last lines is rejected, because the real Gmail signature (send-as `signature`) is appended at draft time.
  - The default wording mirrors STDM's sent quotations.

## ADR-016 — Hand-written shadcn-style components
- **Context:** The shadcn CLI needs its registry host, which isn't reachable from the build container.
- **Decision:** A small set of components (`src/components/ui`) follows shadcn's patterns (Radix primitives, `cva`, `cn`, CSS-variable tokens). The design tokens are in `src/app/globals.css`, with the brand green from stdmfood.com (#69bd43) darkened to #2f7a24 for AA contrast.

## ADR-017 — Gmail first sync reads 14 days
- **Decision:** The first Gmail sync reads the last 14 days; TradeIndia's reads 30. Portal mail older than two weeks is rarely actionable, and a 30-day Gmail backfill could be thousands of messages.
- **Change it:** `BACKFILL_DAYS` in `src/modules/sources/gmail/service.ts`.

## ADR-018 — In-memory rate limiting
- **Decision:** A token bucket per serverless instance on:
  - DCR (10/min), token endpoint (30/min), MCP (120/min) — per IP
  - login (10/min), password reset (3/min) — per IP

  Good enough against casual abuse. If traffic grows, add Upstash Redis or Vercel WAF rules (docs/SECURITY.md).
