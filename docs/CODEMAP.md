# Code map

Every file, exported function, page, route and background job in Inquira, and what it is for. Read this before searching the code; it tells you where a change belongs.

**Keep it current:** when you add, rename, move or delete a function, file, route, page or job, update this file in the same commit (CLAUDE.md rule).

How a request flows: **page or server action** (`src/app`) → **service** (`src/modules/<m>/service.ts`, built with `defineService`) → **database** (Drizzle, schema `app`, RLS). The MCP tools (Claude) and cron jobs call the same services. UI code never touches the database directly (ESLint enforces this).

---

## 1. "I want to change…" → where

| I want to… | Change this | Notes |
|---|---|---|
| Change who may do what | `src/modules/core/permissions.ts` | Roles (owner/admin/sales/viewer) and the narrow MCP permission set |
| Add or change a lead field | `src/modules/leads/schema.ts` → `npm run db:generate` → `leads/service.ts` (`upsertLeadInternal`, `updateLead`) → `leads/[id]/page.tsx` + `components/leads/detail-client.tsx` | Never edit an applied migration |
| Change how duplicate inquiries merge | `upsertLeadInternal` and `fillMissing` in `src/modules/leads/service.ts`; contacts in `resolveContactInternal` (`contacts/service.ts`) | 48 h window, `source`+`source_ref` first |
| Support a new IndiaMART/TradeIndia email format | `src/modules/email/parsers/indiamart.ts` or `tradeindia.ts` + a fixture in `fixtures/emails/` with an `expected` block | `parsers.test.ts` runs every fixture |
| Ignore/route certain emails | Settings → Email rules (data), or the built-in checks in `classifyEmail` (`email/classify.ts`) | |
| Change the quote email text | Templates screen (data); defaults in `src/modules/templates/engine.ts` | Placeholders: `PLACEHOLDERS` in engine.ts |
| Change how the quote draft is built (subject, threading, signature) | `createQuoteDraft` + `renderQuote` in `src/modules/quotes/service.ts`; MIME in `quotes/mime.ts` | Drafts only, never send |
| Change the WhatsApp message logic | `whatsappForLead` in `quotes/service.ts`; button in `components/leads/actions.tsx` | |
| Change Gmail sync (what is read, how often, limits) | `syncGmail` in `src/modules/sources/gmail/service.ts`; HTTP in `gmail/client.ts` | Time budget 35 s, 150 msgs/run |
| Change TradeIndia sync | `syncTradeIndia` in `sources/tradeindia/service.ts`; field mapping in `normalize.ts`; HTTP in `client.ts` | See docs/TRADEINDIA_API.md |
| Add a new lead source | docs/ARCHITECTURE.md "Add a lead source"; register the job in `src/modules/sources/jobs.ts` | |
| Add background work | `JOB_HANDLERS` + `tick()` in `src/modules/sources/jobs.ts` | Runs from `/api/cron/tick` |
| Add or change a Claude (MCP) tool | `buildMcpServer` in `src/modules/mcp/server.ts` (+ `MCP_TOOL_NAMES`) | The tool must call a service, never the DB |
| Change dashboard numbers | `getDashboard` in `src/modules/dashboard/service.ts`; UI in `src/app/(app)/page.tsx` | |
| Change rates screen behaviour | `components/rates/rates-editor.tsx`; saving in `updateRates` (`catalog/service.ts`) | Append-only price history |
| Change IndiaMART buy-lead rules/cap | `src/modules/buyleads/service.ts`; UI `components/settings/buylead-rules.tsx`; prompt in docs/COWORK_INDIAMART_TASK.md | |
| Change sign-in / password emails | `src/app/login/*`, `src/app/auth/callback/route.ts`, `src/components/auth/hash-session.tsx`, `src/lib/auth.ts` | Setup: docs/SETUP.md §4 |
| Change navigation | `src/components/shell/nav.tsx` (sidebar + phone bottom bar), `src/app/(app)/layout.tsx` (header, banners) | |
| Change colours/spacing tokens | `src/app/globals.css` | Tailwind 4 tokens |
| Change formats (₹, dates, phones) | `src/lib/format.ts`, `src/lib/phone.ts` | |
| Add a table | `src/modules/<m>/schema.ts` + custom RLS migration (copy `drizzle/0001_rls_policies.sql`) + `tests/rls.test.ts` | |

---

## 2. Service layer basics (`src/modules/core`)

| Function | File | What it does |
|---|---|---|
| `defineService({name, input, permission, runAs?, handler})` | `core/service-kit.ts` | The only way to write a public service: validates input (zod), checks permission, runs `handler(ctx, input, tx)` in one transaction. Humans run as `authenticated` (RLS); `runAs: "system"` is for services touching system-only tables (`integration_secrets`). |
| `defineExternalService({...})` | `core/service-kit.ts` | Same checks, no outer transaction: for services that call Google/TradeIndia and open short `withSystemTx` transactions themselves. |
| `runTx(ctx, fn)` | `core/service-kit.ts` | Transaction as the actor: `withUserTx` for humans, `withSystemTx` for MCP/system. |
| `parseInput(schema, raw)` | `core/service-kit.ts` | zod parse → `AppError("VALIDATION")` with field errors. |
| `audit(tx, ctx, {action, entityType, entityId, changes})` | `core/audit.ts` | Writes an append-only audit row (`human:<id>` / `mcp:<token>` / `system:<job>`). Every write must call it (hard rule 8). |
| `emit(tx, ctx, {type, ...})` | `core/audit.ts` | Records a domain event in the `events` outbox. Types are in `EVENT_TYPES` (`core/types.ts`). |
| `can(ctx, perm)` / `authorize(ctx, perm)` | `core/permissions.ts` | Permission check (boolean / throws FORBIDDEN). `PERMISSIONS`, `ROLE_PERMISSIONS`, `MCP_PERMISSIONS` define the sets. |
| `actorString(actor)` | `core/types.ts` | Actor → `human:<uuid>` / `mcp:<name>` / `system:<job>`. Types `Ctx`, `Actor`, `Role`. |

### `core/service.ts` (orgs, integrations, sync runs, jobs, audit reads)
| Function | What it does |
|---|---|
| `membershipsForUserInternal(tx, userId)` | A user's organisations and roles (used by sign-in). |
| `getOrgSettingsInternal` / `getOrgSettings` / `updateOrgSettings` | Organisation settings (quote validity days, default price basis, features). |
| `getIntegrationInternal(tx, orgId, provider)` | The Gmail/TradeIndia integration row; creates it (audited) if missing. |
| `readSecretsInternal` / `writeSecretsInternal` | Decrypt/encrypt integration secrets (AES-256-GCM). Server-only; audit logs field names, never values. Need a system transaction. |
| `updateIntegrationInternal` | Update integration state (status, cursor, errors), optionally audited. |
| `recordIntegrationSuccess` / `recordIntegrationFailure` / `backoffDelayMs` | Health bookkeeping and exponential backoff (10 min → 6 h). |
| `listIntegrations` | Integration status for banners and Settings (no secrets). |
| `startSyncRunInternal` / `finishSyncRunInternal` / `listSyncRuns` | "Recent sync runs" log. |
| `enqueueJobInternal` / `claimJobsInternal` / `completeJobInternal` / `failJobInternal` | Job queue (dedupe keys, SKIP LOCKED claiming, retries with backoff). |
| `listAudit` | Audit rows for an entity (lead page "Audit trail"). |
| `listOrgIdsInternal` | All organisations (cron schedules syncs for each). |

---

## 3. Modules (`src/modules/<module>`)

Each module has `schema.ts` (tables), `service.ts` (logic) and sometimes `types.ts`. `…Internal(tx, …)` functions are for other modules and jobs; the others are `defineService` public services.

### leads (`leads/service.ts`, `leads/types.ts`, `leads/schema.ts`)
| Function | What it does |
|---|---|
| `upsertLeadInternal(tx, ctx, NormalizedLead)` | **Core of lead capture.** Idempotent insert: same `source`+`source_ref` → same lead; else same phone/email + product within 48 h → merge; else new lead + contact. |
| `detectInternational`, `isIndia`, `quantityToKg` | Helpers: international detection (country or non-+91 phone), "1 Ton" → 1000 kg. |
| `listLeads` | Inbox query: filters, search (incl. phone digits), pagination. |
| `getLead` / `getLeadInternal` | One lead with notes and status history. |
| `updateLeadStatus`, `markQuotedInternal` | Status changes (+ history row, audit, event); quotes move new/contacted → quoted. |
| `addLeadNote`, `updateLead`, `createManualLead`, `deleteLead` (soft) | Lead editing from the UI. |
| `listLeadsNeedingAction` | For Claude: new leads + stale open leads. |
| `leadStatsInternal`, `countLeadsByChannelSinceInternal` | Dashboard counts (by arrival time `received_at`). |
| `findLeadByThreadInternal`, `findRecentLeadByContactInternal`, `touchLeadInternal` | Link follow-up emails to existing leads. |
| `types.ts`: `LEAD_STATUSES`, `LEAD_SOURCES`, `STATUS_LABELS`, `SOURCE_LABELS`, `NormalizedLead`, `listLeadsInput` | Shared lead vocabulary. |

### contacts (`contacts/service.ts`)
| `cleanEmail(raw)` | Normalise an email; drop portal placeholder addresses. |
|---|---|
| `resolveContactInternal(tx, ctx, input)` | Find a contact by email then phone, fill empty fields, or create one. |

### email (`email/service.ts`, `email/classify.ts`, `email/parsers/*`)
| Function | What it does |
|---|---|
| `ingestMessageInternal(tx, ctx, msg, own)` | **Gmail pipeline step:** store message (idempotent), classify, create/link the lead, audit + events. |
| `storedGmailIdsInternal(tx, orgId, ids)` | Which Gmail ids are already stored (sync skips them). |
| `classifyEmail(msg, ctx)` (`classify.ts`) | Deterministic classification, in order: own mail → team rules → portal parsers → replies in a lead's thread → OTP/bank/newsletter noise → else `needs_review`. |
| `ruleMatches(rule, msg, body)` (`classify.ts`) | Does a classification rule match this email. |
| `listEmailsNeedingReview` | Review queue (UI and MCP). |
| `submitEmailClassification` | Classify a review email (person or Claude); low-confidence MCP answers stay in review as suggestions. |
| `listEmailsForLead` | Email thread on the lead page. |
| `listClassificationRules`, `createClassificationRule` (can clear matching review emails, audited), `updateClassificationRule`, `getClassificationRulesCompact` | Email rules; refuses domain rules for public mail providers (`FREE_MAIL_DOMAINS`). |
| `reconciliationInternal` / `getReconciliation` | "X received, Y classified, Z pending" numbers. |
| `senderDomain`, `getMessageMetaInternal` | Helpers (review UI; quote threading headers). |
| `parsers/indiamart.ts`: `parseIndiaMart`, `isIndiaMart`, `parseInlineKv`, `splitBuyleadIdentity`, `extractAddress`, `mentionsForeignCountry` | IndiaMART enquiry/buy-lead/export emails → lead fields. |
| `parsers/tradeindia.ts`: `parseTradeIndia`, `isTradeIndia`, `extractRfiId` | TradeIndia emails → lead fields + `rfi_id` (dedupes with the API). |
| `parsers/text.ts`: `htmlToText`, `bestText`, `isUsableText`, `lines`, `clean`, `parseIndianLocation`, `titleCase`, `decodeEntities`, state/country lists | Text helpers shared by the parsers. |

### catalog (`catalog/service.ts`, `catalog/types.ts`)
| Function | What it does |
|---|---|
| `currentRatesInternal` / `getCurrentRates` | Current rate per grade (newest entry valid today). |
| `rateHistory` | All price entries for a grade. |
| `updateRates` | Append new price rows (never overwrite); refuses back-dated `valid_from`. |
| `listProducts`, `createProduct` / `createProductInternal` | Products and grades. |
| `matchProduct`, `normalizeProductText`, `productMatcherCatalog` | Free text ("soy isolate protein") → catalogue product. |
| `productNameById`, `countProducts` | Small lookups. |
| `types.ts`: `updateRatesInput`, `rateUpdateItem`, `moneyString`, `percentString`, `CurrentRate` | Rate input validation. |

### quotes (`quotes/service.ts`, `quotes/mime.ts`)
| Function | What it does |
|---|---|
| `createQuoteDraft(ctx, {leadId, gradeIds?, ...})` | Render the template with current rates, snapshot prices, create a **Gmail draft** in the inquiry thread with the real signature. Never sends. Used by the UI button and the MCP tool. |
| `renderQuote(lead, items, template, validity, orgName)` | Pure rendering of subject/body. |
| `listQuotationsForLead` | Quotations on the lead page. |
| `whatsappForLead` | Prefilled WhatsApp text + wa.me link. |
| `mime.ts`: `buildMime`, `bodyToHtml`, `formatAddress`, `escapeHtml` | RFC 2822 message for Gmail drafts (header-injection safe). |

### templates (`templates/service.ts`, `templates/engine.ts`)
| `render(template, vars)`, `unknownPlaceholders`, `PLACEHOLDERS`, `DEFAULT_*` | Safe `{{placeholder}}` renderer and default texts (engine.ts). |
|---|---|
| `listTemplates`, `saveTemplate`, `getTemplateInternal`, `getDefaultTemplateInternal`, `ensureDefaultTemplatesInternal`, `SAMPLE_VARS` | Template storage, defaults, and preview sample values. |

### buyleads (`buyleads/service.ts`) — IndiaMART Buy Leads via Claude Cowork
| Function | What it does |
|---|---|
| `getBuyleadRules` / `getRulesInternal`, `updateBuyleadRules`, `rulesInput` | Rules shown in Settings (products + terms, exclusions, states, quantity range, daily cap, test mode). |
| `getBuyleadRulesCompact` | Token-light rules for the Cowork task (MCP `get_buylead_rules`), incl. `remaining_today`. |
| `logBuyleadDecision` | Cowork logs each lead (contacted / would_contact / skipped); flags over-cap and clicks in test mode. |
| `getBuyleadSummary`, `listBuyleadDecisions`, `todayDecisionCountsInternal` | IndiaMART page and dashboard card. |
| `seedRulesFromCatalogInternal` | First-time match terms from the catalogue. |

### dashboard (`dashboard/service.ts`)
| `getDashboard` | All dashboard numbers in one call: new today by source, needing action, review queue, international, integration health, IndiaMART card. |
|---|---|

### mcp (`mcp/server.ts`, `mcp/service.ts`) — Claude connector
| Function | What it does |
|---|---|
| `buildMcpServer(ctx)` | Registers the 12 MCP tools (`MCP_TOOL_NAMES`); each calls a service and is audited. |
| `untrusted(id, body)`, `UNTRUSTED_NOTE` | Wrap email text in delimiters (prompt-injection defence). |
| `authenticateBearer(token)` | Bearer token → MCP actor context. |
| `createMcpToken`, `listMcpTokens`, `revokeMcpToken` | Manual tokens (Settings → Claude / MCP). |
| `registerOAuthClient`, `validateAuthorizeRequest`, `issueAuthorizationCode`, `tokenEndpoint`, `redirectMatches`, `validRedirectUri`, `getOAuthClient`, `OAuthError` | OAuth 2.1 (DCR + PKCE, rotating refresh tokens) for claude.ai custom connectors. |

### sources (`sources/*`) — external lead sources
| Function | File | What it does |
|---|---|---|
| `tick(opts)` | `sources/jobs.ts` | Cron entry: enqueue Gmail + TradeIndia syncs for every org, then run due jobs one at a time (stops starting jobs after 20 s). |
| `JOB_HANDLERS` | `sources/jobs.ts` | Job type → function. Register new background work here. |
| `syncGmail(ctx, opts)` | `gmail/service.ts` | Incremental Gmail sync (history id; date resync fallback; backlog; skips stored ids; 35 s budget). |
| `saveGmailClient`, `startGmailConnect`, `completeGmailConnect` / `completeConnectInternal`, `disconnectGmail` | `gmail/service.ts` | Settings → Gmail: save OAuth client, consent URL (PKCE + hashed state), finish OAuth, disconnect. |
| `gmailClientFor(ctx)`, `gmailRedirectUri()`, `toIngestMessage`, `orgIdFromState` | `gmail/service.ts` | Ready API client; redirect URI from APP_URL; Gmail message → ingest shape. |
| `GmailClient` (`getProfile`, `listMessages`, `listHistory`, `getMessage`, `listSendAs`, `createDraft`), `exchangeCode`, `GMAIL_SCOPES` | `gmail/client.ts` | Minimal Gmail REST client: **no send method**. Retries 429/5xx/403-rate-limit. |
| `GmailReauthRequired`, `GmailHistoryExpired`, `GmailMessageGone` | `gmail/client.ts` | Error types the sync reacts to. |
| `header`, `extractBodies`, `parseAddressList`, `parseFrom`, `gmailDraftUrl`, `gmailThreadUrl` | `gmail/client.ts` | MIME helpers and Gmail web links. |
| `saveTradeIndiaCredentials`, `testTradeIndiaConnection` / `testConnectionInternal`, `syncTradeIndia` | `tradeindia/service.ts` | Settings → TradeIndia and the 10-minute sync (30-day backfill, 2-day overlap). |
| `TradeIndiaClient` (`page`, `inquiries`), `TradeIndiaAuthError`, `TradeIndiaRateLimited` | `tradeindia/client.ts` | TradeIndia My Inquiry API client (7-day windows). |
| `normalizeTradeIndia`, `tradeIndiaDate` | `tradeindia/normalize.ts` | API row → `NormalizedLead`. |
| `emptyStats`, `SyncStats`, `LeadSourceAdapter` | `sources/types.ts` | Shared sync types. |

---

## 4. Pages and server actions (`src/app`)

Server actions only call services (`requireSession(permission)` → `runAction(() => service(ctx, input))` → `revalidatePath`).

| Route | Page file | Actions file / components |
|---|---|---|
| `/` Dashboard | `(app)/page.tsx` | — |
| `/leads` Inbox (+ International tab) | `(app)/leads/page.tsx` | `components/leads/inbox-list.tsx` (keyboard j/k/e/w/q/?), `new-lead.tsx` |
| `/leads/[id]` Lead detail | `(app)/leads/[id]/page.tsx` | `(app)/leads/actions.ts`: `setStatusAction`, `addNoteAction`, `quoteAction`, `whatsappTextAction`, `updateLeadAction`, `createLeadAction`; components `leads/actions.tsx` (Copy/Call/WhatsApp/Quote buttons), `leads/detail-client.tsx` (status, notes, edit) |
| `/review` Review queue | `(app)/review/page.tsx` | `(app)/review/actions.ts`: `classifyAction`; `components/review/review-item.tsx` |
| `/rates` Rates | `(app)/rates/page.tsx` | `(app)/rates/actions.ts`: `saveRatesAction`, `rateHistoryAction`, `addProductAction`; `components/rates/rates-editor.tsx`, `add-product.tsx` |
| `/templates` | `(app)/templates/page.tsx` | `(app)/templates/actions.ts`: `saveTemplateAction`; `components/templates/editor.tsx` |
| `/indiamart` Buy-lead log | `(app)/indiamart/page.tsx` | — |
| `/settings?tab=…` | `(app)/settings/page.tsx` | `(app)/settings/actions.ts`: TradeIndia save/test, Sync now, Gmail save/connect/disconnect, MCP tokens, email rules, buy-lead rules, org settings; components in `components/settings/*` |
| `/login` | `login/page.tsx` | `login/actions.ts`: `signIn`, `sendReset` (first password / reset email), `updatePassword`, `devSignIn` (local only), `signOut`; `login/forms.tsx` |
| `/auth/callback` | `auth/callback/route.ts` | Email links (PKCE `code` or `token_hash`) → session → set password |
| `/auth/update-password` | `auth/update-password/page.tsx` | Uses `updatePassword` |
| `/oauth/authorize` | `oauth/authorize/page.tsx` | `oauth/authorize/actions.ts`: `approveAction`, `denyAction` (Claude connector consent) |
| Shared layout | `(app)/layout.tsx` | Header, sidebar/bottom nav, integration and APP_URL warning banners; `requireSession()` |
| Errors / loading | `(app)/error.tsx`, `(app)/loading.tsx`, `leads/loading.tsx`, `leads/[id]/not-found.tsx`, `global-error.tsx`, `not-found.tsx` | |

### API routes (`src/app/api`)
| Route | File | What it does |
|---|---|---|
| `POST/GET /api/cron/tick` | `api/cron/tick/route.ts` | Called by Supabase pg_cron every 10 min (`x-cron-secret`) → `tick()`. |
| `GET /api/integrations/gmail/callback` | `api/integrations/gmail/callback/route.ts` | Google OAuth redirect → `completeGmailConnect`. |
| `POST/GET/DELETE /api/mcp` | `api/mcp/route.ts` | MCP endpoint (stateless Streamable HTTP, bearer auth, rate limited). |
| `POST /api/oauth/register` | `api/oauth/register/route.ts` | OAuth Dynamic Client Registration. |
| `POST /api/oauth/token` | `api/oauth/token/route.ts` | OAuth token endpoint (code + refresh grants). |
| `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` | `api/well-known/*/route.ts` (rewrites in `next.config.ts`) | OAuth discovery for Claude. |

### Request guard
`src/proxy.ts` (`proxy`, `config`): refreshes the Supabase session cookie and sends signed-out users to `/login` (public: `/login`, `/auth/*`, `/api/*`, `/.well-known/*`).

---

## 5. UI building blocks (`src/components`)

| File | Exports | Use |
|---|---|---|
| `ui/primitives.tsx` | `Input`, `Textarea`, `Select`, `Label`, `Field` (label + error/hint), `Card*`, `Badge`, `Skeleton`, `EmptyState`, `PageHeader`, `Alert` | Basic styled elements |
| `ui/button.tsx` | `Button`, `buttonVariants` | Buttons (sizes incl. 44 px `touch`) |
| `ui/dialog.tsx` | `Dialog`, `DialogContent`, `ConfirmDialog` | Modals; confirm for destructive actions |
| `status.tsx` | `StatusBadge`, `SourceBadge`, `EMAIL_CLASS_LABEL` | Colour + text status labels |
| `shell/nav.tsx`, `shell/theme-toggle.tsx` | `Sidebar`, `BottomNav`, `ThemeToggle` | Navigation and light/dark |
| `auth/hash-session.tsx` | `HashSessionHandler` | Session/error from `#access_token` / `#error` email links |

---

## 6. Shared libraries (`src/lib`, `src/db`)

| Function | File | What it does |
|---|---|---|
| `getDb`, `closeDb`, `withUserTx(userId, fn)`, `withSystemTx(fn)` | `db/client.ts` | DB connection; user transactions run as `authenticated` with JWT claims (RLS); system transactions as owner. |
| `app`, `baseColumns()`, `softDelete()` | `db/pg-schema.ts` | Schema `app` and standard columns. `db/schema.ts` re-exports all module tables. |
| `getSessionUser`, `getAppSession`, `appSessionFor(user)`, `requireSession(perm?)`, `devUserIdByEmail`, `ORG_COOKIE` | `lib/auth.ts` | Current user and org context; redirect to /login. |
| `supabaseServer`, `supabaseConfigured` | `lib/supabase/server.ts` | Supabase client bound to request cookies. |
| `signDevSession`, `verifyDevSession`, `DEV_COOKIE` | `lib/dev-auth.ts` | Local-only dev sign-in (refused on Vercel/production). |
| `env()`, `appUrl()`, `isDevAuth()`, `resetEnvCache` | `lib/env.ts` | Validated environment (empty strings = unset). |
| `AppError`, `notFound`, `forbidden`, `publicMessage` | `lib/errors.ts` | Errors with codes; safe messages for users. |
| `runAction(fn, message?)` | `lib/actions.ts` | Server-action wrapper: AppError → `{ok:false, error, fieldErrors}`. |
| `errorResponse`, `checkCronSecret` | `lib/http.ts` | Route-handler errors; cron secret check. |
| `encryptJson`, `decryptJson`, `sha256`, `randomToken`, `safeEqual` | `lib/crypto.ts` | AES-256-GCM secrets, token hashing, constant-time compare. |
| `formatINR`, `formatAmount`, `formatNumber`, `formatPercent`, `formatDateTime`, `formatDate`, `formatRelative`, `todayIST`, `startOfTodayIST`, `addDays` | `lib/format.ts` | Indian formats, IST dates. |
| `toE164`, `formatPhone`, `phoneCountry`, `whatsappUrl`, `normalizeEmail` | `lib/phone.ts` | Phone/email normalisation, wa.me links. |
| `rateLimit`, `clientIp` | `lib/rate-limit.ts` | In-memory token bucket for public endpoints. |
| `cn` | `lib/utils.ts` | Tailwind class merge. |

---

## 7. Scripts, data and tests

| Path | What it is |
|---|---|
| `scripts/seed.ts` (`npm run db:seed`) → `src/server/seed.ts` (`seed()`) | Idempotent seed: org, owner (Supabase Auth or local), catalogue + rates from `seed/*.json`, templates, rules, integration rows. `parseOwnerEmail`, `maskEmail`, `ensureSupabaseUser`. |
| `scripts/db-migrate.ts` (`db:migrate`) / `scripts/db-remote-apply.ts` (`db:remote:apply`) | Apply `drizzle/` migrations over TCP / over the Supabase Management API (HTTPS). |
| `scripts/db-remote-seed.ts` (`db:remote:seed`) | Seed a Supabase project over HTTPS only. |
| `scripts/local-db.sh` + `scripts/local-db/supabase-shim.sql` (`db:local:up/down/reset`) | Local Postgres 16 on :54322 that mimics Supabase (`auth.uid()`, roles). |
| `scripts/demo-data.ts` (`demo:data`) | Loads fixture emails into a LOCAL db for demos/screenshots. |
| `scripts/fetch-website-products.ts` (`seed:website`) | Diff stdmfood.com catalogue vs `seed/products.json`. |
| `scripts/gen-keys.ts` (`gen:keys`) | Generate `APP_ENCRYPTION_KEY` and `CRON_SECRET`. |
| `drizzle/` | Migrations (0000 init, 0001 RLS + grants + triggers, 0002 storage bucket). Never edit an applied one. |
| `seed/products.json`, `seed/rates.json` | Catalogue and rates source data. |
| `fixtures/emails/*.json` | Anonymised real email formats with `expected` parse results. |
| `tests/human-paths.test.ts` | Every service as a signed-in role under RLS (catches permission bugs system-context tests miss). |
| `tests/rls.test.ts` | Org isolation and append-only rules at the database level. |
| `tests/sync-and-quotes.test.ts` | Gmail/TradeIndia sync, dedupe, quotes, review queue (Google faked in `tests/helpers/fake-google.ts`, which throws on any send). |
| `tests/mcp.test.ts` | MCP tools, tokens, OAuth flow. |
| `src/**/*.test.ts` | Unit tests next to the code (parsers, catalog, leads, lib). |
| `e2e/smoke.spec.ts` | Playwright: main flows on desktop 1440 and phone 390, sign-in messages, screenshots → `docs/screenshots/`. |
