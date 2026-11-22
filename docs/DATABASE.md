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
| `org_settings` | Per-company settings, one row | `features` (json; reserved, nothing reads it yet), `quote_validity_days`, `timezone`, `home_country`, `default_price_basis`, `payment_terms` (printed on quotations; empty until entered), `price_list_map` (json: how the company's price list maps onto its catalogue, see `priceListMapSchema`), `sample_policy` (json: free sample size, details a buyer must send, note; see `samplePolicySchema`; empty until entered), `outbound` (json: mode, pause switch, send window, caps, follow-up days, daily summary; see `outboundSettingsSchema`; empty = safe defaults) |
| `memberships` (soft delete) | Who belongs to which company, with a role. Managed on Settings → Members; a removed member's row stays, marked deleted | `user_id`, `role` (`owner`, `admin`, `sales`, `qa`, `accounts`, `viewer`), `granted` and `revoked` (text arrays: custom access on top of the role), `email`, `display_name`; unique `(org_id, user_id)` |
| `audit_logs` | **Append-only.** One row per write | `actor`, `action`, `entity_type`, `entity_id`, `changes` (json) |
| `events` | Domain event outbox | `type`, `entity_type`, `entity_id`, `payload`, `processed_at` |
| `jobs` | Background work queue | `type`, `payload`, `status`, `run_after`, `attempts`, `max_attempts`, `locked_at`, `dedupe_key`; unique `(org_id, dedupe_key)` |
| `integrations` | Non-secret state of each external connection, and the settings of each AI tier | `provider` (`gmail`, `tradeindia`, `indiamart`, `ai_basic`, `ai_advanced`; an AI tier's `config` holds provider, model, address, threshold and daily limit), `status`, `config`, `cursor`, `account_email`, sync and error timestamps, `backoff_until`; unique `(org_id, provider)` |
| `integration_secrets` | Encrypted credentials (AES-256-GCM). **System only.** | `integration_id` (unique), `ciphertext`, `key_version` |
| `sync_runs` | Log of each sync run | `provider`, `kind`, `status`, `fetched`, `created`, `duplicates`, `errors`, `error_message`, `meta` |

### Leads and contacts (`contacts/schema.ts`, `leads/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `contacts` (soft delete) | A buyer, matched by email then phone | `name`, `email`, `phone` (E.164), `company_name`, `city`, `state`, `country` |
| `leads` (soft delete) | One enquiry | `contact_id`, `source` (`tradeindia`, `indiamart`, `gmail`, `manual`), `source_ref`, `channel`, `status`, `is_international`, buyer fields, `product_text`, `product_id`, `quantity_text`, `quantity_kg`, `intent` (`new_enquiry`, `document_request`, `sample_request`, `price_negotiation`, `order`, `complaint`, `not_buyer`, `other`; empty = not settled), `filled_by` (json: who filled product, intent and quantity: `alias`, `rule:…`, `ai:basic`, `ai:advanced`, `mcp:…`, `human:…`), `understood_at` (when rules and AI finished; empty = waiting for the AI job), `score` (0–100), `score_reasons` (json list of points and reasons), `scored_at`, `outreach_planned_at` (when the outbound pipeline decided what to send), `message`, `raw_payload`, `received_at`, `last_activity_at`, `gmail_thread_id`, `gmail_message_id`, `alternate_refs`; unique `(org_id, source, source_ref)` |
| `lead_notes` (soft delete) | Notes on a lead | `lead_id`, `body` |
| `lead_status_changes` | **Append-only** status history | `lead_id`, `from_status`, `to_status`, `reason` |

`leads.assigned_to` exists but nothing reads or writes it yet; it is reserved for assigning leads to teammates (GOAL G-PLT-2).

### Email (`email/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `email_messages` | Every synced Gmail message | `gmail_message_id` (unique per company), `gmail_thread_id`, sender and recipients, `subject`, `body_text`, `body_html` (kept only when the text part is unusable), `received_at`, `is_outgoing`, `classification`, `classification_reason`, `classified_by`, `parser_format`, `parsed` (json), `confidence`, `lead_id`, `ai_checked_at` (when the Advanced AI tier looked at a review email), `attachment_names`, `reply_planned_at` (when the pipeline decided how to answer a buyer reply) |
| `classification_rules` (soft delete) | The team's email rules | `match_type`, `pattern`, `action`, `priority`, `enabled`, `hit_count` |

### Catalogue and rates (`catalog/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `products` (soft delete) | Catalogue products | `name` (unique per company), `category`, `aliases`, `default_gst_percent`, `default_pack_size`, `website_url`, `hsn_code`, `lead_time`, `payment_terms` (overrides the company's), `sample_available` (true, false, or empty = not decided), `notes`, `sort_order` |
| `product_grades` (soft delete) | Grades of a product | `product_id`, `name`; unique `(product_id, name)` |
| `price_entries` | **Append-only** rate book | `grade_id`, `price_per_kg_inr`, `gst_percent`, `gst_inclusive`, `price_basis`, `moq_kg`, `pack_size`, `valid_from`, `valid_to` (last day; after it the grade has no current rate), `needs_confirmation`, `floor_per_kg_inr` and `ceiling_per_kg_inr` (internal negotiation range), `note` |

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

### Outbound (`outbound/schema.ts`, ADR-032)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `outgoing_messages` | Every message prepared for a buyer (G-OUT-1), and the owner's daily summary; nothing is sent without one | `lead_id` (empty only for the daily summary), `channel` (`email`, `whatsapp`), `purpose`, `state` (`draft`, `held`, `approved`, `sent`, `failed`, `cancelled`), `to_address`, `subject`, `body`, `template_id`, `template_version`, `price_entry_ids`, `items` (json snapshot), `document_ids`, `hold_reasons` (json), `rule_set_version`, `mode`, `auto_approved`, `reply_to_id`, `gmail_thread_id`, `in_reply_to_message_id`, `gmail_message_id`, `edited`, `approved_by`/`_at`, `sent_by`/`_at`, `cancelled_reason`, `error`, `attempts`. Indexes `(org_id, state, created_at)`, `(org_id, lead_id, created_at)`, `(org_id, sent_at)` |
| `outbound_rules` (soft delete) | Hold rules the team made from corrections (G-OUT-9) | `match_type` (`buyer_email`, `buyer_domain`, `buyer_phone`, `product`, `text_contains`), `pattern`, `note`, `enabled` |

`notifications` (core): `kind`, `title`, `body`, `href`, `entity_type`, `entity_id`; unique `(org_id, kind, entity_id)` so each thing is told once. `memberships.notifications_seen_at` marks what a member has seen.

`template_versions` (templates): every saved text of a template (`template_id`, `version`, `subject`, `body`); `templates` gained `purpose` and `version`, and its unique index is now `(org_id, kind, purpose, name)`.

### Backups (`backup/schema.ts`, GOAL G-PLT-7)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `backups` (soft delete) | One row per backup file in file storage; rows older than 14 days are marked deleted when their file is removed | `storage_key` (`backups/<org>/<time>.json.gz`), `size_bytes`, `counts` (json: rows per table and `files`). Index `(org_id, created_at)` |

A backup holds every row of every table with an `org_id` column, except `integration_secrets`, `oauth_clients`, `oauth_codes`, `oauth_refresh_tokens`, `mcp_tokens`, `jobs`, `events` and `backups` (`EXCLUDED` in `backup/service.ts`). A new table is included automatically. Restore inserts rows in foreign-key order read from `pg_constraint`.

### AI (`ai/schema.ts`)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `ai_decisions` | One row per AI decision (GOAL G-AI-9). Written only by the AI job; one model call (`call_id`) can give several rows | `call_id`, `task` (`lead.product`, `lead.intent`, `lead.quantity`, `email.classify`), `tier`, `provider`, `model`, `entity_type`, `entity_id`, `outcome` (`applied`, `not_confident`, `invalid`, `error`), `confidence`, `value` (what the model proposed), `detail`, `latency_ms`, `input_tokens`, `output_tokens`, `corrected_at`, `corrected_by`, `corrected_value`. Indexes `(org_id, tier, created_at)` (daily limit, accuracy) and `(org_id, entity_type, entity_id)`. RLS: members read; update (marking a correction) with `leads.edit` or `emails.classify`; no insert or delete for signed-in people (`0011`) |

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
| Outbound | `outgoing_messages`, `outbound_rules` | members | `quotes.create`; rules also `settings.write` | — |
| Notifications, template versions | `notifications`, `template_versions` | members | insert: `can_work`; `templates.write` | — |
| Backups | `backups` | `settings.read` | none (written by the system) | none |
| AI log | `ai_decisions` | members | update only: `leads.edit` or `emails.classify` (insert by the AI job, as system) | — |
| Tokens | `mcp_tokens` | `mcp_tokens.manage` | `mcp_tokens.manage` | `mcp_tokens.manage` |
| System only | `integration_secrets`, `oauth_clients`, `oauth_codes`, `oauth_refresh_tokens` | none | none | none |

`anon` has no access to the schema. System actors (cron, MCP tokens) connect as the table owner and must filter by `org_id` in code.

Append-only triggers reject UPDATE and DELETE on `price_entries`, `audit_logs` and `lead_status_changes`.

## Indexes

Every list the app shows has an index on its filter: leads by `(org_id, status, received_at)`, `(org_id, received_at)`, phone, email, thread and `(org_id, understood_at)` (the AI job's queue), `(org_id, score, received_at)` (best-score sort); emails by `(org_id, classification, received_at)`, thread and received time; price entries by `(grade_id, valid_from, created_at)`; jobs by `(status, run_after)`; audit rows by entity and by time. Unique indexes are listed with their tables above.

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
| `0009_indiamart_provider.sql` | Adds `indiamart` to the `integration_provider` enum |
| `0010_ai_layer.sql` | Enum `lead_intent`; providers `ai_basic`, `ai_advanced`; table `ai_decisions`; `leads.intent`, `leads.filled_by`, `leads.understood_at`; `email_messages.ai_checked_at` |
| `0011_ai_decisions_rls.sql` | Row-level security, grants and the `updated_at` trigger for `ai_decisions` |
| `0013_outbound_pipeline.sql` | Tables `outgoing_messages`, `outbound_rules`, `notifications`, `template_versions`; `templates.purpose`, `templates.version` and the new unique index; `memberships.notifications_seen_at`; `org_settings.outbound`; `email_messages.attachment_names`, `reply_planned_at`; `leads.outreach_planned_at` |
| `0014_outbound_rls.sql` | Row-level security, grants and triggers for those four tables; every existing template becomes version 1 |
| `0015_backups_and_summary.sql` | Table `backups`; `outgoing_messages.lead_id` may be empty (the daily summary) |
| `0016_backups_rls.sql` | Row-level security, grants and the `updated_at` trigger for `backups` |
| `0012_knowledge_base.sql` | `products.hsn_code`, `lead_time`, `payment_terms`, `sample_available`; `price_entries.floor_per_kg_inr`, `ceiling_per_kg_inr`; `org_settings.sample_policy`; `leads.score`, `score_reasons`, `scored_at` and index `(org_id, score, received_at)` |

Rules: generate with `npm run db:generate`; never edit an applied migration; a new table needs base columns, `org_id`, and a migration that enables RLS with policies, plus a case in `tests/rls.test.ts`. Apply with `npm run db:migrate` (TCP) or `npm run db:remote:apply` (HTTPS).

## Local mode only: `auth.users` (from `scripts/local-db/supabase-shim.sql`)

In the cloud, Supabase Auth owns `auth.users`. In local mode and tests, the shim creates a small version of it: `id`, `email`, `encrypted_password` (scrypt hash, local sign-in), `setup_token_hash` and `setup_token_expires_at` (one-time sign-in links), `raw_user_meta_data`, `created_at`. The shim is applied by `scripts/local-setup.ts` and `npm run db:local:up`, never to a Supabase project.

