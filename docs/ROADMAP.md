# Roadmap

None of this is built. The MVP is designed so each item can be added as a new module or subscriber without rewriting existing code.

| Phase | Feature | How it plugs in |
|---|---|---|
| 2 | **Conversation handling and follow-ups:** reminders when a quoted lead goes quiet; Claude drafts replies to buyer questions (COA, samples, negotiation). | `email_messages.classification='conversation'` is already linked to leads. A new `followups` module subscribes to `lead.status_changed` / `quote.drafted` events and schedules jobs. MCP gains `list_conversations_needing_reply`. |
| 2 | **Document library:** auto-attach COA (per batch), TDS, MSDS and certificates when requested; expiry checks; a sharing rule per document. | New `documents` module with a Supabase Storage **private** bucket, `documents` + `document_batches` tables, and signed URLs. `createQuoteDraft` gains `attachments` (MIME multipart/mixed). Per-document `share_policy`. |
| 2 | **Members screen:** invite and change roles in-app. | `core` service + Supabase Auth admin invite. |
| 3 | **Proforma invoices and GST invoice CSV export** (pluggable formatters). | New `exports` module (see ARCHITECTURE "Add an export format"). The quotation snapshot is the source of truth. |
| 3 | **Sample request tracking.** | `samples` module linked to leads; status pipeline; events. |
| 3 | **Analytics:** conversion by source and product, response times, rate history charts. | Read models over `events` + `lead_status_changes` (already append-only with actors and timestamps). |
| 4 | **USD pricing and international quotations.** | `price_entries` gains `currency` (default INR) and `incoterm`. Remove the `isInternational` guard in `createQuoteDraft` for orgs with the `intl_quotes` feature flag (`org_settings.features`). |
| 4 | **Multi-organisation onboarding and billing (resale).** | Everything is already org-scoped with RLS. Add a signup flow creating `organizations` + `org_settings` + owner membership, per-org integrations (already per org), and Stripe billing gated by `org_settings.features`. |
| any | More lead sources (Justdial, website form, WhatsApp Business). | Source adapter pattern (ARCHITECTURE "Add a lead source"). |
| any | Hardening: nonce-based CSP, shared rate limiter (Upstash), CIMD support for Claude, `APP_ENCRYPTION_KEY` rotation tooling. | See SECURITY "Known limitations". |
