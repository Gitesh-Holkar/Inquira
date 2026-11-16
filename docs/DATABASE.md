# Database

Postgres with Drizzle ORM. Every table is in the private schema **`app`** (see [ADR-004](decisions/ADR-004-private-app-schema.md)). Row-level security is on for every table (see [ADR-005](decisions/ADR-005-how-rls-applies.md)). Keep this file in step with `src/modules/*/schema.ts`.

## Conventions

- Every table has `id` (uuid), `created_at`, `updated_at`, `created_by` (an actor string: `human:<uuid>`, `mcp:<token>`, `system:<job>`) from `baseColumns()`.
- Every table except `organizations` and `oauth_clients` has `org_id` → `organizations.id`.
- Tables marked *soft delete* have `deleted_at`; queries filter it out.
- Column names are `snake_case` in SQL and `camelCase` in code (Drizzle `casing: snake_case`).
- An `updated_at` trigger runs on every table.

## Tables

### Company and access (`src/modules/core/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `organizations` (soft delete) | One row per company | `name`, `slug` |
| `org_settings` | Per-company settings, one row | `features` (json), `quote_validity_days`, `timezone`, `home_country`, `default_price_basis` |
| `memberships` (soft delete) | Who belongs to which company, with a role | `user_id`, `role` (`owner`, `admin`, `sales`, `viewer`), `email`, `display_name`; unique `(org_id, user_id)` |
| `audit_logs` | **Append-only.** One row per write | `actor`, `action`, `entity_type`, `entity_id`, `changes` (json) |
| `events` | Domain event outbox | `type`, `entity_type`, `entity_id`, `payload`, `processed_at` |
| `jobs` | Background work queue | `type`, `payload`, `status`, `run_after`, `attempts`, `max_attempts`, `locked_at`, `dedupe_key`; unique `(org_id, dedupe_key)` |
| `integrations` | Non-secret state of each external connection | `provider` (`gmail`, `tradeindia`), `status`, `config`, `cursor`, `account_email`, sync and error timestamps, `backoff_until`; unique `(org_id, provider)` |
| `integration_secrets` | Encrypted credentials (AES-256-GCM). **System only.** | `integration_id` (unique), `ciphertext`, `key_version` |
| `sync_runs` | Log of each sync run | `provider`, `kind`, `status`, `fetched`, `created`, `duplicates`, `errors`, `error_message`, `meta` |

### Leads and contacts (`contacts/schema.ts`, `leads/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `contacts` (soft delete) | A buyer, matched by email then phone | `name`, `email`, `phone` (E.164), `company_name`, `city`, `state`, `country` |
| `leads` (soft delete) | One enquiry | `contact_id`, `source` (`tradeindia`, `indiamart`, `gmail`, `manual`), `source_ref`, `channel`, `status`, `is_international`, buyer fields, `product_text`, `product_id`, `quantity_text`, `quantity_kg`, `message`, `raw_payload`, `received_at`, `last_activity_at`, `gmail_thread_id`, `gmail_message_id`, `alternate_refs`; unique `(org_id, source, source_ref)` |
| `lead_notes` (soft delete) | Notes on a lead | `lead_id`, `body` |
| `lead_status_changes` | **Append-only** status history | `lead_id`, `from_status`, `to_status`, `reason` |

`leads.assigned_to` exists but nothing reads or writes it yet; it is reserved for assigning leads to teammates (GOAL G-PLT-2).

### Email (`email/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `email_messages` | Every synced Gmail message | `gmail_message_id` (unique per company), `gmail_thread_id`, sender and recipients, `subject`, `body_text`, `body_html` (kept only when the text part is unusable), `received_at`, `is_outgoing`, `classification`, `classification_reason`, `classified_by`, `parser_format`, `parsed` (json), `confidence`, `lead_id` |
| `classification_rules` (soft delete) | The team's email rules | `match_type`, `pattern`, `action`, `priority`, `enabled`, `hit_count` |

### Catalogue and rates (`catalog/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `products` (soft delete) | Catalogue products | `name` (unique per company), `category`, `aliases`, `default_gst_percent`, `default_pack_size`, `website_url`, `notes`, `sort_order` |
| `product_grades` (soft delete) | Grades of a product | `product_id`, `name`; unique `(product_id, name)` |
| `price_entries` | **Append-only** rate book | `grade_id`, `price_per_kg_inr`, `gst_percent`, `gst_inclusive`, `price_basis`, `moq_kg`, `pack_size`, `valid_from`, `valid_to`, `needs_confirmation`, `note` |

The current rate of a grade is the newest entry with `valid_from` ≤ today and `valid_to` empty or ≥ today.

### Quotations and templates (`quotes/schema.ts`, `templates/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `templates` (soft delete) | Quotation email and WhatsApp texts | `kind` (`quote_email`, `whatsapp`), `name`, `subject`, `body`, `is_default`; unique `(org_id, kind, name)` |
| `quotations` | Each quotation with a price snapshot | `lead_id`, `template_id`, `status` (`rendered`, `draft_created`, `draft_failed`), `items` (json snapshot of price entries), `validity_date`, `subject`, `body_text`, `to_email`, `gmail_draft_id`, `gmail_thread_id`, `gmail_draft_url`, `error` |

### Buy Leads (`buyleads/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `buylead_rules` | One row per company: matching rules | `product_terms`, `excluded_terms`, `allowed_countries`, `allowed_states`, `excluded_states`, `min_quantity_kg`, `max_quantity_kg`, `daily_cap`, `test_mode` |
| `buylead_decisions` | Log of each Buy Lead decision | `lead_title`, `product`, `location`, `quantity`, `decision` (`contacted`, `skipped`, `would_contact`), `reason`, `decided_at`, `test_mode`, `meta` |

### Claude connector (`mcp/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `mcp_tokens` | Access tokens, stored as hashes | `name`, `kind` (`manual`, `oauth`), `token_hash` (unique), `token_prefix`, `expires_at`, `last_used_at`, `revoked_at` |
| `oauth_clients` | Registered MCP clients. **System only.** No `org_id`. | `client_id` (unique), `client_secret_hash`, `client_name`, `redirect_uris`, `metadata` |
| `oauth_codes` | Single-use authorisation codes. **System only.** | `client_id`, `code_hash` (unique), `redirect_uri`, `code_challenge`, `user_id`, `expires_at`, `used_at` |
| `oauth_refresh_tokens` | Rotating refresh tokens. **System only.** | `client_id`, `token_hash` (unique), `access_token_id`, `user_id`, `expires_at`, `revoked_at` |

## Relationships

```
organizations ─┬─ org_settings (1:1)        ─┬─ products ── product_grades ── price_entries
               ├─ memberships                ├─ contacts ── leads ─┬─ lead_notes
               ├─ integrations ── integration_secrets (1:1)        ├─ lead_status_changes
               ├─ templates                                         ├─ quotations
               ├─ classification_rules                              └─ email_messages (lead_id, optional)
               ├─ buylead_rules (1:1), buylead_decisions
               └─ mcp_tokens ── oauth_refresh_tokens (access_token_id)
```

## Policies (`drizzle/0001_rls_policies.sql`)

Helper functions: `app.is_member(org)` and `app.has_role(org, roles[])`, both `SECURITY DEFINER` with an empty search path, reading `auth.uid()`.

| Group | Tables | Read | Insert and update | Delete |
| --- | --- | --- | --- | --- |
| Company | `organizations` | members | owner (update only) | — |
| Writer tables | `contacts`, `leads`, `lead_notes`, `lead_status_changes`, `email_messages`, `quotations`, `events`, `audit_logs`, `jobs`, `sync_runs`, `buylead_decisions` | members | owner, admin, sales | owner, admin |
| Admin tables | `org_settings`, `memberships`, `products`, `product_grades`, `price_entries`, `templates`, `classification_rules`, `buylead_rules`, `integrations` | members | owner, admin | owner, admin |
| Tokens | `mcp_tokens` | owner, admin | owner, admin | owner, admin |
| System only | `integration_secrets`, `oauth_clients`, `oauth_codes`, `oauth_refresh_tokens` | none | none | none |

`anon` has no access to the schema. System actors (cron, MCP tokens) connect as the table owner and must filter by `org_id` in code.

Append-only triggers reject UPDATE and DELETE on `price_entries`, `audit_logs` and `lead_status_changes`.

## Indexes

Every list the app shows has an index on its filter: leads by `(org_id, status, received_at)`, `(org_id, received_at)`, phone, email and thread; emails by `(org_id, classification, received_at)`, thread and received time; price entries by `(grade_id, valid_from, created_at)`; jobs by `(status, run_after)`; audit rows by entity and by time. Unique indexes are listed with their tables above.

## Migrations (`drizzle/`)

| File | Content |
| --- | --- |
| `0000_init.sql` | Schema `app`, enums, all 26 tables, foreign keys, indexes |
| `0001_rls_policies.sql` | Grants, RLS on every table, policies, `updated_at` and append-only triggers |
| `0002_storage_bucket.sql` | Private `documents` storage bucket (Supabase only; a no-op elsewhere). Nothing uses it until the document library (GOAL G-KB-4) is built |

Rules: generate with `npm run db:generate`; never edit an applied migration; a new table needs base columns, `org_id`, and a migration that enables RLS with policies, plus a case in `tests/rls.test.ts`. Apply with `npm run db:migrate` (TCP) or `npm run db:remote:apply` (HTTPS).
