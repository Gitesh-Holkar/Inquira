# Inquira

An open-source lead desk for B2B suppliers. It collects every buyer enquiry in one place, prepares the reply with your real prices and terms, and keeps a record of everything that was sent.

Built first for an Indian food-ingredients supplier; company data lives in seed folders and settings, never in code, so any supplier can run it.

## What it does

- **Collects enquiries** from IndiaMART (Push and Pull API, and email), TradeIndia (API and email) and your own Gmail inbox. The same enquiry arriving twice becomes one lead.
- **Understands each lead:** product, quantity, what the buyer wants (price, samples, documents), and a score so the best leads come first. Optional AI (your own Gemini, Claude or OpenAI-compatible key) helps when rules cannot; it never sees buyer contact details on the free tier, and code checks every answer.
- **Keeps your rate book:** products, grades, price per kg in ₹ with GST shown separately, MOQ, pack size, price ranges and validity. Every change is kept in history.
- **Prepares replies** in the **Outbox** from your templates: first quotation, documents (COA, TDS, MSDS…), sample reply, below-MOQ reply, follow-up. A reply is **held** for a person when anything is unsure (product, quantity, missing price or terms, an unanswered question, a risky phrase). WhatsApp replies open on your phone for you to send.
- **Sends safely:** by default a person sends every message (shadow mode). An owner can let clean first quotations go automatically, inside a send window and hourly and daily limits, with a pause switch. Every send records the template, rates and rules it used.
- **Works with Claude** through a built-in, signed-in MCP connector: triage, notes and reply drafts. Claude cannot change prices or settings, delete anything or send.
- **Reports and backups:** a dashboard with the last 7 days (leads, replies, time to first reply), an optional daily summary email, and a nightly backup that owners can download and restore.
- **Teams:** owner, admin, sales, QA, accounts and viewer roles, with per-member access switches. Every change is in the audit log.

Phone first (bottom navigation, cards), light and dark mode, keyboard shortcuts on desktop.

## Try it on your computer (about 10 minutes)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows or Mac) or Docker Engine with Compose (Linux).

```bash
git clone https://github.com/Gitesh-Holkar/Inquira
cd Inquira
docker compose up -d
```

Open **http://localhost:3000**, create the owner account, and you will see a fictional example company with products and prices to try everything safely. Nothing leaves your computer until you connect Gmail or a lead portal yourself.

Full guide, including using your own company's data, backups and updates: [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

## Run it in the cloud

Supabase (database, sign-in, file storage) and Vercel (the app). Step by step, no programming needed: [`docs/SETUP.md`](docs/SETUP.md).

## Work on the code

Next.js 16, React 19, TypeScript, Tailwind 4, PostgreSQL with Drizzle and row-level security, zod, Vitest and Playwright.

```bash
npm ci
npm run db:local:up                   # local Postgres 16 on port 54322 (needs PostgreSQL installed)
cp .env.example .env.local            # set DATABASE_URL, AUTH_MODE=dev and the keys from npm run gen:keys
npm run db:migrate && SEED_LOCAL_AUTH=1 npm run db:seed
npm run dev                           # http://localhost:3000
npm run typecheck && npm run lint && npm test && npm run test:e2e
```

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md). The full rules are in [`AGENTS.md`](AGENTS.md) (they apply to people and coding agents alike).

## Documents

| | |
|---|---|
| **Goal and status** | [GOAL](docs/GOAL.md) (what Inquira must do) · [PROGRESS](PROGRESS.md) · [QUESTIONS](QUESTIONS.md) · [CHANGELOG](CHANGELOG.md) |
| **How it works** | [ARCHITECTURE](docs/ARCHITECTURE.md) · [CODEMAP](docs/CODEMAP.md) (every file and function) · [DATABASE](docs/DATABASE.md) · [API](docs/API.md) · [DECISIONS](docs/decisions/README.md) |
| **Running it** | [SELF_HOSTING](docs/SELF_HOSTING.md) · [SETUP](docs/SETUP.md) · [RUNBOOK](docs/RUNBOOK.md) (restore a backup, revoke tokens) · [INTEGRATIONS](docs/INTEGRATIONS.md) |
| **Security** | [Report a problem](SECURITY.md) · [Threat model and controls](docs/SECURITY.md) |
| **Screenshots** | [docs/screenshots](docs/screenshots) (390 px phone and 1440 px desktop) |

## Licence

No licence has been chosen yet ([QUESTIONS.md](QUESTIONS.md) Q-016). Until one is added, the code is visible but not licensed for reuse; please ask first.
