# Contributing to Inquira

Thank you for helping. This page explains how to run Inquira, how changes are made, and what every change must include. The full rulebook for people and coding agents is [`AGENTS.md`](AGENTS.md); this page is the short version.

## Before you start

- Read [`docs/GOAL.md`](docs/GOAL.md). Every change belongs to a requirement there (for example `G-OUT-3`). If yours does not, open an issue first and describe the problem you want to solve.
- Read [`PROGRESS.md`](PROGRESS.md) to see what is finished, what is next and what is waiting on a decision.
- Ideas listed as rejected in `docs/GOAL.md` section 7, or in a decision record marked Rejected or Superseded, stay rejected unless a new decision record is approved.
- The project has no licence yet ([`QUESTIONS.md`](QUESTIONS.md) Q-016). Until one is added, ask before reusing the code elsewhere.

## Run it

You need Node.js 22.12 or newer, npm, and PostgreSQL 16 installed on your computer (only its programs are used; `db:local:up` makes its own database folder).

```bash
git clone https://github.com/Gitesh-Holkar/Inquira
cd Inquira
npm ci
npm run db:local:up              # Postgres 16 on localhost:54322, shaped like Supabase
cp .env.example .env.local
#   in .env.local set:
#   DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres
#   AUTH_MODE=dev
#   APP_ENCRYPTION_KEY and CRON_SECRET from: npm run gen:keys
npm run db:migrate
SEED_LOCAL_AUTH=1 npm run db:seed
npm run demo:data                # optional: a few invented enquiries to look at
npm run dev                      # http://localhost:3000, then use the development sign-in button
```

The seed loads a fictional company (`seed/example`). All names, prices and contacts in it are made up. The Supabase values in `.env.example` can stay as placeholders for local work.

To try the app the way a business would run it on one computer, use Docker instead: [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

## Checks

Run these before you open a pull request. All of them must pass.

```bash
npm run typecheck
npm run lint
npm test                 # unit and integration tests (needs the local database)
npm run test:e2e         # browser tests on desktop and phone sizes
```

`npm test` also scans every file for keys, tokens and real phone numbers (`tests/secret-scan.test.ts`), and checks that no company name appears in code (`tests/no-company-data.test.ts`).

Tests never call a real outside service. Gmail, IndiaMART, TradeIndia and the AI providers are faked in `tests/helpers/`, and any other network call fails the test.

## How a change is made

1. Branch from `main`. One requirement group per pull request.
2. Find the code through [`docs/CODEMAP.md`](docs/CODEMAP.md).
3. Follow the layout:
   - Each feature is a folder `src/modules/<name>/` with `schema.ts`, `service.ts`, `types.ts` and tests.
   - Every write goes through a service (`defineService`) and writes an audit row.
   - Pages and server actions call services only; they never import the database.
   - Anything outside the app (email, lead portals, AI, storage) sits behind an adapter in its module.
4. A database change needs a migration made with `npm run db:generate`, row-level security for new tables (copy `drizzle/0001_rls_policies.sql`) and a test in `tests/rls.test.ts`. Never edit a migration that has been applied.
5. Add tests:
   - a test for each new service, run as a signed-in role in `tests/human-paths.test.ts`;
   - a regression test for every bug you fix;
   - a browser test in `e2e/` when a person's journey changes.
6. Update the documents your change affects, in the same commit. The table in `AGENTS.md` section 7 says which ones. `docs/CODEMAP.md` and `CHANGELOG.md` almost always change.
7. Write in the pull request what changed, why, which tests ran, and anything still open. If you add a library, say why the platform or an installed one was not enough.

## Rules that are never broken

- **No secrets in git.** Keys live in `.env.local` (ignored) or in the host's settings. `.env.example` holds placeholders.
- **No real personal data.** Fixtures use invented names, `example.com` emails and `+91 90000 xxxxx` numbers.
- **No company data in code.** Company names, products, prices, templates and rules are seed data or settings.
- **Never invent business facts.** Specifications, certifications, prices, MOQ, GST rates and policies come from the company. Missing data stays empty.
- **One send path.** Only `src/modules/outbound/send.ts` may send an email. A test fails if anything else does.
- **Sign-in is never bypassed** outside local development mode.
- **AI advises, code decides.** Model answers are checked against a schema; models never send and never set a price.

## Security problems

Do not open a public issue for a security problem. See [`SECURITY.md`](SECURITY.md).

## Style

- TypeScript strict, React 19, Next.js 16 (read `node_modules/next/dist/docs/` before using a Next API; it differs from older versions).
- Mobile first: cards on phones, tap targets of at least 44 px, no sideways scrolling, a loading, empty and error state on every screen.
- Formats: `formatINR` (₹1,23,456.00), `formatDateTime` (29 Sep 2026, 4:10 PM IST), `formatPhone` (+91 98765 43210).
- Comment what a function is for when its name and types do not say it. Do not comment obvious lines.
