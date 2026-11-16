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
