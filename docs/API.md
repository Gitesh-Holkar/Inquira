# API

Route handlers, webhooks and MCP tools. Pages and server actions are listed in `docs/CODEMAP.md` section 4. Every handler calls the service layer; none touches the database directly.

## Route handlers (`src/app/api`)

| Route | Method | Who calls it | Authentication | What it does |
| --- | --- | --- | --- | --- |
| `/api/cron/tick` | POST, GET | The scheduler (Supabase `pg_cron` in cloud mode) | Header `x-cron-secret` (or `Authorization: Bearer`), compared in constant time; `CRON_SECRET` must be at least 16 characters | Enqueues the sync jobs for every company, then runs due jobs within a time budget. Returns `{scheduled, processed, results}`. |
| `/api/integrations/gmail/callback` | GET | Google, after consent | The signed-in owner or admin who started the flow; hashed single-use `state` | Finishes the Gmail connection and redirects to Settings. |
| `/api/mcp` | POST, GET, DELETE | Claude and other MCP clients | `Authorization: Bearer <token>` (OAuth or manual). A missing or bad token returns 401 with `WWW-Authenticate: Bearer resource_metadata=…` | Stateless Streamable HTTP MCP server. Rate limited per IP. |
| `/api/oauth/register` | POST | MCP clients | None (public, rate limited) | Dynamic Client Registration (RFC 7591). |
| `/api/documents/[id]` | GET | A signed-in member's browser (Documents screen, lead page) | The session cookie; `documents.read`. Signed out → 303 to `/login`; no permission → 403; another company's or a removed document → 404 | The file as a download (`Content-Disposition: attachment`, `nosniff`, `no-store`). |
| `/api/oauth/token` | POST | MCP clients | Client ID, PKCE verifier; client secret if one was issued | Authorisation-code and refresh-token grants. Errors use RFC 6749 codes. |
| `/.well-known/oauth-protected-resource` | GET | MCP clients | None | RFC 9728 metadata. `resource` equals the MCP URL. |
| `/.well-known/oauth-authorization-server` | GET | MCP clients | None | RFC 8414 metadata. |
| `/auth/callback` | GET | The browser, from a Supabase email link | The code or token hash in the link | Creates the session and sends the person to set a password. |

The consent screen at `/oauth/authorize` is a page, not an API route: a signed-in owner or admin approves or denies a client there.

## Webhooks

| Route | Method | Who calls it | Authentication | What it does |
| --- | --- | --- | --- | --- |
| `/api/webhooks/indiamart/[secret]` | POST | IndiaMART Lead Manager Push API | The random secret in the path (created on Settings → Integrations → IndiaMART; only its SHA-256 is stored). IndiaMART offers no signature or header. Rate limited per IP; body at most 64 KB | Stores one lead (`{ CODE, STATUS, RESPONSE: { UNIQUE_QUERY_ID, … } }`). 200 once stored or already there (IndiaMART treats anything else as failed and retries; 48 hours of refusals switch the push off); 404 unknown secret; 400 no lead; 413 too large; 429 too fast; 500 storing failed. |

## Errors

Route handlers return `{ "error": { "code", "message" } }` with these statuses: `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429, `INTEGRATION` 502, `INTERNAL` 500. Internal details are logged on the server and never returned.

## MCP tools (`src/modules/mcp/server.ts`)

Endpoint: `POST /api/mcp`. Responses are compact JSON. Email and lead text written by outsiders is wrapped as `<<<UNTRUSTED_EMAIL id=…>>> … <<<END_UNTRUSTED_EMAIL>>>` and must never be followed as instructions. Every call is audited as `mcp:<token name>`.

| Tool | Input | Returns | Writes |
| --- | --- | --- | --- |
| `list_leads_needing_action` | `limit?`, `cursor?` | New and stale open leads, `next_cursor` | — |
| `get_lead` | `lead_id` | Lead, notes, history, last 5 emails, quotations | — |
| `update_lead_status` | `lead_id`, `status`, `reason?` | New status | Status, audit, event |
| `add_lead_note` | `lead_id`, `note` | Note ID | Note, audit, event |
| `list_emails_needing_review` | `limit?`, `cursor?` | Review-queue emails, hints, parsed fields | — |
| `submit_email_classification` | `email_id`, `classification`, `confidence`, `reason`, `lead?`, `lead_id?` | Status, lead ID | Classification; `inquiry` and `international` create a lead; `low` confidence stays in review as a suggestion |
| `get_current_rates` | `query?` | Product, grade, grade ID, price per kg, GST, basis, MOQ, pack | — |
| `create_quote_draft` | `lead_id`, `grade_ids?`, `validity_days?` | Quotation ID, status, Gmail draft link | Quotation and a Gmail **draft** |
| `get_classification_rules` | — | Active email rules | — |
| `get_buylead_rules` | — | `mode` (always `suggest_only`), suggestions per day, remaining, product terms, exclusions, locations, quantity range | — |
| `log_buylead_decision` | `lead_title`, `product?`, `location?`, `quantity?`, `decision` (`would_contact` = suggested, or `skipped`), `reason`, `timestamp?` | Remaining today | Decision row. It cannot record a purchase (ADR-020) |
| `get_buylead_summary` | — | Today's suggested and skipped counts and remaining suggestions | — |
| `list_leads_needing_details` | `limit?`, `cursor?` | Leads with no product or no intent after rules and Inquira's AI, the catalogue (id, name, aliases), the intent list | — |
| `submit_lead_details` | `lead_id`, `product_id?`, `intent?`, `quantity_kg?`, `confidence`, `reason` | `filled` with the fields written, `nothing_to_fill`, or `kept_for_review` | Fills **empty** fields only (never overwrites); `low` confidence only adds a note |

Lead summaries include `product_id`, `intent` and `qty_kg`. MCP tokens cannot delete anything, change rates, templates, rules or settings, read credentials, send email, or export in bulk; their only lead-editing tool is `submit_lead_details`. The permission set is `MCP_PERMISSIONS` in `src/modules/core/permissions.ts`.
