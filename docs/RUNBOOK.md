# Runbook

Procedures the owner runs on the live system. Agents never run these against a live system (`AGENTS.md` rule 13); they only keep this file correct.

SQL goes into **Supabase → SQL Editor** (cloud mode) or `psql` (local mode). Run one block at a time and read the result before the next.

## 1. After sign-in was off: revoke every token and review changes

**When:** once, after deploying the version that turns sign-in back on (milestone M0, 16 Nov 2026).

**Why:** from 2 Oct 2026 (commit `4a2a5eb`) until that deploy, every visitor to the site acted as the owner. Anyone who knew the address could read leads and rates, change settings, and register a Claude connector client and approve a token for themselves. Tokens issued then stay valid until revoked.

### 1.1 Sign in again

1. Wait until Vercel shows the new deployment as **Ready**.
2. Open `/login` and follow `docs/SETUP.md` section 4 ("Forgot password? / First time here?").

### 1.2 See what was issued

```sql
select name, kind, token_prefix, created_at, last_used_at, expires_at, revoked_at, created_by
from app.mcp_tokens order by created_at;

select client_name, redirect_uris, created_at from app.oauth_clients order by created_at;

select client_id, redirect_uri, created_at, used_at from app.oauth_codes order by created_at;
```

Any client whose redirect address is not `https://claude.ai/…`, `https://claude.com/…` or `http://localhost…` / `http://127.0.0.1…` was not registered by Claude.

### 1.3 Revoke everything

This revokes every access token and refresh token, spends every unused authorisation code, removes every registered client, and records the action in the audit log. Nothing else is touched.

```sql
begin;
update app.mcp_tokens set revoked_at = now() where revoked_at is null;
update app.oauth_refresh_tokens set revoked_at = now() where revoked_at is null;
update app.oauth_codes set used_at = now() where used_at is null;
delete from app.oauth_clients;
insert into app.audit_logs (org_id, actor, created_by, action, entity_type, changes)
select id, 'human:owner-sql', 'human:owner-sql', 'mcp.revoke_all', 'mcp_token',
       '{"reason": "sign-in was off from 2 Oct 2026 until the M0 deploy"}'::jsonb
from app.organizations;
commit;
```

Check: `select count(*) from app.mcp_tokens where revoked_at is null;` must return `0`.

### 1.4 Reconnect Claude

In claude.ai → Settings → Connectors, remove the Inquira connector and add it again (`docs/SETUP.md` section 7). Create new manual tokens under Settings → Claude / MCP if you used any.

### 1.5 Review what changed while sign-in was off

Every change in that period is recorded as the owner, so the audit log cannot say who made it. Look for anything you did not do.

```sql
-- Everything that was changed, newest first
select created_at, action, entity_type, actor, changes
from app.audit_logs
where created_at >= '2026-10-02'
order by created_at desc;

-- Rates added since then (the rate book is append-only, so old rates are still there)
select pe.created_at, p.name, g.name as grade, pe.price_per_kg_inr, pe.created_by
from app.price_entries pe
join app.product_grades g on g.id = pe.grade_id
join app.products p on p.id = g.product_id
where pe.created_at >= '2026-10-02'
order by pe.created_at desc;

-- Integrations: status and the account each one points to
select provider, status, account_email, config, updated_at from app.integrations;

-- Email rules and templates changed since then
select name, match_type, pattern, action, enabled, created_at, deleted_at from app.classification_rules where updated_at >= '2026-10-02';
select kind, name, updated_at from app.templates where updated_at >= '2026-10-02';
```

If a rate looks wrong, enter the correct one on the Rates screen; it becomes the current rate and the wrong one stays in history. If an integration points to an account you do not recognise, disconnect it in Settings and connect your own. Stored credentials were never shown in the browser, but if you had entered TradeIndia or Google credentials before 2 Oct, consider regenerating them at the provider.

## 2. Revoke one Claude or MCP token

Settings → Claude / MCP → **Revoke** next to the token. For a Claude connector token this also revokes its refresh token.

## 3. Rotate the cron secret

1. Generate a new value: `npm run gen:keys` (use the `CRON_SECRET` line).
2. Set it in the hosting environment variables and redeploy.
3. Update the scheduler's copy (`docs/SETUP.md` section 8): in Supabase, replace the vault secret `inquira_cron_secret`.
4. Check `net._http_response` shows status 200 after the next run; 401 means the two copies differ.

## 4. Backups

Inquira makes a backup of each company **every night after 01:00 IST** (job `backup.nightly`) and keeps the last **14 days**. Owners can also press **Settings → Backups → Back up now**.

- **What is inside:** every row of the company (leads, contacts, emails, quotations, outbox messages, rates and their history, products, templates, rules, settings, members, audit log) and the uploaded document files, up to 40 MB of files per backup. One `.json.gz` file.
- **What is not inside, on purpose:** saved keys and tokens (Gmail, IndiaMART, TradeIndia, AI, Claude connector tokens), the job queue and the event outbox. After a restore you connect Gmail and the portals again.
- **Where:** in the company's own file storage: the private Supabase bucket `documents`, folder `backups/<company id>/` (cloud), or the `inquira_data` Docker volume, folder `/data/files/backups/` (local mode).
- **Keep a copy elsewhere:** a backup in the same place as the data does not help if that place is lost. Once a week, **Settings → Backups → Download** (owners only; the file holds all the company's data, so keep it somewhere private) and store it on another drive or account.
- **If it stops:** Settings → Backups shows the date of the latest one. No backup for two days usually means the scheduler is not running (`docs/SETUP.md` section 8) or file storage is not set up (`SUPABASE_SERVICE_ROLE_KEY` in the cloud).

## 5. Restore a backup

**When:** the database was lost or damaged, or you are moving Inquira to a new Supabase project or a new computer.

The restore writes into a database that has every migration and **does not have this company yet**; it refuses otherwise, so it can never overwrite live data. Rows come back exactly as they were, including history and the audit log. Members are matched to sign-in accounts by email.

First look at what is inside (this writes nothing):

```bash
npm run backup:restore -- inquira-backup-2026-11-22.json.gz
```

### 5.1 Cloud (Supabase and Vercel)

1. Create a new Supabase project, or use the old one if only the data was lost (`docs/SETUP.md` section 1).
2. Apply every migration to it: `npm run db:migrate` with its `DATABASE_URL` in `.env.local`, or the SQL editor route in `docs/SETUP.md` section 11. **Do not run the seed**: the backup brings the company back.
3. In Supabase → **Authentication → Users → Add user**, create the owner's account with the **same email** as before. Do the same for each member who should sign in, or invite them again afterwards.
4. On a computer with this repository, set `.env.local` to the new project (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; the last two put the document files back), then:
   ```bash
   npm run backup:restore -- inquira-backup-2026-11-22.json.gz --confirm
   ```
5. If it is a new project, put its values in Vercel → Settings → Environment Variables and redeploy (`docs/SETUP.md` sections 2 and 3).
6. Sign in. Then **Settings → Integrations**: connect Gmail again, and re-enter the IndiaMART, TradeIndia and AI keys. In claude.ai, remove and add the Inquira connector again (`docs/SETUP.md` section 7).
7. Check: **Leads** shows your leads, **Rates** your prices, **Documents** opens a file, and **Settings → Sending** has your mode and limits.

### 5.2 Local mode (Docker)

Keep the same `.env` file (the `SEED_DIR` line) as the original install. Put a **downloaded** backup file in the Inquira folder (the nightly ones live in the Docker volume, which the first command below deletes).

```bash
docker compose down -v                 # only on a broken install: deletes the local data and the backups kept in it
docker compose up -d db
docker compose run --rm --no-deps -v "$PWD:/restore" app sh -c \
  "npx tsx scripts/local-setup.ts --no-seed && npm run backup:restore -- /restore/inquira-backup-2026-11-22.json.gz --confirm"
docker compose up -d
docker compose exec app npm run local:sign-in-link -- you@example.com
```

The last command prints a one-time link to set your password (members who had no account on this computer get one without a password, so each person needs their own link). Then reconnect Gmail and the portals in **Settings → Integrations**.

### 5.3 If the restore stops

- "This company already exists in this database": you are pointing at the live database, or the restore already ran. Check `DATABASE_URL`.
- "This is not an Inquira backup file (or a newer format)": the file is damaged, or it came from a newer Inquira than this copy. Update this copy first.
- A message about a missing column or table: the database is missing migrations. Run step 2 (cloud) or `local-setup.ts --no-seed` (local) again, then the restore.
- Nothing is half-written: the restore runs in one transaction, so after an error the database is as it was.
