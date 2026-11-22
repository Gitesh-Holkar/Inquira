-- Row-level security for the outbound pipeline tables (GOAL G-OUT-*, ADR-032). Every member reads.
-- outgoing_messages, outbound_rules: written by the pipeline (system role) and by people who may prepare
--   quotations (approve, edit, reject, add a rule from a correction); outbound_rules also by settings.write.
-- notifications: added by anyone who may change something (a person's action can hold a message).
-- template_versions: added with templates.write. Nobody signed in deletes any of these.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('outgoing_messages', ARRAY['quotes.create']),
    ('outbound_rules',    ARRAY['quotes.create', 'settings.write']),
    ('template_versions', ARRAY['templates.write'])
  ) AS t(tn, perms) LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', r.tn);
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON app.%I', r.tn);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', r.tn);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO authenticated', r.tn);
    EXECUTE format('GRANT ALL ON app.%I TO service_role', r.tn);
    EXECUTE format('CREATE POLICY %1$s_select ON app.%1$I FOR SELECT TO authenticated USING (app.is_member(org_id))', r.tn);
    EXECUTE format('CREATE POLICY %1$s_insert ON app.%1$I FOR INSERT TO authenticated WITH CHECK (app.can_any(org_id, %2$L::text[]))', r.tn, r.perms);
    EXECUTE format('CREATE POLICY %1$s_update ON app.%1$I FOR UPDATE TO authenticated USING (app.can_any(org_id, %2$L::text[])) WITH CHECK (app.can_any(org_id, %2$L::text[]))', r.tn, r.perms);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON app.notifications;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.notifications FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
GRANT SELECT, INSERT ON app.notifications TO authenticated;
--> statement-breakpoint
GRANT ALL ON app.notifications TO service_role;
--> statement-breakpoint
CREATE POLICY notifications_select ON app.notifications FOR SELECT TO authenticated USING (app.is_member(org_id));
--> statement-breakpoint
CREATE POLICY notifications_insert ON app.notifications FOR INSERT TO authenticated WITH CHECK (app.can_work(org_id));
--> statement-breakpoint
-- Every existing template becomes version 1 of itself.
INSERT INTO app.template_versions (org_id, template_id, version, subject, body, created_by)
SELECT t.org_id, t.id, t.version, t.subject, t.body, t.created_by FROM app.templates t
WHERE NOT EXISTS (SELECT 1 FROM app.template_versions v WHERE v.template_id = t.id AND v.version = t.version);
