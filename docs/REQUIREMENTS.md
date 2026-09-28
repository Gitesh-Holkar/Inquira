# MVP requirements

Each requirement has acceptance criteria (AC). "✓" marks what is implemented and covered by a test or a Playwright check as of 29 Sep 2026. Items marked "◐" work but need a real account to verify end to end.

## In scope
- Multi-organisation data model with roles; one organisation (STDM) is seeded.
- Lead capture from TradeIndia (API + notification email), IndiaMART (email, plus Buy Leads clicked by Claude Cowork), and direct Gmail inquiries.
- Contact and lead de-duplication.
- Lead inbox, lead detail, status pipeline, notes, WhatsApp link.
- Catalog, append-only rates, rates bulk edit.
- Templates; quotation drafts in Gmail (never sent by the app).
- MCP server for Claude, with auth and an audit trail.
- IndiaMART buy-lead rules and a decision log for Cowork.
- Dashboard, settings and integrations.

## Out of scope (MVP)
- **Sending email or WhatsApp messages.** A human always sends.
- USD pricing and international quotations. International leads are stored and parked.
- Phone-call lead capture (enter them manually with **New lead**).
- Handling conversation emails beyond linking them to the lead, and follow-up reminders.
- COA/TDS document library, proforma invoices, GST exports, samples tracking, analytics.
- In-app member management and billing (see ROADMAP).

---

## R1 Settings and integrations (admin)
- **R1.1** TradeIndia credentials (User ID, Profile ID, Key) with Test connection and last-sync status.
  - AC: the key is stored encrypted and never shown again ✓
  - AC: a failing test shows the error; a success starts a 30-day backfill ✓ (◐ live API)
- **R1.2** Gmail via Google OAuth: Client ID/Secret stored encrypted; Connect / Reconnect / Disconnect; minimal scopes.
  - AC: the refresh token is encrypted ✓
  - AC: a revoked token → `reauth_required` + a red "Reconnect Gmail" banner ✓
  - AC: scopes are `gmail.readonly` + `gmail.compose` only ✓ (◐ live Google)
- **R1.3** MCP tokens: create, name, revoke; shown once; hash stored. ✓
- **R1.4** Everything runs with integrations "Not connected". ✓ (e2e runs without any integration)

## R2 Syncing
- **R2.1** TradeIndia: first connect backfills 30 days, then every 10 minutes; incremental and idempotent by inquiry ID; raw payload stored; international flagged; every run logged; backoff on errors and rate limits; last sync and last error shown. ✓ (tests with a fake API; ◐ live)
- **R2.2** API and notification email become one lead: matched by `rfi_id` when present, otherwise by phone/email + product within 48 hours. ✓
- **R2.3** Gmail: historyId incremental with a date-resync fallback; every message stored with a trimmed body and a classification (`inquiry`, `conversation`, `ignored`, `international`, `needs_review`); nothing skipped silently. ✓
- **R2.4** Parsers for IndiaMART and TradeIndia notification formats, with anonymised fixtures and unit tests; unknown formats go to `needs_review`. ✓ (17 fixtures)
- **R2.5** Classification rules stored in a table and editable in the UI; one-click "always ignore @domain" from the review queue. ✓
- **R2.6** Reconciliation: "X received today, Y classified, Z pending review". ✓

## R2b IndiaMART via Claude Cowork
- **R2b.1** Buy-lead rules: product terms and aliases mapped to catalog products, exclusions, allowed and excluded locations, quantity range, daily cap, test mode. ✓
- **R2b.2** MCP tools `get_buylead_rules`, `log_buylead_decision`, `get_buylead_summary`; the cap is enforced server-side too. ✓
- **R2b.3** Dashboard card "N contacted, M skipped, K arrived by email" with a decision log. ✓
- **R2b.4** `docs/COWORK_INDIAMART_TASK.md`: a ready-to-paste prompt with test mode. ✓

## R3 Leads
- **R3.1** Inbox filters (source, status, product, date, international), search, and mobile cards. ✓
- **R3.2** Detail shows contact info, product, quantity, location, raw message, email thread, notes, status timeline and audit trail. ✓
- **R3.3** Status pipeline: new, contacted, quoted, negotiating, won, lost, not relevant. ✓
- **R3.4** WhatsApp button: editable prefilled text → `https://wa.me/<E164 without +>?text=…`. ✓
- **R3.5** One-click actions: WhatsApp, Call (`tel:`), Copy phone, Copy email, Create quote draft. Keyboard shortcuts j/k/e/w/q and a `?` help overlay. ✓

## R4 Catalog and rates
- **R4.1** Seeded from stdmfood.com and the rates file; unclear rates flagged `needs_confirmation`. ✓ (66 products / 70 rates / 4 flagged)
- **R4.2** `price_entries` is append-only (trigger), with rate history. ✓
- **R4.3** Bulk "Update rates" screen: tab between cells, changed cells highlighted, "Save N changes", admin only. ✓

## R5 Templates and quote drafts
- **R5.1** Quotation email and WhatsApp templates with placeholders and a live preview. ✓
- **R5.2** Create quote draft does all of the following ✓ (fake Gmail in tests; ◐ live):
  - renders the template with current rates
  - saves the quotation with a price snapshot and validity (default 3 days, configurable)
  - appends the real Gmail signature
  - creates the draft in the inquiry's thread
  - links to the draft
- **R5.3** Disabled for international leads. ✓

## R6 MCP server
- **R6.1** Authentication is mandatory (OAuth 2.1 for claude.ai + bearer tokens). ✓
- **R6.2** Tools as listed in ARCHITECTURE.md; compact, paginated JSON. ✓
- **R6.3** Email content is marked untrusted; no tool can send, bulk-export or read credentials. ✓
- **R6.4** Every call is audited with the token name. ✓

## R7 Dashboard
- New leads today by source, leads needing action, review queue count, integration health, and the reconciliation widget. ✓

## R8 UI and UX quality
- Design tokens, light/dark mode, AA contrast, mobile-first with bottom navigation, no horizontal scroll (Playwright checks at 390px and 1440px). ✓
- Indian formats: `₹1,23,456.00`, `29 Sep 2026, 4:10 PM` IST, `+91 98765 43210`. ✓ (unit tests)
- Loading skeletons, empty states with a next step, error state with retry, toasts, confirmations for destructive actions. ✓

## Non-functional
- Every write goes through the service layer and writes an audit row (`human:<id>` / `mcp:<name>` / `system:<job>`). ✓
- RLS on every table, with an isolation test. ✓
- zod on every service and tool input. ✓
- Serverless-friendly: no always-on process; cron via pg_cron → HTTPS. ✓
