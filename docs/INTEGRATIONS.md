# Integrations

One section per external service: what it is for, where the code is, how it authenticates, its limits, how errors are handled, its status, and what changes if it is replaced. No provider SDK or provider field name may appear outside its adapter (`AGENTS.md` section 4).

Agents never call these live accounts (`AGENTS.md` rule 13). Everything is developed against the fakes in `tests/helpers/`, and each section ends with the manual check the owner runs.

## Gmail

| | |
| --- | --- |
| **Purpose** | Read the sales mailbox (portal notifications, direct enquiries, buyer replies), read the mailbox signature, and create quotation drafts in the enquiry's thread. |
| **Code** | `src/modules/sources/gmail/client.ts` (HTTP), `src/modules/sources/gmail/service.ts` (connect, sync), `src/app/api/integrations/gmail/callback/route.ts` (OAuth redirect). Quotation drafts are built in `src/modules/quotes/`. |
| **Endpoints** | `https://gmail.googleapis.com/gmail/v1/users/me`: `/profile`, `/messages`, `/messages/{id}?format=full`, `/history`, `/settings/sendAs`, `/drafts` (POST). Tokens: `https://oauth2.googleapis.com/token`. Consent: `https://accounts.google.com/o/oauth2/v2/auth`. |
| **Auth** | OAuth 2 with PKCE. The company enters its own Google Cloud client ID and secret in Settings. Permissions: `gmail.readonly` and `gmail.compose`. The refresh token and client secret are stored encrypted in `integration_secrets`. |
| **Environment** | `APP_URL` (the redirect URI is `APP_URL/api/integrations/gmail/callback`), `APP_ENCRYPTION_KEY`. |
| **Limits handled** | 150 messages and 35 seconds per run; the rest waits in `cursor.backlog`. 429, 5xx and 403 rate-limit replies are retried with backoff. First sync reads 14 days ([ADR-017](decisions/ADR-017-gmail-first-sync-14-days.md)). |
| **Errors** | Revoked or expired access → status `reauth_required` and a banner. An expired history ID → date-based resync. A message deleted since listing is skipped. Repeated failures back off from 10 minutes up to 6 hours. |
| **Sending** | The client has no send method ([ADR-010](decisions/ADR-010-gmail-drafts-only.md)). The test fake throws on any send endpoint. This changes only when the outbound pipeline (GOAL G-OUT) is merged. |
| **Status** | Built and tested against a fake. **Not yet verified against a live mailbox.** |
| **If replaced** | Another mail provider needs a new client with the same methods and a sync function registered in `src/modules/sources/jobs.ts`. The email parsers and classification do not change. |

**Owner's check:** `docs/SETUP.md` section 5. For a Google Workspace mailbox, create the OAuth app as **Internal**. After connecting, click **Sync now** and look at Settings → Recent sync runs.

### Sending (outbound pipeline, ADR-032)

- `POST /gmail/v1/users/me/messages/send` with `{ raw, threadId? }`, called only from `src/modules/outbound/send.ts`, after a person approved the message or the pipeline approved it within its mode, window, caps and pause switch.
- The mailbox's own signature (`settings/sendAs`) is added to every email, and replies stay in the buyer's thread (`In-Reply-To`, `References`).
- No new scope: `gmail.compose` covers sending. Attachments up to about 3.5 MB per email; larger ones are refused with a message to send from Gmail.

## TradeIndia

| | |
| --- | --- |
| **Purpose** | Pull enquiries from TradeIndia's "My Inquiry API". TradeIndia also hosts the company website, so website enquiries arrive here too (GOAL G-SRC-3). |
| **Code** | `src/modules/sources/tradeindia/client.ts`, `normalize.ts`, `service.ts`. |
| **Endpoint** | `GET https://www.tradeindia.com/utils/my_inquiry.html` with `userid`, `profile_id`, `key`, `from_date`, `to_date` (`YYYY-MM-DD`), `limit`, `page_no`. |
| **Auth** | User ID, profile ID and key from the seller account, stored encrypted. |
| **Dates** | `from_date` and `to_date` are built as **IST calendar dates** (`tradeIndiaDay`). This is an assumption: TradeIndia is an Indian service and publishes no specification. A UTC date would end "yesterday" between 00:00 and 05:30 IST. |
| **Limits handled** | Unknown officially. Inquira uses 7-day windows, 50 rows a page and 1.5 seconds between calls ([ADR-012](decisions/ADR-012-tradeindia-sync-windows.md)). A run stops starting new requests after 35 seconds; the position is saved after every window in `integrations.cursor.resume`, so the first 30-day load continues across runs instead of restarting. |
| **Errors** | 429 → backoff. 401, 403 or a "key/invalid" message → `reauth_required`. Non-JSON → integration error. A lead that fails to save keeps the sync at that window: it is retried on the next two runs and skipped on the third, with the lead's ID in the sync run's error text. |
| **Status** | Built and tested against a fake. **Field names and limits are unverified until the first live call**; every field is read through alias lists and the raw payload is stored on the lead. |
| **If replaced** | A new source module with `client`, `normalize` and `sync…` following this one (see `docs/ARCHITECTURE.md`, "Add a lead source"). |

Details of what was probed and what is assumed: [`docs/TRADEINDIA_API.md`](TRADEINDIA_API.md).

**Owner's check:** `docs/SETUP.md` section 6. After **Test connection**, open a TradeIndia lead and compare its fields with the same enquiry on TradeIndia.

## IndiaMART (Lead Manager APIs)

| | |
| --- | --- |
| **Purpose** | Every IndiaMART lead in the inbox: direct enquiries (W), Buy Leads someone bought (B), phone calls (P), catalogue views (BIZ), WhatsApp enquiries (WA) (GOAL G-SRC-1, G-SRC-2, G-SRC-8). Notification emails stay as a cross-check (G-SRC-7). |
| **Code** | `src/modules/sources/indiamart/client.ts` (Pull), `normalize.ts` (fields), `service.ts` (key, push address, push receive, pull sync), `src/app/api/webhooks/indiamart/[secret]/route.ts` (Push). |
| **Push** (main route; enough on its own) | IndiaMART POSTs each lead as JSON to our https address the moment it arrives. Registered in IndiaMART's Lead Manager → ⋮ → Import/Export Leads → Push API → Other, confirmed by OTP. Needs a public https address, so it works for the cloud site only. The first pushed lead marks IndiaMART connected; no Pull key is needed. IndiaMART's Test button must see 200, so a request without a lead is acknowledged and recorded (`lastEmptyPushAt`, a failed push run). |
| **Pull** (optional: history and safety net) | `GET https://mapi.indiamart.com/wservce/crm/crmListing/v2/?glusr_crm_key=…&start_time=…&end_time=…`, times in IST as `DD-Mon-YYYYHH:MM:SS`. Reply: `CODE`, `STATUS`, `MESSAGE`, `TOTAL_RECORDS`, `RESPONSE`. |
| **Auth** | Pull: the CRM key (stored encrypted; it is part of the URL, so the URL is never logged). Push: the random secret at the end of our address (only its hash is stored); IndiaMART documents no signature. The "CRM Push key" IndiaMART shows or emails is not used: its pushes carry no key, and it is not the Pull key. |
| **Limits handled** | At most one Pull call per 5 minutes (enforced from `cursor.lastCallAt`, also for Test connection and Sync now); 7 days per call; the first load reads 30 days, one week per run; later runs overlap by 5 minutes; an unused key expires after 7 days (the 10-minute schedule keeps it alive). |
| **Errors** | 204 = no leads. 401 = key wrong or expired → status `reauth_required`. 429 = wait 15 minutes, not counted as a failure streak. Other codes → integration error with backoff. A lead that fails to save keeps its window for two more runs. |
| **De-duplication** | `UNIQUE_QUERY_ID` is the lead's `source_ref`; push and pull of the same lead are one record. The notification email of the same enquiry merges by buyer and product within 48 hours; the lead then carries the API id and keeps the email as an alternate. |
| **Source** | help.indiamart.com: "Integration of IndiaMART's Lead Manager CRM Push API with Third Party CRMs" and "…Pull API with Third Party CRMs", read 18 Nov 2026. Assumptions: `QUESTIONS.md` Q-019. |
| **Status** | Built and tested against a fake. **Not yet verified against the live account.** |
| **If replaced** | Another portal: a new folder under `src/modules/sources/` following this one. |

**Owner's check:** `docs/SETUP.md` section 6a.

## Supabase

| | |
| --- | --- |
| **Purpose** | Cloud mode's database (Postgres), sign-in (Auth), scheduler (`pg_cron` plus `pg_net`) and file storage (the private bucket `documents`). |
| **Code** | `src/db/client.ts` (database), `src/lib/supabase/server.ts` and `src/lib/auth.ts` (sign-in), `src/proxy.ts` (session refresh), `scripts/db-remote-apply.ts` and `scripts/db-remote-seed.ts` (Management API). |
| **Auth** | `DATABASE_URL` (transaction pooler, port 6543), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only: the seed, Settings → Members to create sign-in accounts through the Auth admin API, and document and backup files in Storage; never sent to a browser). `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` are only for the HTTPS migration scripts. |
| **Limits** | The built-in mailer sends only a few emails an hour, which matters for password-reset links. The free tier pauses inactive projects. |
| **Errors** | Sign-in failures are explained on the sign-in page (`docs/SETUP.md` section 4). |
| **Status** | In use: migrations 0000 to 0004 applied (0003 and 0004 on 17 Nov 2026) and the first company seeded. Agent sessions reach the Management API with a token the owner saved as a network secret for `api.supabase.com` (Database read and write, this project only); run the scripts with `NODE_USE_ENV_PROXY=1 SUPABASE_ACCESS_TOKEN=proxy-injected` (`docs/SETUP.md` section 11). |
| **Endpoints used at runtime** | Auth admin: `GET /auth/v1/admin/users`, `POST /auth/v1/admin/users` (`email_confirm: true`, no password). Storage: `POST`/`GET /storage/v1/object/documents/<key>` (`x-upsert: false`), `DELETE /storage/v1/object/documents` (cleanup after a failed save, and backups older than 14 days). Backups use keys `backups/<org>/<time>.json.gz` in the same bucket. |
| **If replaced** | Local mode (GOAL G-PLT-5) replaces all parts: its own Postgres, its own sign-in and a worker loop, files on disk. The seams are `src/db/client.ts`, `src/lib/auth.ts`, `src/lib/accounts.ts`, `src/modules/documents/storage.ts` and the tick endpoint. |

## Hosting (Vercel)

| | |
| --- | --- |
| **Purpose** | Runs the Next.js app in cloud mode. |
| **Config** | `vercel.json` (region `bom1`), environment variables in `docs/SETUP.md` section 2. |
| **Limits** | 60 seconds per function, so every background job has a time budget and a saved position. No always-on worker; the scheduler is the database cron calling `/api/cron/tick` ([ADR-007](decisions/ADR-007-jobs-and-one-cron-endpoint.md)). |
| **Build check** | A production build stops if the database is missing a migration, so new code never runs against an old schema ([ADR-026](decisions/ADR-026-build-stops-when-database-is-behind.md)). It reads `DATABASE_URL` at build time; `CHECK_MIGRATIONS=1` turns the same check on for another host. |
| **Status** | Deployed by the owner. Agents never deploy (`AGENTS.md` rule 12). |
| **If replaced** | Any Node host works. Local mode runs the same app in Docker (`docs/SELF_HOSTING.md`). |

## Claude connector (MCP)

Inquira is the server here, not the client. See [`docs/API.md`](API.md) for the endpoint and tools, and [ADR-013](decisions/ADR-013-mcp-authentication.md) for authentication.

## AI providers (Gemini, Anthropic, OpenAI-compatible)

Inquira calls these itself for the Basic and Advanced tiers (GOAL G-AI-1 to G-AI-10, [ADR-031](decisions/ADR-031-ai-tiers.md)). Code: `src/modules/ai/providers/`.

| | Gemini | Anthropic | OpenAI-compatible |
| --- | --- | --- | --- |
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `POST https://api.anthropic.com/v1/messages` | `POST {address}/chat/completions` |
| Key | header `x-goog-api-key` | header `x-api-key`, plus `anthropic-version: 2026-10-21` | header `Authorization: Bearer …` |
| JSON answer | `generationConfig.responseMimeType: application/json` + `responseJsonSchema` | `output_config.format: {type: "json_schema", schema}` | `response_format: {type: "json_object"}` (the schema is in the prompt) |
| Reply text | `candidates[0].content.parts[].text` | `content[]` blocks of type `text`; `stop_reason` `refusal` / `max_tokens` are errors | `choices[0].message.content` |
| Source | Google's Gemini API reference, checked 18 Nov 2026 | Anthropic's Messages API reference | the common chat-completions format |

- **Settings, not code:** provider, model name, address, confidence threshold (0.5–1, default 0.8), daily calls (default Basic 200, Advanced 50) and on/off per tier are on Settings → AI. No environment variables.
- **Keys:** encrypted in `integration_secrets` (integration rows `ai_basic`, `ai_advanced`), never returned to the browser, audit rows or errors; a provider error that repeats the key is scrubbed.
- **Errors:** 429 and 402 → rate limited; 401 and 403 → key refused; 408 and 5xx → unavailable; other 4xx → bad request (often a wrong model name); no answer within 15 s → network. Any of these makes the tier wait (10 min, doubling to 6 h) and the item goes to the next step at once. A refusal or a cut-off answer affects only that item.
- **Limits:** Inquira counts calls per tier per IST day and stops at the company's limit, whatever the provider allows. Providers' own free-tier limits change; set the daily limit at or below them.
- **Privacy:** Basic gets redacted text only (no email, phone, link, buyer name, company, city), so a free key is acceptable. Advanced reads review emails in full: use a paid key whose terms keep data private.
- **Replace or add a provider:** one adapter file in `src/modules/ai/providers/` implementing `AiProvider`, one line in `providers/index.ts`, and its id in `AI_PROVIDERS` (`ai/types.ts`). A model that runs on the same computer (local mode) can be used through the OpenAI-compatible adapter with an `http://localhost` address.
- **Checked live by:** the owner, with Settings → AI → Test connection (one call with fixed text, no company or buyer data).

## Planned

| Service | Requirement | Milestone |
| --- | --- | --- |
| Gmail sending | GOAL G-OUT-6 | M7 |
| WhatsApp Cloud API | GOAL G-OUT-8 | Later, after the owner approves the cost |
