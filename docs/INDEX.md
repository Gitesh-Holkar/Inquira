# Document index

Every document, what it is for, and when to read it. Open only the ones your task needs (`AGENTS.md` section 1). Update this file when a document is added, renamed or removed.

## At the repository root

| Document | Purpose | Read it when |
| --- | --- | --- |
| `AGENTS.md` | The single rulebook for people and agents | Every session |
| `CLAUDE.md` | Imports `AGENTS.md` for Claude Code | Never; edit `AGENTS.md` |
| `PROGRESS.md` | Current state, plan, what the owner must do | Every session |
| `QUESTIONS.md` | Questions only the owner can answer, with the assumption used meanwhile | Every session; before guessing anything |
| `CHANGELOG.md` | What users and operators would notice, newest first | After any visible change |
| `README.md` | What Inquira is and how to start | When changing setup or features a stranger would see |

## In `docs/`

| Document | Purpose | Read it when |
| --- | --- | --- |
| `GOAL.md` | The end goal, requirement IDs, phases, rejected ideas | Planning any feature; it wins over every other document |
| `ROADMAP.md` | Order of phases and milestones | Choosing what to work on next |
| `CODEMAP.md` | Every file, function, page, route and job, and what it is for | Before searching the code |
| `ARCHITECTURE.md` | Layers, modules, data flow, jobs, how to extend | Changing structure or adding a module or source |
| `DATABASE.md` | Tables, relationships, policies, indexes, migrations | Changing the schema or a query |
| `API.md` | Route handlers, webhooks, MCP tools | Changing or adding an endpoint or MCP tool |
| `INTEGRATIONS.md` | Each external service: endpoints, auth, limits, status, how to replace it | Touching Gmail, TradeIndia, Supabase, hosting or a new provider |
| `TRADEINDIA_API.md` | What was probed and what is assumed about TradeIndia's API | Working on the TradeIndia source |
| `EMAIL_FORMATS.md` | The portal email layouts the parsers support | Adding or fixing an email parser |
| `TESTING.md` | How tests are organised, what is faked, how to add a fixture | Writing tests |
| `SECURITY.md` | Threat model, controls, known limits | Touching sign-in, tokens, secrets or public endpoints |
| `RUNBOOK.md` | Operator procedures (for example revoking tokens) | Something needs doing on the live system |
| `SETUP.md` | Cloud deployment, step by step, for the owner | Changing deployment or environment variables |
| `SELF_HOSTING.md` | Running Inquira on your own computer with Docker (local mode) | Changing local mode, Docker files, local sign-in or the worker |
| `BUSINESS.md` | The first company's sales process, as observed | Understanding why a feature exists |
| `REQUIREMENTS.md` | History: requirements of the first version | Only to understand earlier choices |
| `COWORK_INDIAMART_TASK.md` | Using Claude for Buy Lead suggestions | Working on Buy Leads; note ADR-020 |
| `DECISIONS.md` | Pointer to `decisions/` | Never |
| `decisions/README.md` | Index of decision records with status | Before reversing or repeating a choice |
| `decisions/ADR-NNN-*.md` | One decision each | When the index points you to it |
| `screenshots/` | Playwright screenshots at 1440 px and 390 px | Checking how a screen looks |

## Not written yet

| Document | Arrives with |
| --- | --- |
| `CONTRIBUTING.md`, `LICENSE` | M1 |
| `docs/SELF_HOSTING.md` | M2 |
