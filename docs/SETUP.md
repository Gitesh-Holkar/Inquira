# Inquira setup guide

Written for a non-developer. Follow the sections in order; each has a **✅ Check** step. Allow about 45–60 minutes in total.

| § | What | Time |
|---|---|---|
| 1 | Supabase (database and login) — mostly done already | 5 min |
| 2 | Environment variables | 5 min |
| 3 | Deploy to Vercel | 10 min |
| 4 | Your first sign-in | 3 min |
| 5 | Google Cloud OAuth client + Connect Gmail | 15 min |
| 6 | TradeIndia API credentials | 5 min |
| 7 | Connect Claude (MCP) | 5 min |
| 8 | Schedule the 10-minute sync (pg_cron) | 5 min |
| 9 | Run on your own computer (optional) | 10 min |
| 10 | Troubleshooting | — |

---

## 1. Supabase

The project `inquira` (region **Mumbai / ap-south-1**) was created on 29 Sep 2026. The overnight build applied the database migrations and seeded:
- your organisation
- your owner login (`SEED_OWNER_EMAIL`)
- 66 products and 70 rates
- default templates and IndiaMART rules

To redo this yourself, see §9 (`npm run db:migrate` then `npm run db:seed`).

**Set the login URLs** (after §3, once you know your app URL):
1. Open Supabase → **Authentication → URL Configuration**.
2. Set **Site URL** to your app URL, e.g. `https://inquira-xyz.vercel.app`.
3. Under **Redirect URLs**, add both of these:
   - `https://inquira-xyz.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback`
4. Click **Save**.

**Keep the data private:**
1. Open **Project Settings → Data API → Exposed schemas**.
2. Leave it as the default `public, graphql_public`.
3. **Do not add `app`.** Inquira's data lives in the private `app` schema on purpose (docs/DECISIONS.md ADR-004).

✅ **Check:**
1. Open **Table Editor**.
2. Pick schema `app` from the dropdown.
3. `organizations` should have 1 row, `products` 66 rows and `price_entries` 70 rows.

## 2. Environment variables

These are the settings the app needs. Put them in Vercel (§3) and, for local use, in `.env.local` (never commit that file).

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API Keys (Project URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page, the **anon / publishable** key |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, the **service_role / secret** key (keep it secret) |
| `DATABASE_URL` | Supabase → **Connect** → **Transaction pooler** URI (port **6543**), with your DB password filled in |
| `APP_URL` | Your app address with no trailing slash, e.g. `https://inquira-xyz.vercel.app` |
| `APP_ENCRYPTION_KEY` | Run `npm run gen:keys` (or see below) — encrypts stored Gmail/TradeIndia credentials. **If you lose it, you must re-enter those credentials.** |
| `CRON_SECRET` | Also printed by `npm run gen:keys`. It protects the sync endpoint. |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | Only needed for the `db:remote:*` scripts (not on Vercel). |

To make the two secrets without installing anything, use the Vercel UI's **Generate** button if you see one. Otherwise open https://generate-secret.vercel.app/32 twice:
- use the first value for `APP_ENCRYPTION_KEY`
- use the second for `CRON_SECRET`

`APP_ENCRYPTION_KEY` must be 32 bytes in base64. The `npm run gen:keys` output is always correct.

## 3. Deploy to Vercel

1. Go to https://vercel.com/new → **Import Git Repository** → pick `Gitesh-Holkar/Inquira`.
2. If you are deploying before the branch is merged, set **Production Branch** to `claude/adoring-franklin-51jsvk`. Otherwise merge the pull request first and deploy `main`.
3. Framework: **Next.js** (auto-detected). Leave the build settings as they are.
4. **Environment Variables:** add everything from §2 except `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`. For `APP_URL`, enter a guess such as `https://inquira.vercel.app` for now.
5. Click **Deploy**. When it finishes, copy the real URL.
6. Go to Settings → Environment Variables, fix `APP_URL` if it was different, then **Redeploy**.
7. Do the "Set the login URLs" step in §1.

`vercel.json` pins the server functions to **Mumbai (`bom1`)**, next to the database.

✅ **Check:**
1. Open `https://YOUR-APP/login` and the sign-in page appears.
2. Open `https://YOUR-APP/.well-known/oauth-protected-resource` and it shows JSON ending with `/api/mcp`.

## 4. Your first sign-in

The owner account (`SEED_OWNER_EMAIL`) already exists but has no password yet.

1. Open `https://YOUR-APP/login` → **Forgot password? / First time here?**
2. Enter your email → **Email me a link**.
3. Open the email from Supabase and click the link. Use the **same browser** you asked from; for security the link is tied to that browser.
4. Choose a password (at least 10 characters).
5. You land on the dashboard.

If no email arrives:
1. In Supabase, open **Authentication → Users**.
2. Find your email → **⋯** → **Send password recovery**.

That link works in any browser. Supabase's built-in mailer sends only a few emails per hour.

**Adding teammates later:**
1. Supabase → Authentication → **Invite user**. They set a password the same way.
2. In the SQL editor, add them to the organisation with one of these roles: `owner`, `admin`, `sales` or `viewer`.
   ```sql
   insert into app.memberships (org_id, user_id, email, role, created_by)
   select o.id, u.id, u.email, 'sales', 'human:setup'
   from app.organizations o, auth.users u
   where u.email = 'teammate@example.com';
   ```
   A members screen is on the roadmap.

## 5. Connect Gmail

Gmail is connected with Google OAuth, not a password. First you create your own Google "OAuth client" (free), then you click **Connect Gmail** in Inquira.

### 5a. Create the Google Cloud project and client

1. Open https://console.cloud.google.com, sign in with the Google account that owns **sales@…**, and create a project named `Inquira` (top bar → project picker → **New project**).
2. **Enable the Gmail API:** search "Gmail API" in the top search bar → **Enable**.
3. Open **Google Auth Platform** (search "OAuth consent screen"), click **Get started** and fill in:
   - App name `Inquira`, your support email, your contact email.
   - **Audience:** choose one:
     - **Google Workspace account** (you log in to Gmail with a company domain managed in Google Admin): choose **Internal**. There are no warnings and no expiry. Done.
     - **Plain @gmail.com, or Google Workspace where you can't pick Internal:** choose **External**.
4. If you chose **External**:
   - Open **Audience** and click **Publish app**, so the status reads **In production**. **Don't leave it in "Testing":** in Testing mode Google expires the login after 7 days and Inquira would ask you to reconnect every week.
   - You don't need Google verification for your own mailbox. Google shows an "unverified app" warning during connect, which is expected.
5. **Data Access → Add or remove scopes.** Add exactly these two:
   - `https://www.googleapis.com/auth/gmail.readonly` — read mail and your signature
   - `https://www.googleapis.com/auth/gmail.compose` — create drafts

   Inquira never sends email (see DECISIONS ADR-010).
6. **Clients → Create client:**
   - Application type **Web application**, name `Inquira`.
   - **Authorised redirect URIs:** add both of these:
     - `https://YOUR-APP/api/integrations/gmail/callback`
     - `http://localhost:3000/api/integrations/gmail/callback` (only if you'll run it locally)
   - Click **Create**, then copy the **Client ID** and **Client secret**.

### 5b. Connect

1. In Inquira, go to **Settings → Integrations → Gmail**.
2. Paste the Client ID and secret → **Save OAuth client**.
3. Click **Connect Gmail** and choose the sales mailbox.
   - For an External app you'll see "Google hasn't verified this app": click **Advanced → Go to Inquira (unsafe)**. It's your own app.
4. **Tick both permission boxes** → **Continue**.
5. You return to Settings with "Gmail connected".
6. Click **Sync now**, or wait up to 10 minutes after §8. The first sync reads the last 14 days.

✅ **Check:**
- The dashboard shows "X received today, Y classified".
- **Leads** fills with IndiaMART and TradeIndia inquiries.

If you ever see the red **Reconnect Gmail** banner (password changed, access removed, or token expired), click it and repeat step 3.

## 6. Connect TradeIndia

1. Sign in to TradeIndia → **My Profile** → **Inquiries and Contacts** → **My Inquiry API**.
2. Copy the **User ID**, **Profile ID** and **Key**.
3. In Inquira, go to **Settings → Integrations → TradeIndia**, paste the three values → **Save credentials** → **Test connection**.
4. When the test succeeds, Inquira backfills the last 30 days, then syncs every 10 minutes (§8).

✅ **Check:**
- **Recent sync runs** shows a TradeIndia `backfill` row with `ok`.
- Inquiries that arrived both by API and by email show once, with "Also received via: tradeindia api (source ref)".

Not everything about TradeIndia's API is documented publicly (limits, some field names). See [TRADEINDIA_API.md](TRADEINDIA_API.md). If the test fails, the exact error appears on the card.

## 7. Connect Claude (MCP server)

Inquira has a built-in MCP server at `https://YOUR-APP/api/mcp`.

**claude.ai (web, desktop, mobile, Cowork):**
1. In claude.ai, go to **Settings → Connectors → Add custom connector**.
2. Name `Inquira`, URL `https://YOUR-APP/api/mcp` → **Add**.
3. Click **Connect**. Claude opens Inquira's sign-in and consent page.
4. Sign in as an owner or admin → **Allow**.

This uses OAuth (DCR + PKCE). You can revoke it any time in **Settings → Claude / MCP**.

**Claude Code / MCP Inspector (bearer token):**
1. Go to **Settings → Claude / MCP** → name a token → **Create token**. Copy it now; it's shown once.
2. For Claude Code:
   ```bash
   claude mcp add --transport http inquira https://YOUR-APP/api/mcp --header "Authorization: Bearer inq_mcp_…"
   ```
3. For the MCP Inspector:
   1. Run `npx @modelcontextprotocol/inspector`.
   2. Choose Transport **Streamable HTTP**, URL `https://YOUR-APP/api/mcp` (or `http://localhost:3000/api/mcp`).
   3. Under **Authentication**, set a Bearer token → **Connect** → **Tools → List tools**.
   4. You should see 12 tools.

Tools include `list_leads_needing_action`, `get_lead`, `update_lead_status`, `add_lead_note`, `list_emails_needing_review`, `submit_email_classification`, `get_current_rates`, `create_quote_draft`, `get_classification_rules` and the three buy-lead tools. See [ARCHITECTURE.md](ARCHITECTURE.md#mcp-tool-catalogue).

For the daily IndiaMART task in Claude Cowork, see [COWORK_INDIAMART_TASK.md](COWORK_INDIAMART_TASK.md).

## 8. Schedule the 10-minute sync

Supabase calls Inquira's sync endpoint every 10 minutes. Supabase → **SQL Editor** → **New query**, paste this, **replace the two placeholders**, then click **Run**:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the secret once (same value as CRON_SECRET in Vercel).
select vault.create_secret('PASTE-YOUR-CRON_SECRET', 'inquira_cron_secret');

select cron.schedule(
  'inquira-tick',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP/api/cron/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'inquira_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

✅ **Check (after 10–20 minutes):**
```sql
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select status_code, left(content, 200), created from net._http_response order by created desc limit 5;
```
Look for `status_code` **200**. A **401** means the secret doesn't match `CRON_SECRET`.

**To change the URL or pause it:**
- `select cron.unschedule('inquira-tick');` then run the `cron.schedule(...)` again.
- To update the secret: `select vault.update_secret((select id from vault.secrets where name='inquira_cron_secret'), 'NEW-SECRET');`

## 9. Run on your own computer (optional)

You need Node.js 22+.

```bash
git clone https://github.com/Gitesh-Holkar/Inquira && cd Inquira
npm ci
cp .env.example .env.local   # fill in values from §2, APP_URL=http://localhost:3000
npm run db:migrate           # applies new migrations to Supabase (safe to re-run)
npm run db:seed              # only for a brand-new project (idempotent)
npm run dev                  # http://localhost:3000
```

**Without Supabase (a fully local database, for trying things out):**
You need PostgreSQL 16 installed.

```bash
npm run db:local:up          # starts Postgres on port 54322
# in .env.local: DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres and AUTH_MODE=dev
npm run db:migrate && SEED_LOCAL_AUTH=1 npm run db:seed && npm run demo:data
npm run dev                  # sign in as owner@example.com (dev sign-in button)
```

**Quality checks:**
- `npm run typecheck`
- `npm run lint`
- `npm test` (starts the local Postgres automatically)
- `npm run test:e2e` (Playwright)

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| "Email or password is incorrect" on first login | Use **Forgot password?** (§4). The seeded account has no password until you set one. |
| Password-reset link opens the login page again | Add `https://YOUR-APP/auth/callback` to Supabase **Redirect URLs** (§1). |
| Google says `redirect_uri_mismatch` | The redirect URI in Google Cloud must be exactly `https://YOUR-APP/api/integrations/gmail/callback` (no trailing slash). |
| "Please tick all permissions" after Connect Gmail | On Google's consent screen, tick both boxes. |
| Gmail connected but asks to reconnect after 7 days | Your OAuth app is still in **Testing**. Publish it to **Production** (§5a step 4). |
| "Google did not return a refresh token" | Remove Inquira at https://myaccount.google.com/permissions and connect again. |
| TradeIndia "credentials rejected" | Re-copy the User ID, Profile ID and Key from My Inquiry API. The key changes if you regenerate it. |
| Nothing syncs by itself | Check §8 (`net._http_response` should show 200). You can always click **Sync now**. |
| `APP_ENCRYPTION_KEY must be 32 bytes` | Generate it again with `npm run gen:keys`, then re-enter the Gmail and TradeIndia credentials. |
| Claude says "Couldn't reach the MCP server" | Open `https://YOUR-APP/.well-known/oauth-protected-resource`. It must load, and `resource` must be exactly the URL you gave Claude. |
