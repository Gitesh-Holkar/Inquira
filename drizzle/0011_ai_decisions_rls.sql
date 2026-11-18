-- Row-level security for app.ai_decisions (GOAL G-AI-9). Every member reads their company's AI decisions
-- (the dashboard shows accuracy per tier). Only the AI job writes them, as the system role. A person who
-- corrects a lead or a review email marks the decision corrected, so those who may edit leads or classify
-- emails may update; nobody signed in may add or delete one.
ALTER TABLE app.ai_decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON app.ai_decisions;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.ai_decisions FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
GRANT SELECT, UPDATE ON app.ai_decisions TO authenticated;
--> statement-breakpoint
GRANT ALL ON app.ai_decisions TO service_role;
--> statement-breakpoint
CREATE POLICY ai_decisions_select ON app.ai_decisions FOR SELECT TO authenticated USING (app.is_member(org_id));
--> statement-breakpoint
CREATE POLICY ai_decisions_update ON app.ai_decisions FOR UPDATE TO authenticated
  USING (app.can_any(org_id, ARRAY['leads.edit', 'emails.classify'])) WITH CHECK (app.can_any(org_id, ARRAY['leads.edit', 'emails.classify']));
