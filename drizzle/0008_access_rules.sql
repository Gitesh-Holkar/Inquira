-- Access rules by permission instead of by role (QA and Accounts roles, custom access per member).
-- A member's permissions = the role's defaults (app.role_default, mirrored from
-- src/modules/core/permissions.ts and checked by tests/roles.test.ts) + memberships.granted − memberships.revoked.
-- Owners always have everything. Reading is unchanged: every member reads their own company's rows.
-- Role names are compared as text, so this file does not use the enum values added in 0007.

CREATE OR REPLACE FUNCTION app.role_default(p_role text, p_perm text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_perm = ANY (CASE p_role
    WHEN 'owner' THEN ARRAY['dashboard.read', 'leads.read', 'emails.read', 'quotes.read', 'catalog.read', 'documents.read', 'templates.read', 'rules.read', 'buylead.rules.read', 'buylead.decisions.read', 'audit.read', 'leads.edit', 'leads.update_status', 'notes.write', 'leads.create', 'leads.delete', 'emails.classify', 'quotes.create', 'rates.write', 'catalog.write', 'documents.write', 'templates.write', 'rules.write', 'buylead.rules.write', 'buylead.decisions.write', 'settings.read', 'integrations.read', 'settings.write', 'sync.run', 'integrations.manage', 'mcp_tokens.manage', 'members.manage']
    WHEN 'admin' THEN ARRAY['dashboard.read', 'leads.read', 'emails.read', 'quotes.read', 'catalog.read', 'documents.read', 'templates.read', 'rules.read', 'buylead.rules.read', 'buylead.decisions.read', 'audit.read', 'leads.edit', 'leads.update_status', 'notes.write', 'leads.create', 'leads.delete', 'emails.classify', 'quotes.create', 'rates.write', 'catalog.write', 'documents.write', 'templates.write', 'rules.write', 'buylead.rules.write', 'buylead.decisions.write', 'settings.read', 'integrations.read', 'settings.write', 'sync.run', 'integrations.manage', 'mcp_tokens.manage', 'members.manage']
    WHEN 'sales' THEN ARRAY['dashboard.read', 'leads.read', 'emails.read', 'quotes.read', 'catalog.read', 'documents.read', 'templates.read', 'rules.read', 'buylead.rules.read', 'buylead.decisions.read', 'audit.read', 'settings.read', 'integrations.read', 'leads.edit', 'leads.update_status', 'notes.write', 'leads.create', 'emails.classify', 'quotes.create', 'sync.run']
    WHEN 'qa' THEN ARRAY['dashboard.read', 'leads.read', 'emails.read', 'quotes.read', 'catalog.read', 'documents.read', 'templates.read', 'rules.read', 'buylead.rules.read', 'buylead.decisions.read', 'audit.read', 'settings.read', 'integrations.read', 'documents.write']
    WHEN 'accounts' THEN ARRAY['dashboard.read', 'leads.read', 'emails.read', 'quotes.read', 'catalog.read', 'documents.read', 'templates.read', 'rules.read', 'buylead.rules.read', 'buylead.decisions.read', 'audit.read']
    WHEN 'viewer' THEN ARRAY['dashboard.read', 'leads.read', 'emails.read', 'quotes.read', 'catalog.read', 'documents.read', 'templates.read', 'rules.read', 'buylead.rules.read', 'buylead.decisions.read', 'audit.read', 'settings.read', 'integrations.read']
    ELSE ARRAY[]::text[] END)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.can(p_org uuid, p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.memberships m
    WHERE m.org_id = p_org AND m.user_id = auth.uid() AND m.deleted_at IS NULL
      AND (
        m.role::text = 'owner'
        OR (app.role_default(m.role::text, p_perm) AND NOT (p_perm = ANY (m.revoked)))
        OR p_perm = ANY (m.granted)
      )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.can_any(p_org uuid, p_perms text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(bool_or(app.can(p_org, x)), false) FROM unnest(p_perms) AS x
$$;
--> statement-breakpoint
-- Anyone who may change something writes the shared rows that go with it (leads, notes, audit rows, events).
CREATE OR REPLACE FUNCTION app.can_work(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.can_any(p_org, ARRAY['leads.edit', 'leads.update_status', 'notes.write', 'leads.create', 'leads.delete', 'emails.classify', 'quotes.create',
    'rates.write', 'catalog.write', 'documents.write', 'templates.write', 'rules.write', 'buylead.rules.write', 'buylead.decisions.write',
    'settings.write', 'sync.run', 'integrations.manage', 'mcp_tokens.manage', 'members.manage'])
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.role_default(text, text), app.can(uuid, text), app.can_any(uuid, text[]), app.can_work(uuid) TO authenticated;
--> statement-breakpoint

-- Shared working tables: insert and update for anyone who may change something; delete stays with owners and admins.
DO $$
DECLARE tn text;
BEGIN
  FOREACH tn IN ARRAY ARRAY['contacts','leads','lead_notes','lead_status_changes','email_messages','quotations',
                            'events','audit_logs','jobs','sync_runs','buylead_decisions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON app.%1$I', tn);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_update ON app.%1$I', tn);
    EXECUTE format('CREATE POLICY %1$s_insert ON app.%1$I FOR INSERT TO authenticated WITH CHECK (app.can_work(org_id))', tn);
    EXECUTE format('CREATE POLICY %1$s_update ON app.%1$I FOR UPDATE TO authenticated USING (app.can_work(org_id)) WITH CHECK (app.can_work(org_id))', tn);
  END LOOP;
END $$;
--> statement-breakpoint

-- Company setup tables: each written only with the permission that changes it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('org_settings',         ARRAY['settings.write', 'catalog.write']),
    ('memberships',          ARRAY['members.manage']),
    ('products',             ARRAY['catalog.write']),
    ('product_grades',       ARRAY['catalog.write']),
    ('price_entries',        ARRAY['rates.write']),
    ('templates',            ARRAY['templates.write']),
    ('classification_rules', ARRAY['rules.write']),
    ('buylead_rules',        ARRAY['buylead.rules.write', 'catalog.write']),
    ('integrations',         ARRAY['integrations.manage']),
    ('documents',            ARRAY['documents.write'])
  ) AS t(tn, perms) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON app.%1$I', r.tn);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_update ON app.%1$I', r.tn);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_delete ON app.%1$I', r.tn);
    EXECUTE format('CREATE POLICY %1$s_insert ON app.%1$I FOR INSERT TO authenticated WITH CHECK (app.can_any(org_id, %2$L::text[]))', r.tn, r.perms);
    EXECUTE format('CREATE POLICY %1$s_update ON app.%1$I FOR UPDATE TO authenticated USING (app.can_any(org_id, %2$L::text[])) WITH CHECK (app.can_any(org_id, %2$L::text[]))', r.tn, r.perms);
    EXECUTE format('CREATE POLICY %1$s_delete ON app.%1$I FOR DELETE TO authenticated USING (app.can_any(org_id, %2$L::text[]))', r.tn, r.perms);
  END LOOP;
END $$;
--> statement-breakpoint

DROP POLICY IF EXISTS mcp_tokens_all ON app.mcp_tokens;
--> statement-breakpoint
CREATE POLICY mcp_tokens_all ON app.mcp_tokens FOR ALL TO authenticated
  USING (app.can(org_id, 'mcp_tokens.manage')) WITH CHECK (app.can(org_id, 'mcp_tokens.manage'));
