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
| `org_settings` | Per-company settings, one row | `features` (json; reserved, nothing reads it yet), `quote_validity_days`, `timezone`, `home_country`, `default_price_basis`, `payment_terms` (printed on quotations; empty until entered), `price_list_map` (json: how the company's price list maps onto its catalogue, see `priceListMapSchema`) |
| `memberships` (soft delete) | Who belongs to which company, with a role. Managed on Settings → Members; a removed member's row stays, marked deleted | `user_id`, `role` (`owner`, `admin`, `sales`, `qa`, `accounts`, `viewer`), `granted` and `revoked` (text arrays: custom access on top of the role), `email`, `display_name`; unique `(org_id, user_id)` |
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
| `buylead_rules` | One row per company: matching rules | `product_terms`, `excluded_terms`, `allowed_countries`, `allowed_states`, `excluded_states`, `min_quantity_kg`, `max_quantity_kg`, `daily_cap` (suggestions per day), `test_mode` (always true since ADR-020; kept for old rows) |
| `buylead_decisions` | Log of each Buy Lead decision | `lead_title`, `product`, `location`, `quantity`, `decision` (`would_contact` = suggested, `skipped`; `contacted` exists only in old rows and can no longer be written), `reason`, `decided_at`, `test_mode` (kept for old rows), `meta` |

### Documents (`documents/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `documents` (soft delete) | Document library: one row per uploaded file (GOAL G-KB-4). The file is in storage under `storage_key` | `product_id` (empty = whole company), `type` (`coa`, `tds`, `msds`, `specification`, `brochure`, `certificate`), `title`, `file_name`, `content_type`, `size_bytes`, `sha256`, `storage_key` (unique), `batch`, `issue_date`, `expiry_date`, `notes`. Index `(org_id, product_id, type)`. RLS: members read, owners and admins write (`0006`) |

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

## Policies (`drizzle/0001_rls_policies.sql`, rewritten by `drizzle/0008_access_rules.sql`)

Since 0008, writes are allowed by **permission**, not by role name. Helper functions, all `SECURITY DEFINER` with an empty search path, reading `auth.uid()`:

- `app.is_member(org)`: any active member (used for reading).
- `app.role_default(role, permission)`: the role's default permissions, a copy of `ROLE_PERMISSIONS` in `src/modules/core/permissions.ts`. `tests/roles.test.ts` fails if the two differ, so change both together, in a new migration.
- `app.can(org, permission)`: owner, or the role's default and not in `memberships.revoked`, or in `memberships.granted`.
- `app.can_any(org, permissions[])`, and `app.can_work(org)`: may change anything at all.
- `app.has_role(org, roles[])` (from 0001) is still used for deletes on the working tables and for `organizations`.

| Group | Tables | Read | Insert and update | Delete |
| --- | --- | --- | --- | --- |
| Company | `organizations` | members | owner (update only) | — |
| Working tables | `contacts`, `leads`, `lead_notes`, `lead_status_changes`, `email_messages`, `quotations`, `events`, `audit_logs`, `jobs`, `sync_runs`, `buylead_decisions` | members | `can_work` (anyone who may change something) | owner, admin |
| Settings | `org_settings` | members | `settings.write` or `catalog.write` (price list mapping) | same |
| Members | `memberships` | members | `members.manage` | same |
| Catalogue | `products`, `product_grades` | members | `catalog.write` | same |
| Rates | `price_entries` (append-only) | members | `rates.write` | — |
| Templates and rules | `templates`, `classification_rules`, `buylead_rules` | members | `templates.write`; `rules.write`; `buylead.rules.write` or `catalog.write` | same |
| Connections | `integrations` | members | `integrations.manage` | same |
| Documents | `documents` | members | `documents.write` | same |
| Tokens | `mcp_tokens` | `mcp_tokens.manage` | `mcp_tokens.manage` | `mcp_tokens.manage` |
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
| `0002_storage_bucket.sql` | Private `documents` storage bucket (Supabase only; a no-op elsewhere). Used by the document library through the service role key (`documents/storage.ts`); no storage policies are needed |
| `0003_org_payment_terms.sql` | `org_settings.payment_terms` (text, empty by default) |
| `0004_org_price_list_map.sql` | `org_settings.price_list_map` (json, empty by default) |
| `0005_documents.sql` | Enum `document_type` and table `documents` |
| `0006_documents_rls.sql` | Row-level security, grants and the `updated_at` trigger for `documents` |
| `0007_roles_and_access.sql` | Roles `qa` and `accounts`; `memberships.granted` and `memberships.revoked` |
| `0008_access_rules.sql` | Permission-based write rules (`app.role_default`, `app.can`, `app.can_any`, `app.can_work`) replacing the role-based ones |

Rules: generate with `npm run db:generate`; never edit an applied migration; a new table needs base columns, `org_id`, and a migration that enables RLS with policies, plus a case in `tests/rls.test.ts`. Apply with `npm run db:migrate` (TCP) or `npm run db:remote:apply` (HTTPS).
