# Decision records

One file per decision. Never delete a record. When a decision is replaced, set its status to Superseded, say why, and link the replacement. Record only choices that matter.

Each file has: Context, Problem, Options, Decision, Reasoning, Consequences, Status (Accepted, Rejected, Superseded, Deprecated) and Date.

| Record | Decision | Status | Date |
| --- | --- | --- | --- |
| [ADR-001](ADR-001-stack-versions.md) | Stack versions | Accepted | 29 Sep 2026 |
| [ADR-002](ADR-002-local-postgres-and-https-migrations.md) | Local Supabase-compatible Postgres for development and tests; migrations over HTTPS | Accepted | 29 Sep 2026 |
| [ADR-003](ADR-003-modules-and-service-kit.md) | Modules and one service kit | Accepted | 29 Sep 2026 |
| [ADR-004](ADR-004-private-app-schema.md) | Data lives in a private `app` schema | Accepted | 29 Sep 2026 |
| [ADR-005](ADR-005-how-rls-applies.md) | How row-level security applies | Accepted | 29 Sep 2026 |
| [ADR-006](ADR-006-append-only-rate-book.md) | Append-only rate book; rates imported as GST-exclusive, ex-factory | Accepted | 29 Sep 2026 |
| [ADR-007](ADR-007-jobs-and-one-cron-endpoint.md) | Background work: outbox, job table and one cron endpoint | Accepted | 29 Sep 2026 |
| [ADR-008](ADR-008-contact-de-duplication.md) | Contact de-duplication | Accepted | 29 Sep 2026 |
| [ADR-009](ADR-009-lead-de-duplication.md) | Lead de-duplication, including API and notification email copies | Accepted | 29 Sep 2026 |
| [ADR-010](ADR-010-gmail-drafts-only.md) | Gmail access: `gmail.readonly` and `gmail.compose`, drafts only | Accepted | 29 Sep 2026 |
| [ADR-011](ADR-011-dev-only-sign-in.md) | Development-only sign-in | Accepted | 29 Sep 2026 |
| [ADR-012](ADR-012-tradeindia-sync-windows.md) | TradeIndia sync windows | Accepted | 29 Sep 2026 |
| [ADR-013](ADR-013-mcp-authentication.md) | MCP authentication: OAuth 2.1 with client registration and PKCE, plus bearer tokens | Accepted | 29 Sep 2026 |
| [ADR-014](ADR-014-classification-pipeline-order.md) | Email classification order | Accepted | 29 Sep 2026 |
| [ADR-015](ADR-015-templates.md) | Templates | Accepted | 29 Sep 2026 |
| [ADR-016](ADR-016-hand-written-ui-components.md) | Hand-written shadcn-style components | Accepted | 29 Sep 2026 |
| [ADR-017](ADR-017-gmail-first-sync-14-days.md) | Gmail first sync reads 14 days | Accepted | 29 Sep 2026 |
| [ADR-018](ADR-018-in-memory-rate-limiting.md) | In-memory rate limiting | Accepted | 29 Sep 2026 |
| [ADR-019](ADR-019-goal-and-documentation-structure.md) | `docs/GOAL.md` is the source of truth; documentation structure and `AGENTS.md` | Accepted | 16 Nov 2026 |
| [ADR-020](ADR-020-no-software-buying-buy-leads.md) | Software selecting or buying IndiaMART Buy Leads (GOAL R-1) | Rejected | 16 Nov 2026 |
| [ADR-021](ADR-021-no-whatsapp-web-automation.md) | Automating WhatsApp Web or the desktop app (GOAL R-2) | Rejected | 16 Nov 2026 |
| [ADR-022](ADR-022-no-ai-written-prices.md) | AI writing prices or free quotation text (GOAL R-3) | Rejected | 16 Nov 2026 |
| [ADR-023](ADR-023-no-personal-data-to-free-ai.md) | Sending personal data to a free AI tier (GOAL R-4) | Rejected | 16 Nov 2026 |
| [ADR-024](ADR-024-no-n8n-or-make-backbone.md) | n8n or Make as the backbone (GOAL R-6) | Rejected | 16 Nov 2026 |
| [ADR-025](ADR-025-price-list-import.md) | Price lists are imported from their own text, through one code path; quotation terms | Accepted | 17 Nov 2026 |
| [ADR-026](ADR-026-build-stops-when-database-is-behind.md) | A hosted build stops when the database is behind the code | Accepted | 17 Nov 2026 |
| [ADR-027](ADR-027-documents-and-accounts-through-the-server.md) | Documents and new sign-in accounts go through the server, with the service role key | Accepted | 17 Nov 2026 |

## To be written when the work reaches them

| Decision | Planned status | Milestone |
| --- | --- | --- |
| Open-source licence | Deferred by the owner on 17 Nov 2026 (`QUESTIONS.md` Q-016) | M1, later |
| Runtime modes (cloud, local) with adapters for auth, file storage and scheduler | Accepted | M2 |
| Local-mode sign-in method | Accepted | M2 |
| IndiaMART through Push plus Pull, with email as cross-check | Accepted | M4 |
| AI tiers, provider interface, redaction for the Basic tier | Accepted | M5 |
| Outbound pipeline with hold rules and modes | Accepted; marks ADR-010 Superseded | M7 |
