# CLAUDE.md — Inquira

Inquira is a lead-management web app for B2B food-ingredient suppliers. The first customer is STDM Food & Beverages; it appears only as seeded data and is never hard-coded.

**Always read first:** `PROGRESS.md` (current and next step), `QUESTIONS.md`, `docs/DECISIONS.md`.

## Hard rules (never break)
0. Work only in the `inquira` repository.
   - Never touch another repo.
   - Never create repos or change repo settings, secrets or collaborators.
   - Before every push, check that `git remote get-url origin` ends in `/Inquira`. If it doesn't, stop and write it in QUESTIONS.md.
1. The Gmail *connector* is read-only and was used in Phase A only. Never send, draft, reply to, label, archive, trash or modify anything with it.
2. No real personal data in the repo. Fixtures use fake names, phone numbers, emails and companies.
3. No secrets in git. Secrets live in `.env.local` (gitignored). `.env.example` holds placeholders only.
4. The app never sends email. It uses Gmail read + compose scopes and **creates drafts only**; a human clicks Send.
5. Browser use was allowed in Phase A only. After that, use the CLI/HTTP APIs. Never enter passwords or payment details, and never upgrade plans.
6. No deployment by the agent. Gitesh deploys to Vercel using docs/SETUP.md.
7. Never invent product specs, certifications or prices. Missing data stays empty and gets a QUESTIONS.md entry.
8. Every write goes through the service layer and writes an audit row: `human:<user_id>` or `mcp:<token_name>`.

## Stack
- Next.js (App Router) + TypeScript strict, Tailwind, shadcn/ui-style components (`src/components/ui`).
- Supabase Postgres (ap-south-1), Drizzle ORM, SQL migrations in `drizzle/`, and Supabase Auth.
- zod on every service input and every MCP tool input.
- MCP server at `/api/mcp` (official TS SDK, Streamable HTTP).
- Cron endpoints `/api/cron/*` (header `x-cron-secret`), triggered by pg_cron + pg_net.
- Vitest for unit/integration tests, Playwright for smoke tests. AES-256-GCM (`APP_ENCRYPTION_KEY`) for stored credentials.

(Commands, layout and conventions are filled in as the scaffold lands. See below.)
