-- Row-level security for app.backups (GOAL G-PLT-7). Members who may see settings see the list;
-- only the nightly job (system role) writes rows. Downloading a backup is owner-only in the app.
ALTER TABLE app.backups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON app.backups;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.backups FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
GRANT SELECT ON app.backups TO authenticated;
--> statement-breakpoint
GRANT ALL ON app.backups TO service_role;
--> statement-breakpoint
CREATE POLICY backups_select ON app.backups FOR SELECT TO authenticated USING (app.can(org_id, 'settings.read'));
