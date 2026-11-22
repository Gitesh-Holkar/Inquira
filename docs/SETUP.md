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
3. **Do not add `app`.** Inquira's data lives in the private `app` schema on purpose (docs/decisions/ADR-004-private-app-schema.md).

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
| `SUPABASE_SERVICE_ROLE_KEY` | same page, the **service_role / secret** key (keep it secret). Needed on Vercel for **Settings → Members** (adding people) and **Documents** (storing files). It stays on the server. |
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

There is **no sign-up button**, and you don't need one. The seed already created the owner account for `SEED_OWNER_EMAIL`, but it has no password yet. A normal sign-in fails until you set one.

1. Open `https://YOUR-APP/login` → **Forgot password? / First time here?**
2. Enter the owner email (the `SEED_OWNER_EMAIL` address; Supabase → **Authentication → Users** lists it) → **Email me a link**.
3. Open the email from Supabase and click the link **in the same browser** you asked from. By default the link is tied to that browser.
4. Choose a password (at least 10 characters).
5. You land on the dashboard.

The sign-in page says what went wrong:
- **"Email or password is incorrect. First time here?…"**: no password yet, or a typo. Do steps 1–4.
- **"That email link must be opened in the same browser…"**: you opened the link on another device or browser. Ask again and open it where you asked. To make links work on any device, see below.
- **"That email link has expired or was already used"**: links are single-use and expire after an hour. Ask for a new one.
- **"Supabase's built-in email service sends only a few emails per hour"**: wait an hour, or use the dashboard link below.
- **"… is signed in but isn't a member of any organisation"**: you signed in with a different email than the owner. Sign out and use the owner email, or ask an owner to add that email under **Settings → Members**.

If no email arrives:
1. In Supabase, open **Authentication → Users**.
2. Find your email → **⋯** → **Send password recovery**.

That link works in any browser.

**Optional: reset links that work on any device.** In Supabase → **Authentication → Emails → Templates → Reset password**, replace `{{ .ConfirmationURL }}` in the link with:
```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery
```
(Site URL must be your app URL, §1.) Do the same in the **Invite user** template with `type=invite`.

To check who can sign in, run this in the SQL editor:
```sql
select m.email, m.role, o.name from app.memberships m join app.organizations o on o.id = m.org_id where m.deleted_at is null;
```

**Adding teammates:** **Settings → Members** → enter their email and a role → **Add member**. Then send them the line the screen shows: open the sign-in page, click **Forgot password? / First time here?**, enter their email and set a password from the email that arrives. Roles:

| Role | Can |
| --- | --- |
| Owner | Everything, including adding or removing owners and admins |
| Admin | Everything except managing owners and admins |
| Sales | Leads, quotations, the review queue; view rates and documents |
| QA | Add and remove product documents (COA, TDS, MSDS); view everything else |
| Accounts | View leads, quotations, prices and documents; no settings |
| Viewer | Look only |

**Custom access:** next to each person, **Access** lists what they may do, ability by ability (for example "Change prices", "Add and remove documents", "See settings"). Tick or untick, then **Save access**. "Added" and "Taken away" show where it differs from the role. You can only give or take away abilities you have yourself, and only an owner changes the access of an owner or admin. Changing someone's role resets their access to the new role's defaults.

Removing someone (same screen) takes effect at their next click; what they did stays in the history. Nobody can remove themselves or change their own role, and the last owner always stays.

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

   Inquira never sends email (see docs/decisions/ADR-010-gmail-drafts-only.md).
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

## 6a. Connect IndiaMART (Lead Manager API)

Two parts. Do both; each covers what the other might miss.

**Pull (history and safety net):**
1. In IndiaMART, open **Lead Manager → ⋮ → Import/Export Leads → Pull API** and generate the key. Generating a new key ends the old one.
2. In Inquira: **Settings → Integrations → IndiaMART**, paste the key, **Save key**, then **Test connection**.
3. Inquira then reads the last 30 days, one week every 10 minutes (IndiaMART allows one call every 5 minutes), and afterwards every 10 minutes.

**Push (each lead within seconds):**
1. **Settings → Integrations → IndiaMART → Create push address**. Copy the address; it is shown once.
2. In IndiaMART: **Lead Manager → ⋮ → Import/Export Leads → Push API**, choose **Other**, enter "Inquira" as the platform and paste the address as the **Webhook Listener URL**. Confirm with the OTP sent to your mobile.
3. The card then shows "last lead received" after the next lead.

If you ever lose the address or think someone else has it, click **New push address** and paste the new one into IndiaMART at once; the old one stops working.

The dashboard card **API and email today** compares how leads arrived. "API missed" means a lead came only by notification email although the API is connected: check the IndiaMART card for errors.

## 6b. Turn on AI (optional)

Inquira works without AI: rules fill what they can and the rest waits under **Leads → Needs details** for you or Claude. AI fills product, request type and quantity on leads the rules could not settle, and (Advanced only) sorts emails waiting in Review. It never sends anything and never sets a price.

**Basic (free key, recommended first):**
1. Open Google AI Studio (aistudio.google.com) with the company's Google account and create an API key. The free tier is enough to start.
2. Note a current model name from AI Studio's model list (for example a "Flash" model). Inquira does not choose one for you; you can change it any time.
3. In Inquira: **Settings → AI → Basic AI**. Provider **Google Gemini**, paste the model name and the key, keep **Confidence needed** at 0.8 and **Calls per day** at or below the free tier's daily limit, tick **Use Basic AI on new leads**, **Save**.
4. Click **Test connection**. "Connected. The model answered in the expected format." means it works. If it says the model did not follow the format, try another model.

Basic never receives a buyer's email, phone, name, company or city: Inquira removes them before every call.

**Advanced (paid key, optional):** same steps under **Advanced AI**, for example with a Claude API key from console.anthropic.com (provider **Anthropic Claude**). Advanced reads the full text of review emails, so use a paid key whose terms keep your data private. Set **Calls per day** to what you are happy to pay for.

**What to check after a day:** the dashboard card **AI, last 30 days** shows how many fields each tier filled and how many you corrected. Correct a wrong product or request type on the lead (Edit): that counts against the tier, so the percentage is honest. If a tier is often wrong, raise **Confidence needed** or change the model.

**If it stops:** the card shows "Paused after an error" with the provider's message. Common causes: daily free limit reached (it resumes by itself), a wrong model name, or a key that was deleted. Leads keep flowing to the next step meanwhile.

## 6c. Replies and sending (the Outbox)

Inquira prepares a reply for every new enquiry in **Outbox** (email when the buyer has a real email, WhatsApp when there is a phone). It starts in **shadow mode**: a person sends every message, so nothing reaches a buyer by itself.

1. **Templates:** check the text for each kind of message (Templates → First quotation, Documents, Sample reply, …). No sign-off: your Gmail signature is added.
2. **Product terms** (Rates → Edit product) and **sample policy** (Settings → Organisation) fill the replies; while one a reply needs is empty, that reply is held.
3. Each day, open **Outbox → Needs a person**. Held ones say why. **Send**, **Edit**, or **Don't send** (you can turn the reason into a rule).
4. **Settings → Sending:** send window, limits per hour and day, follow-up days, the **pause** switch, and the **daily summary** email.
5. After about two weeks in which the prepared quotations needed few edits, an owner may switch email to **assisted** (clean first quotations go automatically, inside the window). Switch back to shadow or press pause at any time.

## 6d. Backups and the daily summary

- **Backups** run by themselves every night after 01:00 IST and are kept 14 days, in the private `documents` bucket (folder `backups/`). They need `SUPABASE_SERVICE_ROLE_KEY` in Vercel (section 2); without it Settings → Backups says file storage is not set up. Once a week, an owner opens **Settings → Backups → Download** and keeps the file somewhere else (another drive or account). Restoring: `docs/RUNBOOK.md` section 5.
- **Daily summary:** Settings → Sending → **Daily summary**. When on, each evening after 19:30 IST the owners (or the addresses you enter) get one email from your Gmail with the day's numbers: new leads, replies sent by people and automatically, what is waiting, and the time to first reply. It needs Gmail connected and stops while sending is paused.
- **Dashboard → Last 7 days** shows the same numbers for the week.

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

To have Claude suggest which IndiaMART Buy Leads to buy (you do the clicking), see [COWORK_INDIAMART_TASK.md](COWORK_INDIAMART_TASK.md).

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

**To use Inquira on your own computer without Supabase or Vercel, follow [`SELF_HOSTING.md`](SELF_HOSTING.md) instead** (Docker, one command). This section is for working on the cloud setup from your computer.

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

## 10. When your prices or terms change

**A new price list**

1. Open **Rates → Import price list**.
2. Copy the text of your price list (from Word, Excel or an email) and paste it. One item per line, as you already write it: `Pea Isolate Protein - 350 Rs/Kg`. Headings such as `Proteins:` can stay.
3. Press **Show changes**. Read the list: new products, price changes, renames, and anything that will not be saved and why. Nothing is saved at this point.
4. Press **Apply**. The new rates start today; the old ones stay in each rate's history.

The folded section **How Inquira reads your list (mapping)** on the same screen holds which heading has which GST % and pack size, the MOQ and price basis for every rate, and which name on your list is which product. It is prepared with your price list; paste it there once and save. Change it when a GST rate or pack size changes.

A product that is not in your catalogue is only added when Inquira knows its GST rate (from the heading it sits under, in the mapping). Otherwise it is listed under "Will NOT be written": add it with **Add product**, enter its rate once on the Rates screen, and it will match from then on.

**One price:** change it directly on the **Rates** screen.

**A product's name, its other names or its grades:** **Rates → Edit product**. Other names are what buyers call the product; they help match enquiries and price list lines to it. A grade can be renamed or added, not removed, because its rates are history.

**A discontinued product:** **Rates → Edit product** → choose it → **Remove product**. It disappears from rates, quotations, lead matching and Buy Lead suggestions; its rates and history are kept. To bring it back: **Removed products** at the bottom of the Rates screen → **Restore**.

**Payment terms, price basis, quotation validity:** **Settings → Organisation**. Payment terms are printed on every quotation; leave the field empty to leave the line out. MOQ and pack size are part of each rate.

From a terminal, `npm run rates:import -- <list.txt>` prints the same changes and writes only with `--confirm`.

**COA, TDS, MSDS and other documents:** **Documents** (in the menu; on a phone under Settings) → **Add document**: choose the product (or "Whole company" for a brochure or factory certificate), the type, the file (PDF, image, Word or Excel, up to 4 MB), and the batch and expiry date. When you create a quotation for a lead of that product, Inquira asks which documents to attach and attaches the newest valid file of each type. An expired file is never attached; the Documents screen marks it in red.

## 11. Database changes (after an update)

Some updates add a column or a table to the database. Until the database has it, Vercel refuses to build the new version and shows the deployment as **failed** with the message "Inquira build stopped: the database is missing … migration(s)". Your site keeps running on the previous version; nothing is broken.

To apply the change, use one of these:

- **No tools needed:** Supabase → **SQL Editor** → **New query** → paste the SQL block that came with the update → **Run**. Then Vercel → **Deployments** → open the failed one → **Redeploy**. The block is produced with `npm run db:manual-sql -- <migration names>`; running it twice does nothing the second time.
- **From a computer with this repository and `.env.local`:** `npm run db:migrate`.
- **From an agent session:** `NODE_USE_ENV_PROXY=1 SUPABASE_ACCESS_TOKEN=proxy-injected npm run db:remote:apply`. The real token is a network secret for `api.supabase.com` saved on the session's environment (Supabase → Account → Access Tokens; permission: Database read and write on this project only). `NODE_USE_ENV_PROXY=1` makes Node send its requests through the session's proxy, which adds the token.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| Vercel deployment failed with "Inquira build stopped: the database is missing … migration(s)" | The update needs a database change first. Follow §11; the site keeps running on the previous version meanwhile. |
| "Email or password is incorrect" on first login | Use **Forgot password? / First time here?** (§4). The seeded account has no password until you set one. |
| Password-reset link opens the login page again | Add `https://YOUR-APP/auth/callback` to Supabase **Redirect URLs** (§1). If the page says "same browser", open the link where you asked for it, or use the template change in §4. |
| Red banner "APP_URL is … but this site is …" | Set `APP_URL` in Vercel to the address in the banner (no trailing slash) and redeploy. Gmail and Claude need it. |
| Signed in, but sent back to the sign-in page with "isn't a member" | That email isn't in the organisation. Use the owner email, or add the account with the SQL in §4. |
| Google says `redirect_uri_mismatch` | The redirect URI in Google Cloud must be exactly `https://YOUR-APP/api/integrations/gmail/callback` (no trailing slash). |
| "Please tick all permissions" after Connect Gmail | On Google's consent screen, tick both boxes. |
| Gmail connected but asks to reconnect after 7 days | Your OAuth app is still in **Testing**. Publish it to **Production** (§5a step 4). |
| "Google did not return a refresh token" | Remove Inquira at https://myaccount.google.com/permissions and connect again. |
| TradeIndia "credentials rejected" | Re-copy the User ID, Profile ID and Key from My Inquiry API. The key changes if you regenerate it. |
| Nothing syncs by itself | Check §8 (`net._http_response` should show 200). You can always click **Sync now**. |
| `APP_ENCRYPTION_KEY must be 32 bytes` | Generate it again with `npm run gen:keys`, then re-enter the Gmail and TradeIndia credentials. |
| Claude says "Couldn't reach the MCP server" | Open `https://YOUR-APP/.well-known/oauth-protected-resource`. It must load, and `resource` must be exactly the URL you gave Claude. |
