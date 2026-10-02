# CLAUDE.md — Inquira

Inquira is a lead-management web app for B2B food-ingredient suppliers. The first customer is STDM Food & Beverages; it appears only as seeded data and is never hard-coded.

**Read first, every session:** `PROGRESS.md` (current and next step, handover), `QUESTIONS.md`, `docs/DECISIONS.md`. Then run `git status`, `npm test` and `npm run typecheck`, and fix anything broken before continuing.

**Where things are:** `docs/CODEMAP.md` lists every file, exported function, page, route and job, and what it is for. Look there before searching. **Keep it current:** when you add, rename, move or delete a function, file, route, page or job, update CODEMAP.md in the same commit.

## Hard rules (never break)
0. Work only in the `inquira` repository.
   - Never read, clone or modify another repo, and never open issues/PRs there.
   - Never create repos or change repo settings, secrets or collaborators.
   - Before every push, check that `git remote get-url origin` is `https://github.com/Gitesh-Holkar/Inquira`. If it isn't, stop and write it in QUESTIONS.md.
1. The Gmail *connector* is read-only and was used in Phase A only. Never send, draft, reply to, label, archive, trash or modify anything with it.
2. No real personal data in the repo. Fixtures use fake names, phone numbers, emails and companies.
3. No secrets in git. Secrets live in `.env.local` (gitignored). `.env.example` holds placeholders only.
4. The app never sends email. It uses Gmail `readonly` + `compose` scopes and **creates drafts only**; a human clicks Send.
5. Browser use was for Phase A only. Use CLIs/HTTP APIs instead. Never enter passwords or payment details, and never upgrade plans.
6. No deployment by the agent. Gitesh deploys to Vercel using docs/SETUP.md.
7. Never invent product specs, certifications or prices. Missing data stays empty and gets a QUESTIONS.md entry.
8. Every write goes through the service layer and writes an audit row: `human:<user_id>`, `mcp:<token_name>` or `system:<job>`.

## Stack
- Next.js **16** App Router (`src/proxy.ts` replaces middleware; request APIs are async). **Read `node_modules/next/dist/docs/` before using a Next API.**
- React 19, TypeScript 5.9 strict (not TS 7, see ADR-001), Tailwind 4 (tokens in `src/app/globals.css`), shadcn-style components in `src/components/ui` (Radix + cva).
- Supabase Postgres (ap-south-1) + Supabase Auth. Drizzle ORM (`casing: snake_case`), all tables in schema **`app`**, RLS on every table.
- zod 4 on every service input and MCP tool input. MCP SDK 1.31 (stateless Streamable HTTP at `/api/mcp`).
- Vitest 5 (integration tests need local Postgres), Playwright 1.63 (e2e).

## Commands
```bash
npm run dev                 # http://localhost:3000 (needs .env.local)
npm run typecheck && npm run lint && npm test
npm run test:e2e            # Playwright: own DB inquira_e2e, dev auth, port 3100, screenshots → docs/screenshots
npm run db:local:up         # local Postgres 16 on :54322 that mimics Supabase (roles, auth.uid())
npm run db:generate         # after schema.ts changes → new SQL in drizzle/ (never edit an applied migration)
npm run db:migrate          # apply migrations over TCP (DATABASE_URL)
npm run db:remote:apply     # apply over HTTPS via Supabase Management API (cloud containers: no TCP egress)
npm run db:seed             # idempotent seed: org, owner (SEED_OWNER_EMAIL), catalog, rates, templates, rules
npm run db:remote:seed      # seed a Supabase project over HTTPS only
npm run demo:data           # load fixture emails into a LOCAL db for screenshots/demo
npm run seed:website        # diff stdmfood.com catalogue vs seed/products.json
npm run gen:keys            # APP_ENCRYPTION_KEY + CRON_SECRET
```
Local dev without Supabase: `.env.local` with `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/inquira_dev` and `AUTH_MODE=dev`, then sign in as `owner@example.com`. Use `localhost`, not `127.0.0.1` (Next 16 blocks other dev origins).

## Layout
```
src/modules/<m>/{schema,service,types}.ts   core contacts leads email sources catalog templates quotes mcp buyleads dashboard
src/app/(app)/…                               signed-in pages + server actions (call services only)
src/app/api/{mcp,oauth,well-known,cron,integrations}
src/db/client.ts                              getDb, withUserTx (RLS as `authenticated`), withSystemTx
src/lib/                                      env, errors, crypto, phone, format, auth, rate-limit, actions
drizzle/  seed/  fixtures/emails/  scripts/  tests/  e2e/  docs/
```
Function-level index: `docs/CODEMAP.md`.

## Conventions
- **Service layer:** define public functions with `defineService({ name, input: zod, permission, handler(ctx, input, tx) })`. The handler must call `audit()` and `emit()` for every write. Cross-module calls use the other module's `…Internal(tx, ctx, …)` functions.
  - Touches `integration_secrets` → add `runAs: "system"` (the `authenticated` role can't read it). Calls Google/TradeIndia → `defineExternalService` with its own short `withSystemTx` calls.
  - Test new services as a signed-in role in `tests/human-paths.test.ts`: system-context tests bypass RLS and hide permission bugs.
- **Boundaries (ESLint-enforced):**
  - A module never imports another module's `schema` (FK references inside `schema.ts` are fine).
  - UI code never imports `@/db` or any schema.
- **Ctx:** `{ orgId, actor }`, where actor is `human` (role), `mcp` (token name) or `system` (job).
  - Humans run under RLS.
  - System/MCP run as owner, so **always filter by `orgId`**.
- **Permissions:** `src/modules/core/permissions.ts`. MCP tokens are narrow: no delete, rates, settings or credentials.
- **Errors:** throw `AppError(code, message)`. UI actions wrap calls in `runAction()`; route handlers use `errorResponse()`.
- **Formats:** `formatINR` (₹1,23,456.00), `formatDateTime` (29 Sep 2026, 4:10 PM IST), `formatPhone` (+91 98765 43210), `toE164`.
- **New tables:** base columns (`...baseColumns()`), `orgId`, and a custom migration enabling RLS and policies (copy `drizzle/0001_rls_policies.sql`). Extend `tests/rls.test.ts`.
- **Email parsers:** add an anonymised fixture with an `expected` block to `fixtures/emails/`; `src/modules/email/parsers.test.ts` runs every fixture.
- **UI:** mobile first (cards on phones, bottom nav), ≥44px tap targets, no horizontal scroll, colour + text for status, a loading/empty/error state everywhere, toasts, confirm destructive actions.
- **Commits:** clear messages; update `PROGRESS.md` after each task.

## Testing
- `npm test` recreates the `inquira_test` database from migrations (tests/global-setup.ts), then runs unit + integration tests. Gmail and TradeIndia are faked in `tests/helpers/fake-google.ts` (the fake throws if any send endpoint is called).
- `npm run test:e2e` recreates `inquira_e2e`, seeds it, loads demo data, starts `next dev` on :3100 with `AUTH_MODE=dev`, and runs desktop (1440) + mobile (390) projects.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
