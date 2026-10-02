# Inquira

Lead management for B2B ingredient suppliers.

- **Captures** inquiries from TradeIndia (API + email), IndiaMART (email, plus Buy Leads unlocked by a Claude Cowork task) and direct email.
- **De-duplicates** buyers and inquiries, so the same TradeIndia inquiry arriving by API and by email becomes one lead.
- **Keeps** an append-only rate book in ₹ with GST shown separately.
- **Turns** a lead into a quotation **Gmail draft** in the same thread, with your real signature. A human always clicks Send.
- **Works with Claude** through a built-in, authenticated MCP server: triage, classification, notes and quote drafts. Every action is audited.

Mobile-first, light/dark mode, keyboard shortcuts on desktop. Next.js 16 + Supabase (Mumbai) + Drizzle; runs serverless on Vercel.

| | |
|---|---|
| **Set it up** | [docs/SETUP.md](docs/SETUP.md) — Supabase, Vercel, Gmail OAuth, TradeIndia, Claude, cron |
| **Status / handover** | [PROGRESS.md](PROGRESS.md) · open questions in [QUESTIONS.md](QUESTIONS.md) |
| **How it works** | [ARCHITECTURE](docs/ARCHITECTURE.md) · [CODEMAP](docs/CODEMAP.md) (every file and function) · [DECISIONS](docs/DECISIONS.md) · [SECURITY](docs/SECURITY.md) |
| **What & why** | [REQUIREMENTS](docs/REQUIREMENTS.md) · [BUSINESS](docs/BUSINESS.md) · [ROADMAP](docs/ROADMAP.md) |
| **Integrations** | [EMAIL_FORMATS](docs/EMAIL_FORMATS.md) · [TRADEINDIA_API](docs/TRADEINDIA_API.md) · [COWORK_INDIAMART_TASK](docs/COWORK_INDIAMART_TASK.md) |
| **Screenshots** | [docs/screenshots](docs/screenshots) (390px phone and 1440px desktop) |

```bash
npm ci && cp .env.example .env.local   # fill in (docs/SETUP.md §2)
npm run dev
npm run typecheck && npm run lint && npm test && npm run test:e2e
```
