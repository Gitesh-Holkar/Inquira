-- Row Level Security, grants and integrity triggers for the app schema.
-- Model (ADR-004/005):
--   * Human requests run as role `authenticated` with request.jwt.claims.sub = user id → RLS applies.
--   * System actors (cron, MCP) connect as the table owner (postgres) → RLS bypassed; services scope by org_id.
--   * The app schema is NOT exposed through Supabase's Data API, so JWT holders cannot reach it via PostgREST.

-- ---------- helper functions ----------
CREATE OR REPLACE FUNCTION app.is_member(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.memberships m
    WHERE m.org_id = p_org AND m.user_id = auth.uid() AND m.deleted_at IS NULL
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.has_role(p_org uuid, p_roles app.member_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.memberships m
    WHERE m.org_id = p_org AND m.user_id = auth.uid() AND m.deleted_at IS NULL AND m.role = ANY (p_roles)
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint

-- ---------- grants ----------
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM anon;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO authenticated, service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO authenticated;
--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA app TO service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_member(uuid), app.has_role(uuid, app.member_role[]) TO authenticated;
--> statement-breakpoint
-- System-only tables: authenticated has no access at all (RLS below also denies).
REVOKE ALL ON app.integration_secrets, app.oauth_clients, app.oauth_codes, app.oauth_refresh_tokens FROM authenticated;
--> statement-breakpoint

-- ---------- enable RLS + updated_at triggers on every table ----------
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON app.%I', t.tablename);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', t.tablename);
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------- append-only tables ----------
CREATE TRIGGER price_entries_append_only BEFORE UPDATE OR DELETE ON app.price_entries FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER lead_status_changes_append_only BEFORE UPDATE OR DELETE ON app.lead_status_changes FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
--> statement-breakpoint

-- ---------- policies ----------
-- organizations: members can read their org; owners can rename it.
CREATE POLICY org_select ON app.organizations FOR SELECT TO authenticated USING (app.is_member(id));
--> statement-breakpoint
CREATE POLICY org_update ON app.organizations FOR UPDATE TO authenticated
  USING (app.has_role(id, '{owner}')) WITH CHECK (app.has_role(id, '{owner}'));
--> statement-breakpoint

-- "writer" tables: every member reads; owner/admin/sales write; owner/admin delete.
DO $$
DECLARE tn text;
BEGIN
  FOREACH tn IN ARRAY ARRAY['contacts','leads','lead_notes','lead_status_changes','email_messages','quotations',
                            'events','audit_logs','jobs','sync_runs','buylead_decisions'] LOOP
    EXECUTE format('CREATE POLICY %1$s_select ON app.%1$I FOR SELECT TO authenticated USING (app.is_member(org_id))', tn);
    EXECUTE format('CREATE POLICY %1$s_insert ON app.%1$I FOR INSERT TO authenticated WITH CHECK (app.has_role(org_id, ''{owner,admin,sales}''))', tn);
    EXECUTE format('CREATE POLICY %1$s_update ON app.%1$I FOR UPDATE TO authenticated USING (app.has_role(org_id, ''{owner,admin,sales}'')) WITH CHECK (app.has_role(org_id, ''{owner,admin,sales}''))', tn);
    EXECUTE format('CREATE POLICY %1$s_delete ON app.%1$I FOR DELETE TO authenticated USING (app.has_role(org_id, ''{owner,admin}''))', tn);
  END LOOP;
END $$;
--> statement-breakpoint

-- "admin" tables: every member reads; only owner/admin write.
DO $$
DECLARE tn text;
BEGIN
  FOREACH tn IN ARRAY ARRAY['org_settings','memberships','products','product_grades','price_entries','templates',
                            'classification_rules','buylead_rules','integrations'] LOOP
    EXECUTE format('CREATE POLICY %1$s_select ON app.%1$I FOR SELECT TO authenticated USING (app.is_member(org_id))', tn);
    EXECUTE format('CREATE POLICY %1$s_insert ON app.%1$I FOR INSERT TO authenticated WITH CHECK (app.has_role(org_id, ''{owner,admin}''))', tn);
    EXECUTE format('CREATE POLICY %1$s_update ON app.%1$I FOR UPDATE TO authenticated USING (app.has_role(org_id, ''{owner,admin}'')) WITH CHECK (app.has_role(org_id, ''{owner,admin}''))', tn);
    EXECUTE format('CREATE POLICY %1$s_delete ON app.%1$I FOR DELETE TO authenticated USING (app.has_role(org_id, ''{owner,admin}''))', tn);
  END LOOP;
END $$;
--> statement-breakpoint

-- mcp_tokens: owner/admin only (even reading the list).
CREATE POLICY mcp_tokens_all ON app.mcp_tokens FOR ALL TO authenticated
  USING (app.has_role(org_id, '{owner,admin}')) WITH CHECK (app.has_role(org_id, '{owner,admin}'));
--> statement-breakpoint

-- System-only tables: RLS on with no policies for authenticated = deny all.
-- (integration_secrets, oauth_clients, oauth_codes, oauth_refresh_tokens)

-- Future tables created by migrations get the same grants (RLS must still be enabled per table).
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON TABLES TO service_role;
