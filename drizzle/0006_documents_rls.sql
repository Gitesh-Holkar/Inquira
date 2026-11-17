-- Row-level security for app.documents (same rules as the other "admin" tables in 0001):
-- every member reads; only owners and admins add, change or remove.
ALTER TABLE app.documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON app.documents;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.documents FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.documents TO authenticated;
--> statement-breakpoint
GRANT ALL ON app.documents TO service_role;
--> statement-breakpoint
CREATE POLICY documents_select ON app.documents FOR SELECT TO authenticated USING (app.is_member(org_id));
--> statement-breakpoint
CREATE POLICY documents_insert ON app.documents FOR INSERT TO authenticated WITH CHECK (app.has_role(org_id, '{owner,admin}'));
--> statement-breakpoint
CREATE POLICY documents_update ON app.documents FOR UPDATE TO authenticated USING (app.has_role(org_id, '{owner,admin}')) WITH CHECK (app.has_role(org_id, '{owner,admin}'));
--> statement-breakpoint
CREATE POLICY documents_delete ON app.documents FOR DELETE TO authenticated USING (app.has_role(org_id, '{owner,admin}'));
