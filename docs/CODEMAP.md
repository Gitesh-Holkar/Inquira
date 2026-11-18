# Code map

Every file, exported function, page, route and background job in Inquira, and what it is for. Read this before searching the code; it tells you where a change belongs.

**Keep it current:** when you add, rename, move or delete a function, file, route, page or job, update this file in the same commit (`AGENTS.md` section 7).

How a request flows: **page or server action** (`src/app`) → **service** (`src/modules/<m>/service.ts`, built with `defineService`) → **database** (Drizzle, schema `app`, RLS). The MCP tools (Claude) and cron jobs call the same services. UI code never touches the database directly (ESLint enforces this).

---

## 1. "I want to change…" → where

| I want to… | Change this | Notes |
|---|---|---|
| Change who may do what | `src/modules/core/permissions.ts` (roles, `ABILITIES`, `BASE_PERMISSIONS`); the same role defaults in SQL (`app.role_default`, a new migration) | Roles owner, admin, sales, QA, accounts, viewer; abilities switched per member on Settings → Members → Access; the narrow MCP set. `tests/roles.test.ts` checks code and SQL agree |
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
| Change how a price list is read or imported | Reading, matching and the diff: `catalog/price-list.ts` (pure). Writing: `catalog/price-list-service.ts`. Screen: `(app)/rates/import/page.tsx` + `components/rates/price-list-import.tsx`. Command: `scripts/rates-import.ts` | A company's own reading of its list is data: `seed/<company>/price-list-map.json`, saved in `org_settings.price_list_map` ([ADR-025](decisions/ADR-025-price-list-import.md)) |
| Change the terms printed on a quotation | MOQ, pack size, GST and price basis come from the rate (`price_entries`); payment terms from `org_settings.payment_terms` (Settings → Organisation). Item wording: `DEFAULT_ITEM_BLOCK` in `templates/engine.ts` | An empty value drops its line; nothing is invented |
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
| `permissionsFor`, `abilitiesFor`, `overridesFor`, `withRequirements` | `core/permissions.ts` | A member's effective permissions (role defaults + `granted` − `revoked`; owners always everything), the abilities that are on, and the overrides that give a role a chosen set of abilities. |
| `can(ctx, perm)` / `authorize(ctx, perm)` | `core/permissions.ts` | Permission check (boolean / throws FORBIDDEN), including the member's custom access. `PERMISSIONS`, `ROLE_PERMISSIONS`, `MCP_PERMISSIONS` define the sets. |
| `actorString(actor)` | `core/types.ts` | Actor → `human:<uuid>` / `mcp:<name>` / `system:<job>`. Types `Ctx`, `Actor`, `Role`. |

### `core/service.ts` (orgs, integrations, sync runs, jobs, audit reads)
| Function | What it does |
|---|---|
| `membershipsForUserInternal(tx, userId)` | A user's organisations and roles (used by sign-in). |
| `getOrgSettingsInternal` / `getOrgSettings` / `updateOrgSettings` | Organisation settings (quote validity days, default price basis, payment terms). |
| `setPriceListMapInternal` | Saves the company's price list mapping (validated by the catalog module) and audits that it changed. |
| `getIntegrationInternal(tx, orgId, provider)` | The Gmail/TradeIndia integration row; creates it (audited) if missing. |
| `readSecretsInternal` / `writeSecretsInternal` | Decrypt/encrypt integration secrets (AES-256-GCM). Server-only; audit logs field names, never values. Need a system transaction. |
| `updateIntegrationInternal` | Update integration state (status, cursor, errors), optionally audited. |
| `recordIntegrationSuccess` / `recordIntegrationFailure` / `backoffDelayMs` | Health bookkeeping and exponential backoff (10 min → 6 h). |
| `listIntegrations` | Integration status for banners and Settings (no secrets). |
| `startSyncRunInternal` / `finishSyncRunInternal` / `listSyncRuns` | "Recent sync runs" log. |
| `enqueueJobInternal` / `claimJobsInternal` / `completeJobInternal` / `failJobInternal` | Job queue (dedupe keys, SKIP LOCKED claiming, retries with backoff). |
| `listAudit` | Audit rows for an entity (lead page "Audit trail"). |
| `listOrgIdsInternal` | All organisations (cron schedules syncs for each). |

### `core/members.ts` (Settings → Members, GOAL G-PLT-2)
| Function | What it does |
|---|---|
| `listMembers` | Active members with role and date added. |
| `inviteMember(ctx, {email, role}, deps?)` | Finds or creates the sign-in account (`lib/accounts.ts`, outside any transaction), then adds the membership, or restores a removed one with the new role. |
| `setMemberAccess(ctx, {memberId, abilities})` | Switches abilities on or off for one member on top of their role. Only abilities the editor has; not for owners or yourself; adds required abilities (for example "See settings"). Audited as `member.access`. |
| `changeMemberRole`, `removeMember` | Owners and admins manage members; only an owner touches owners and admins; nobody changes or removes themselves; the last owner stays. Removal is a soft delete. A role change resets custom access. |

### documents (`documents/service.ts`, `storage.ts`, `types.ts`) — document library (GOAL G-KB-4)
| Function | What it does |
|---|---|
| `uploadDocument(ctx, input, deps?)` | Checks the file (type by content, up to 4 MB, dates, live product), stores it, then saves its row; a failed save removes the file. |
| `listDocuments`, `removeDocument` | List with product name and validity; soft delete. |
| `getDocumentFile` | The file for the download route. |
| `latestValidDocumentsInternal(tx, orgId, productId, types?, today?)` | One document per type: newest issue date, never expired, the product's own before a company-wide one. Used for quotation attachments. |
| `documentsForProduct` | What the lead page offers to attach. |
| `documentFilesInternal` | Reads the files of chosen documents (network; outside transactions). |
| `storage.ts`: `fileStore`, `fileStoreKind`, `diskStore`, `supabaseStore` | File storage adapter: Supabase bucket `documents` (service role key) or a folder (`FILE_STORAGE_DIR`). Keys `<org>/<document>.<ext>`; never overwrites. |
| `types.ts`: `DOCUMENT_TYPES`, `validity`, `looksLike`, `safeFileName`, `MAX_DOCUMENT_BYTES` | Types, expiry status, content check, safe names, limits. |

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
| `updateRates` / `insertRatesInternal` | Append new price rows (never overwrite); refuses back-dated `valid_from`. The internal form is shared with the price list import. |
| `listProducts`, `createProduct` / `createProductInternal` | Products and grades. A duplicate name is refused with a plain message. |
| `removeProduct` / `restoreProduct` / `listRemovedProducts` | Take a discontinued product out of the catalogue (rates screen, quotations, lead matching, Buy Lead terms) and bring it back. Nothing is deleted: grades, rates and history stay. |
| `productInfoById`, `removedProductNamesInternal` | Name and removed state of a product; names of removed products (so a new product or a price list line with that name is explained). |
| `updateProduct` | Corrects a product: name, category, other names (aliases), grade names, extra grades. Grades are renamed or added, never removed; rates and their history are untouched. |
| `matchProduct`, `normalizeProductText`, `productMatcherCatalog` | Free text ("soy isolate protein") → catalogue product. |
| `productNameById`, `countProducts` | Small lookups. |
| `types.ts`: `updateRatesInput`, `rateUpdateItem`, `moneyString`, `percentString`, `CurrentRate` | Rate input validation. |
| `price-list.ts`: `parsePriceList` | Price list text → lines (heading, name, price, qualifier, raw line), the GST section, and the lines it could not read. Never drops or guesses a line. |
| `price-list.ts`: `planImport`, `priceListMapSchema`, `normalizeListName` | Matches each line to a product and grade (the company's mapping first, then catalogue names and aliases) and works out what would change. Pure. GST, pack size and MOQ come only from the mapping, the current rate or the product; a line with no known GST rate is not written. |
| `price-list.ts`: `planSections`, `planCounts`, `describePlan` | The diff as headed lists; the screen and the command show the same thing. |
| `price-list-service.ts`: `planPriceListImport` | Read-only: the diff for a pasted list (`catalog.read`). |
| `price-list-service.ts`: `applyPriceListImport` | Writes the diff in one transaction (`rates.write` and `catalog.write`): new products and grades, renamed grades, aliases, new rate rows; all audited. |
| `price-list-service.ts`: `savePriceListMap`, `catalogForImportInternal` | Save the company's mapping; the catalogue in the shape the planner needs. |

### quotes (`quotes/service.ts`, `quotes/mime.ts`)
| Function | What it does |
|---|---|
| `createQuoteDraft(ctx, {leadId, gradeIds?, attach?, ...})` | Render the template with current rates, snapshot prices, create a **Gmail draft** in the inquiry thread with the real signature. Never sends. Used by the UI button and the MCP tool. |
| `renderQuote(lead, items, template, validity, orgName)` | Pure rendering of subject/body. |
| `listQuotationsForLead` | Quotations on the lead page. |
| `whatsappForLead` | Prefilled WhatsApp text + wa.me link. |
| `mime.ts`: `buildMime`, `bodyToHtml`, `formatAddress`, `escapeHtml` | RFC 2822 message for Gmail drafts (header-injection safe); `attachments` adds files (multipart/mixed). |
| `attach` on `createQuoteDraft` | Document types to attach: the latest valid file of each for the lead's product; missing or expired types are reported in the warning, never attached. Drafts over 3.5 MB go through Gmail's upload endpoint (`GmailClient.createDraft`). |

### templates (`templates/service.ts`, `templates/engine.ts`)
| `render(template, vars)`, `unknownPlaceholders`, `PLACEHOLDERS`, `DEFAULT_*` | Safe `{{placeholder}}` renderer and default texts (engine.ts). |
|---|---|
| `listTemplates`, `saveTemplate`, `getTemplateInternal`, `getDefaultTemplateInternal`, `ensureDefaultTemplatesInternal`, `SAMPLE_VARS` | Template storage, defaults, and preview sample values. |

### buyleads (`buyleads/service.ts`) — IndiaMART Buy Lead suggestions (a person buys; ADR-020)
| Function | What it does |
|---|---|
| `getBuyleadRules` / `getRulesInternal`, `updateBuyleadRules`, `rulesInput` | Rules shown in Settings (products + terms, exclusions, states, quantity range, suggestions per day). |
| `getBuyleadRulesCompact` | Token-light rules for an assistant (MCP `get_buylead_rules`), incl. `remaining_today` suggestions. |
| `logBuyleadDecision` | Logs each Buy Lead an assistant looked at: `would_contact` (suggested) or `skipped`; flags suggestions over the daily limit. Cannot record a purchase. |
| `getBuyleadSummary`, `listBuyleadDecisions`, `todayDecisionCountsInternal` | IndiaMART page and dashboard card. |
| `seedRulesFromCatalogInternal` | First-time match terms from the catalogue. |
| `dropProductTermsInternal`, `addProductTermsInternal` | Remove or add one product's match terms when it is removed from or restored to the catalogue. |

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
| `tick(opts)` | `sources/jobs.ts` | Cron entry: enqueue Gmail + TradeIndia syncs for every org, then run due jobs one at a time (stops starting jobs after 20 s). When a handler returns `{ more: true }`, a follow-up job is queued after the job completes and runs on the next tick. |
| `JOB_HANDLERS` | `sources/jobs.ts` | Job type → function. Register new background work here. |
| `syncGmail(ctx, opts)` | `gmail/service.ts` | Incremental Gmail sync (history id; date resync fallback; backlog; skips stored ids; 35 s budget). |
| `saveGmailClient`, `startGmailConnect`, `completeGmailConnect` / `completeConnectInternal`, `disconnectGmail` | `gmail/service.ts` | Settings → Gmail: save OAuth client, consent URL (PKCE + hashed state), finish OAuth, disconnect. |
| `gmailClientFor(ctx)`, `gmailRedirectUri()`, `toIngestMessage`, `orgIdFromState` | `gmail/service.ts` | Ready API client; redirect URI from APP_URL; Gmail message → ingest shape. |
| `GmailClient` (`getProfile`, `listMessages`, `listHistory`, `getMessage`, `listSendAs`, `createDraft`), `exchangeCode`, `GMAIL_SCOPES` | `gmail/client.ts` | Minimal Gmail REST client: **no send method**. Retries 429/5xx/403-rate-limit. |
| `GmailReauthRequired`, `GmailHistoryExpired`, `GmailMessageGone` | `gmail/client.ts` | Error types the sync reacts to. |
| `header`, `extractBodies`, `parseAddressList`, `parseFrom`, `gmailDraftUrl`, `gmailThreadUrl` | `gmail/client.ts` | MIME helpers and Gmail web links. |
| `saveTradeIndiaCredentials`, `testTradeIndiaConnection` / `testConnectionInternal`, `syncTradeIndia` | `tradeindia/service.ts` | Settings → TradeIndia and the 10-minute sync (30-day first load, 2-day overlap). Resumable: 35 s budget, position saved per 7-day window in `TradeIndiaCursor`, a window with failed leads is not passed until three attempts. |
| `TradeIndiaClient` (`page`, `url`), `inquiryWindows`, `tradeIndiaDay`, `TradeIndiaAuthError`, `TradeIndiaRateLimited` | `tradeindia/client.ts` | TradeIndia My Inquiry API client. Dates are IST calendar dates; ranges are split into 7-day windows. |
| `normalizeTradeIndia`, `tradeIndiaDate` | `tradeindia/normalize.ts` | API row → `NormalizedLead`. |
| `emptyStats`, `SyncStats`, `LeadSourceAdapter` | `sources/types.ts` | Shared sync types. |

---

## 4. Pages and server actions (`src/app`)

Server actions only call services (`requireSession(permission)` → `runAction(() => service(ctx, input))` → `revalidatePath`).

| Route | Page file | Actions file / components |
|---|---|---|
| `/` Dashboard | `(app)/page.tsx` | — |
| `/leads` Inbox (+ International tab) | `(app)/leads/page.tsx` | `components/leads/inbox-list.tsx` (keyboard j/k/e/w/q/?), `new-lead.tsx` |
| `/leads/[id]` Lead detail | `(app)/leads/[id]/page.tsx` | `(app)/leads/actions.ts`: `setStatusAction`, `addNoteAction`, `quoteAction`, `whatsappTextAction`, `updateLeadAction`, `createLeadAction`, `deleteLeadAction` (owners and admins; `DeleteLeadButton` in `detail-client.tsx`); components `leads/actions.tsx` (Copy/Call/WhatsApp/Quote buttons), `leads/detail-client.tsx` (status, notes, edit) |
| `/review` Review queue | `(app)/review/page.tsx` | `(app)/review/actions.ts`: `classifyAction`; `components/review/review-item.tsx` |
| `/rates` Rates | `(app)/rates/page.tsx` | `(app)/rates/actions.ts`: `saveRatesAction`, `rateHistoryAction`, `addProductAction`, `updateProductAction`, `removeProductAction`, `restoreProductAction`; `components/rates/rates-editor.tsx`, `add-product.tsx`, `edit-product.tsx` (incl. Remove), `removed-products.tsx` (Restore) |
| `/rates/import` Import price list | `(app)/rates/import/page.tsx` | `(app)/rates/actions.ts`: `planPriceListAction` (reads only), `applyPriceListAction`, `savePriceListMapAction`; `components/rates/price-list-import.tsx` (list, folded mapping editor, preview) |
| `/templates` | `(app)/templates/page.tsx` | `(app)/templates/actions.ts`: `saveTemplateAction`; `components/templates/editor.tsx` |
| `/documents` Documents | `(app)/documents/page.tsx` | `(app)/documents/actions.ts`: `uploadDocumentAction` (form with the file), `removeDocumentAction`; `components/documents/upload-form.tsx`, `remove-document.tsx`. Filters by product and type (URL). |
| `/indiamart` Buy-lead log | `(app)/indiamart/page.tsx` | — |
| `/settings?tab=…` | `(app)/settings/page.tsx` | `(app)/settings/actions.ts`: TradeIndia save/test, Sync now, Gmail save/connect/disconnect, MCP tokens, email rules, buy-lead rules, org settings, members (`inviteMemberAction`, `changeMemberRoleAction`, `removeMemberAction`, `setMemberAccessAction`; `components/settings/members.tsx`); components in `components/settings/*` |
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
| `GET /api/documents/[id]` | `api/documents/[id]/route.ts` | Downloads a document. Checks the session itself (signed out → `/login`, no permission → 403, other company → 404); always a download with `nosniff`. |
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
| `shell/nav.tsx`, `shell/nav-access.ts`, `shell/theme-toggle.tsx` | `Sidebar`, `BottomNav`, `NAV_ITEMS`, `PAGE_PERMISSION`, `ThemeToggle` | Navigation (only pages the person may open; on phones up to five) and light/dark |
| `auth/hash-session.tsx` | `HashSessionHandler` | Session/error from `#access_token` / `#error` email links |

---

## 6. Shared libraries (`src/lib`, `src/db`)

| Function | File | What it does |
|---|---|---|
| `getDb`, `closeDb`, `withUserTx(userId, fn)`, `withSystemTx(fn)` | `db/client.ts` | DB connection; user transactions run as `authenticated` with JWT claims (RLS); system transactions as owner. |
| `app`, `baseColumns()`, `softDelete()` | `db/pg-schema.ts` | Schema `app` and standard columns. `db/schema.ts` re-exports all module tables. |
| `getSessionUser`, `getAppSession`, `appSessionFor(user)`, `requireSession(perm?)`, `devUserIdByEmail`, `ORG_COOKIE` | `lib/auth.ts` | Current user and org context; redirect to /login. |
| `supabaseServer`, `supabaseConfigured` | `lib/supabase/server.ts` | Supabase client bound to request cookies. |
| `accountDirectory`, `accountKind`, `findOrCreateSupabaseUser` | `lib/accounts.ts` | Sign-in accounts adapter: finds or creates the account for an email (Supabase Auth admin API, or the local table in development). Never sets a password. |
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
| `scripts/seed.ts` (`npm run db:seed`) → `src/server/seed.ts` (`seed()`) | Idempotent seed from one folder (`SEED_DIR`, default `seed/stdm`): org and quotation terms (`settings.json`), owner (Supabase Auth or local), catalogue (`products.json`), price list mapping, rates from the newest file in `price-lists/` through the same import as the Rates screen, templates, rules, integration rows. `parseOwnerEmail`, `maskEmail`, `ensureSupabaseUser`. |
| `scripts/db-migrate.ts` (`db:migrate`) / `scripts/db-remote-apply.ts` (`db:remote:apply`) | Apply `drizzle/` migrations over TCP / over the Supabase Management API (HTTPS). |
| `scripts/db-manual-sql.ts` (`db:manual-sql`) | Prints paste-ready SQL (statements plus the bookkeeping row) for named migrations, for the database's SQL editor. |
| `next.config.ts`: `assertDatabaseIsMigrated` | Stops a hosted production build when the database is missing a migration, so the running site is never replaced by code its database cannot serve (ADR-026). Read-only. |
| `scripts/db-remote-seed.ts` (`db:remote:seed`) | Seed a Supabase project over HTTPS only. |
| `scripts/local-db.sh` + `scripts/local-db/supabase-shim.sql` (`db:local:up/down/reset`) | Local Postgres 16 on :54322 that mimics Supabase (`auth.uid()`, roles). |
| `scripts/demo-data.ts` (`demo:data`) | Loads fixture emails into a LOCAL db for demos/screenshots. |
| `scripts/rates-import.ts` (`rates:import`) | Prints what a price list file would change; writes only with `--confirm`. `--map` uses another mapping, `--save-map` keeps it, `--org` picks the company. |
| `scripts/fetch-website-products.ts` (`seed:website`) | Diff the company website's catalogue vs `SEED_DIR/products.json`. |
| `scripts/gen-keys.ts` (`gen:keys`) | Generate `APP_ENCRYPTION_KEY` and `CRON_SECRET`. |
| `drizzle/` | Migrations (0000 init, 0001 RLS + grants + triggers, 0002 storage bucket, 0003 payment terms, 0004 price list mapping, 0005 documents, 0006 documents RLS, 0007 roles and custom access, 0008 permission-based access rules). Never edit an applied one. |
| `seed/stdm/` | The first company's data: `settings.json` (name, payment terms, price basis), `products.json` (catalogue, aliases, website links), `price-lists/<date>.txt` (the list as received, one item per line), `price-list-map.json` (headings → GST and pack size, list names → product and grade, MOQ and price basis). |
| `fixtures/emails/*.json` | Anonymised real email formats with `expected` parse results. |
| `tests/sign-in.test.ts` | Sign-in is always on (GOAL G-PLT-1): fails if an unauthenticated request reaches a page, a server action, the OAuth consent action or a protected API route, in any environment. |
| `tests/human-paths.test.ts` | Every service as a signed-in role under RLS (catches permission bugs system-context tests miss). |
| `tests/rls.test.ts` | Org isolation and append-only rules at the database level. |
| `tests/sync-resume.test.ts` | TradeIndia sync resumes after a time-budget stop or a killed run, uses IST dates, and does not pass a window with failed leads; a Gmail backlog is picked up on the next tick. |
| `tests/price-list-import.test.ts` | Price list import as owner under RLS (rates appended, history kept, renames, aliases, audit), refused for sales and viewers; every folder in `seed/` loads and its own list then shows nothing left to change. |
| `tests/roles.test.ts` | Roles and abilities are consistent; SQL role defaults equal the code's; switching an ability on or off changes what a member can do in the app and under RLS; who may change whose access. |
| `tests/members.test.ts` | Members as signed-in roles under RLS: add, restore, roles, last owner, other company; Supabase accounts fake. |
| `tests/documents.test.ts` | Documents: upload rules, who may do what, latest valid, attachments on quote drafts (expired never), both storage adapters. |
| `tests/sync-and-quotes.test.ts` | Gmail/TradeIndia sync, dedupe, quotes, review queue (Google faked in `tests/helpers/fake-google.ts`, which throws on any send). |
| `tests/mcp.test.ts` | MCP tools, tokens, OAuth flow. |
| `src/**/*.test.ts` | Unit tests next to the code (parsers, catalog, leads, lib). |
| `e2e/smoke.spec.ts` | Playwright: main flows on desktop 1440 and phone 390, sign-in messages, screenshots → `docs/screenshots/`. |
