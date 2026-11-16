# AGENTS.md — Rules for anyone, human or AI, who changes Inquira

Inquira is an open-source lead desk for B2B suppliers. The end goal is in `docs/GOAL.md`. The first user is STDM Food & Beverages, which appears only as seed data and is never hard-coded.

This file is tool-neutral and is the single rulebook. `CLAUDE.md` only points here. If you use another coding agent, point it here too.

## 1. Every session, in this order

1. Read `PROGRESS.md` (current state, next step, handover) and `QUESTIONS.md`.
2. Read `docs/INDEX.md` and open only the documents it names for your task.
3. Run `git status`, `npm run typecheck`, `npm run lint` and `npm test`. Fix anything broken before starting new work.
4. Find code through `docs/CODEMAP.md` before searching.

Do not read every document by default. Do not re-read unchanged documents in the same session. If a document is missing or wrong, read the code, then fix the document.

## 2. Workflow for every task

1. **Understand.** Find the requirement ID in `docs/GOAL.md`. Read the relevant code and decisions.
2. **Investigate.** List the modules, tables, jobs and tests the change touches, and what could break.
3. **Plan.** State what you will change and which files. Stop and ask before anything destructive, anything that reverses an accepted decision, a new dependency, or a new external service.
4. **Implement.** Small, modular changes on a feature branch. One requirement group per pull request.
5. **Verify.** Type check, lint, tests, and a regression test for every bug fixed. Writing the code is not completion.
6. **Document.** Update the documents the change affects, in the same commit (section 7).
7. **Report.** What changed, which files, which tests ran, what is still open.

**Complete before more** (owner's instruction, 16 Nov 2026). Fewer features that are finished beat more features that are partial. A feature is finished when its screen, permissions, tests and documents exist and a person can use it end to end. Do not leave a service without a screen, a screen without a working action, or a setting that nothing reads. If a part cannot be finished in the milestone, hide or remove it and list it in `PROGRESS.md`.

## 3. Hard rules (never break)

0. **Work only in this repository.**
   - Never read, clone or modify another repository, and never open issues or pull requests elsewhere.
   - Never create repositories or change repository settings, secrets or collaborators.
   - Before every push, check that `git remote get-url origin` is `https://github.com/Gitesh-Holkar/Inquira`. If it is not, stop and write it in `QUESTIONS.md`.
1. **The Gmail connector** available to agents is read-only and was used for the initial mailbox study only. Never send, draft, reply to, label, archive, trash or modify anything with it. The app's own Gmail integration is separate.
2. **No real personal data in the repository.** Fixtures use fake names, phone numbers, emails and companies.
3. **No secrets in git.** Secrets live in `.env.local` (ignored). `.env.example` holds placeholders only. Never print a key in logs, errors, audit rows or the browser.
4. **Sending.** Until the outbound pipeline (G-OUT) is merged, the app creates Gmail drafts only and a person clicks Send. After it is merged, the pipeline is the only code path allowed to call a send endpoint, the default mode is `shadow`, and tests must fail if any other path sends.
5. **Sign-in can never be bypassed** outside local development mode. No constant, flag or environment variable may make a visitor a signed-in user in a deployed build.
6. **No company data in code.** Company names, products, prices, templates and rules are seed data or settings.
7. **Never invent** product specifications, certifications, prices, MOQ, GST rates or policy. Missing data stays empty and gets a `QUESTIONS.md` entry.
8. **Every write goes through the service layer** and writes an audit row: `human:<user_id>`, `mcp:<token_name>`, `ai:<tier>` or `system:<job>`.
9. **AI advises, code decides.** Models return schema-checked fields. They never send, never set a price, and their input is treated as untrusted text.
10. **Basic AI tier input is redacted.** No email, phone number, buyer name or company name may reach a free-tier provider.
11. **Rejected ideas stay rejected.** Section 7 of `docs/GOAL.md` and any decision marked Rejected or Superseded are not instructions. Reopen them only through a new decision record approved by the owner.
12. **No deployment by the agent.** The owner deploys using `docs/SETUP.md`. The agent never enters passwords or payment details and never upgrades a plan.
13. **Never touch a live system from an agent session:** no calls to the real IndiaMART, TradeIndia, Gmail, WhatsApp or AI provider accounts unless the owner supplied test credentials for that purpose in the session.
14. **Do not delete working functionality** without understanding it and getting approval. Avoid rewrites of working code.

## 4. Architecture rules

- **Modules.** Each feature is a folder in `src/modules/<name>/` with `schema.ts`, `service.ts`, `types.ts` and tests. One clear responsibility per module, service and function. No large mixed files.
- **Boundaries (enforced by ESLint).**
  - A module never imports another module's `schema` (foreign-key references inside `schema.ts` are fine).
  - UI code never imports `@/db` or any schema.
  - Cross-module calls use the other module's `…Internal(tx, ctx, …)` functions.
- **Adapters for everything external.** Lead sources, AI providers, email, WhatsApp, file storage, auth and scheduler each sit behind an interface in their module. No provider SDK or provider-specific field name outside its adapter. Add an abstraction only where it removes real coupling.
- **Settings, not constants.** Provider names, model names, URLs, limits, thresholds and feature switches are per-company settings or environment variables, read in one place.
- **Service layer.** Define public functions with `defineService({ name, input: zod, permission, handler(ctx, input, tx) })`. The handler calls `audit()` and `emit()` for every write.
  - Touches `integration_secrets` → add `runAs: "system"`.
  - Calls an external service → `defineExternalService` with its own short `withSystemTx` calls. Never hold a database transaction open across a network call.
- **Ctx** is `{ orgId, actor }`. Humans run under row-level security. System, MCP and AI actors run as owner, so **always filter by `orgId`**.
- **Permissions** live in `src/modules/core/permissions.ts`. MCP and AI actors are narrow: no delete, rates, settings or credentials.
- **Errors.** Throw `AppError(code, message)`. UI actions use `runAction()`; route handlers use `errorResponse()`. No silent failures; no internal details shown to users.
- **Background work** uses the job table and the single tick endpoint. Every job has a time budget and saves its position so it can resume.
- **Performance.** Paginate lists, index what you filter on, avoid repeated external calls.

## 5. Database rules

- Every schema change has a migration generated with `npm run db:generate`. Never edit an applied migration.
- New tables: base columns (`...baseColumns()`), `orgId`, and a migration enabling row-level security with policies (copy `drizzle/0001_rls_policies.sql`). Extend `tests/rls.test.ts`.
- Consider existing data before changing a column. Prefer additive changes.
- Keep `docs/DATABASE.md` in step with the schema.

## 6. Testing rules

- Unit tests for functions; integration tests for services against local Postgres; Playwright end-to-end tests for critical journeys on desktop and mobile; a regression test for every fixed bug.
- External services are faked in `tests/helpers/`. Fakes must throw on any call the app is not allowed to make.
- Test new services as a signed-in role in `tests/human-paths.test.ts`. System-context tests bypass row-level security and hide permission bugs.
- Email parsers: add an anonymised fixture with an `expected` block to `fixtures/emails/`; `src/modules/email/parsers.test.ts` runs every fixture.
- After changing a feature, also run the tests of the features that depend on it.

## 7. Documentation rules

Documentation and code change together, in the same commit. Create a document when it becomes relevant; do not create empty ones.

| When you change… | Update… |
| --- | --- |
| Any function, file, route, page or job (add, rename, move, delete) | `docs/CODEMAP.md` |
| Finish or start a task; find a blocker | `PROGRESS.md` |
| Something the owner must answer | `QUESTIONS.md` |
| Anything a user or operator would notice | `CHANGELOG.md` |
| Structure, data flow, modules, jobs, auth | `docs/ARCHITECTURE.md` |
| Tables, columns, policies, migrations | `docs/DATABASE.md` |
| An external service: endpoints, auth, limits, env vars, how to replace it | `docs/INTEGRATIONS.md` |
| Routes, webhooks, MCP tools | `docs/API.md` |
| A significant technical choice | New file in `docs/decisions/` and its index |
| A document added, renamed or removed | `docs/INDEX.md` |
| The goal itself | `docs/GOAL.md`, only with the owner's approval |

**Decision records.** One file per decision in `docs/decisions/ADR-NNN-short-name.md` with: Context, Problem, Options, Decision, Reasoning, Consequences, Status (Accepted, Rejected, Superseded, Deprecated), Date. Never delete a decision. When one is replaced, set its status, say why, and link the replacement. `docs/decisions/README.md` is the index with status. Record only choices that matter.

**Comments.** Document what a function is for, its inputs, outputs, dependencies, failure behaviour and limits when that is not obvious from its name and types. Do not comment trivial lines.

## 8. Version control

- `main` is the stable branch. Work on a feature branch and merge by pull request after checks pass.
- Clear commit messages. Commit often. Never overwrite working code you do not understand.
- Experimental changes never go directly to `main`.

## 9. Stack

- Next.js **16** App Router (`src/proxy.ts` replaces middleware; request APIs are async). **Read `node_modules/next/dist/docs/` before using a Next API.**
- React 19, TypeScript 5.9 strict, Tailwind 4 (tokens in `src/app/globals.css`), shadcn-style components in `src/components/ui`.
- Postgres with Drizzle ORM (`casing: snake_case`), all tables in schema **`app`**, row-level security on every table. Cloud mode uses Supabase Postgres and Supabase Auth.
- zod 4 on every service input, MCP tool input and AI output. MCP SDK (stateless Streamable HTTP at `/api/mcp`).
- Vitest (integration tests need local Postgres), Playwright (end-to-end).
- Do not add a library without a reason written in the pull request. Prefer the platform and what is already installed.

## 10. Commands

```bash
npm run dev                 # http://localhost:3000 (needs .env.local)
npm run typecheck && npm run lint && npm test
npm run test:e2e            # Playwright: own DB inquira_e2e, dev auth, port 3100
npm run db:local:up         # local Postgres 16 on :54322 that mimics Supabase
npm run db:generate         # after schema.ts changes → new SQL in drizzle/
npm run db:migrate          # apply migrations over TCP (DATABASE_URL)
npm run db:remote:apply     # apply over HTTPS via Supabase Management API
npm run db:seed             # idempotent seed: org, owner, catalogue, rates, templates, rules
npm run db:remote:seed      # seed a Supabase project over HTTPS only
npm run demo:data           # load fixture emails into a LOCAL db for demos
npm run gen:keys            # APP_ENCRYPTION_KEY + CRON_SECRET
```

Keep this list current when scripts are added. Use `localhost`, not `127.0.0.1`, in development.

## 11. Layout

```
src/modules/<m>/{schema,service,types}.ts   one folder per feature
src/app/(app)/…                               signed-in pages + server actions (call services only)
src/app/api/…                                 route handlers: mcp, oauth, cron, webhooks, integrations
src/db/client.ts                              getDb, withUserTx (RLS), withSystemTx
src/lib/                                      env, errors, crypto, phone, format, auth, rate-limit, actions
drizzle/  seed/  fixtures/  scripts/  tests/  e2e/  docs/
```

## 12. Conventions

- **Formats:** `formatINR` (₹1,23,456.00), `formatDateTime` (29 Sep 2026, 4:10 PM IST), `formatPhone` (+91 98765 43210), `toE164`. Dates sent to Indian services are built in IST.
- **UI:** mobile first (cards on phones, bottom navigation), tap targets of at least 44 px, no horizontal scroll, colour plus text for status, a loading, empty and error state everywhere, toasts, confirmation for destructive actions.
- **Naming:** follow the names and folder shapes already in the module you are editing.

## 13. How this differs from the generic guideline it came from

- Feature folders are `src/modules/<name>/`, not `src/features/`.
- `PROGRESS.md` is the project-status file (the guideline calls it `PROJECT_CONTEXT.md`).
- `docs/CODEMAP.md` replaces per-module documents under `docs/modules/`.
- Diagrams live inside `docs/ARCHITECTURE.md`; there is no `docs/diagrams/` folder.
- `docs/SETUP.md` is the deployment document; `docs/SELF_HOSTING.md` covers local mode.
- UI component tests are replaced by Playwright journeys.
- `docs/GOAL.md` is added as the single statement of the end goal.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
