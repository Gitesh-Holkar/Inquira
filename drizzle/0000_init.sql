CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."buylead_decision" AS ENUM('contacted', 'skipped', 'would_contact');--> statement-breakpoint
CREATE TYPE "app"."integration_provider" AS ENUM('gmail', 'tradeindia');--> statement-breakpoint
CREATE TYPE "app"."integration_status" AS ENUM('not_connected', 'configured', 'connected', 'error', 'reauth_required');--> statement-breakpoint
CREATE TYPE "app"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "app"."member_role" AS ENUM('owner', 'admin', 'sales', 'viewer');--> statement-breakpoint
CREATE TYPE "app"."email_classification" AS ENUM('pending', 'inquiry', 'conversation', 'ignored', 'international', 'needs_review');--> statement-breakpoint
CREATE TYPE "app"."rule_action" AS ENUM('ignore', 'needs_review', 'international', 'inquiry');--> statement-breakpoint
CREATE TYPE "app"."rule_match" AS ENUM('sender_email', 'sender_domain', 'subject_contains', 'body_contains');--> statement-breakpoint
CREATE TYPE "app"."lead_source" AS ENUM('tradeindia', 'indiamart', 'gmail', 'manual');--> statement-breakpoint
CREATE TYPE "app"."lead_status" AS ENUM('new', 'contacted', 'quoted', 'negotiating', 'won', 'lost', 'not_relevant');--> statement-breakpoint
CREATE TYPE "app"."mcp_token_kind" AS ENUM('manual', 'oauth');--> statement-breakpoint
CREATE TYPE "app"."quote_status" AS ENUM('rendered', 'draft_created', 'draft_failed');--> statement-breakpoint
CREATE TYPE "app"."template_kind" AS ENUM('quote_email', 'whatsapp');--> statement-breakpoint
CREATE TABLE "app"."buylead_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_title" text NOT NULL,
	"product" text,
	"location" text,
	"quantity" text,
	"decision" "app"."buylead_decision" NOT NULL,
	"reason" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"test_mode" boolean DEFAULT false NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."buylead_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"product_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_terms" text[] DEFAULT '{}' NOT NULL,
	"allowed_countries" text[] DEFAULT '{"India"}' NOT NULL,
	"allowed_states" text[] DEFAULT '{}' NOT NULL,
	"excluded_states" text[] DEFAULT '{}' NOT NULL,
	"min_quantity_kg" numeric(12, 2),
	"max_quantity_kg" numeric(12, 2),
	"daily_cap" integer DEFAULT 10 NOT NULL,
	"test_mode" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."price_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"price_per_kg_inr" numeric(12, 2) NOT NULL,
	"price_basis" text NOT NULL,
	"moq_kg" numeric(12, 2),
	"gst_percent" numeric(5, 2) NOT NULL,
	"gst_inclusive" boolean DEFAULT false NOT NULL,
	"pack_size" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"needs_confirmation" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "app"."product_grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"website_url" text,
	"default_pack_size" text,
	"default_gst_percent" numeric(5, 2),
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"company_name" text,
	"city" text,
	"state" text,
	"country" text
);
--> statement-breakpoint
CREATE TABLE "app"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"changes" jsonb
);
--> statement-breakpoint
CREATE TABLE "app"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."integration_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" "app"."integration_provider" NOT NULL,
	"status" "app"."integration_status" DEFAULT 'not_connected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"account_email" text,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"backoff_until" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "app"."job_status" DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text
);
--> statement-breakpoint
CREATE TABLE "app"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app"."member_role" NOT NULL,
	"email" text NOT NULL,
	"display_name" text
);
--> statement-breakpoint
CREATE TABLE "app"."org_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quote_validity_days" integer DEFAULT 3 NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"home_country" text DEFAULT 'IN' NOT NULL,
	"default_price_basis" text DEFAULT 'Ex-factory' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" "app"."integration_provider" NOT NULL,
	"kind" text DEFAULT 'incremental' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."classification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"match_type" "app"."rule_match" NOT NULL,
	"pattern" text NOT NULL,
	"action" "app"."rule_action" NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"history_id" text,
	"rfc_message_id" text,
	"from_email" text,
	"from_name" text,
	"to_emails" text[] DEFAULT '{}' NOT NULL,
	"cc_emails" text[] DEFAULT '{}' NOT NULL,
	"subject" text,
	"snippet" text,
	"body_text" text,
	"body_html" text,
	"label_ids" text[] DEFAULT '{}' NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"is_outgoing" boolean DEFAULT false NOT NULL,
	"classification" "app"."email_classification" DEFAULT 'pending' NOT NULL,
	"classification_reason" text,
	"classified_by" text,
	"classified_at" timestamp with time zone,
	"parser_format" text,
	"parsed" jsonb,
	"confidence" text,
	"lead_id" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."lead_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_status" "app"."lead_status",
	"to_status" "app"."lead_status" NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "app"."leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"contact_id" uuid,
	"source" "app"."lead_source" NOT NULL,
	"source_ref" text NOT NULL,
	"channel" text,
	"status" "app"."lead_status" DEFAULT 'new' NOT NULL,
	"is_international" boolean DEFAULT false NOT NULL,
	"contact_name" text,
	"company_name" text,
	"phone" text,
	"email" text,
	"city" text,
	"state" text,
	"country" text,
	"product_text" text,
	"product_id" uuid,
	"quantity_text" text,
	"quantity_kg" numeric(14, 3),
	"message" text,
	"raw_payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gmail_thread_id" text,
	"gmail_message_id" text,
	"alternate_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_to" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "app"."mcp_token_kind" DEFAULT 'manual' NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{"mcp"}' NOT NULL,
	"oauth_client_id" uuid,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_hash" text,
	"client_name" text,
	"redirect_uris" text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text,
	"resource" text,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"access_token_id" uuid,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"template_id" uuid,
	"status" "app"."quote_status" DEFAULT 'rendered' NOT NULL,
	"items" jsonb NOT NULL,
	"validity_date" date NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"to_email" text,
	"gmail_draft_id" text,
	"gmail_thread_id" text,
	"gmail_draft_url" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "app"."templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"kind" "app"."template_kind" NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."buylead_decisions" ADD CONSTRAINT "buylead_decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."buylead_rules" ADD CONSTRAINT "buylead_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."price_entries" ADD CONSTRAINT "price_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."price_entries" ADD CONSTRAINT "price_entries_grade_id_product_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "app"."product_grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."product_grades" ADD CONSTRAINT "product_grades_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."product_grades" ADD CONSTRAINT "product_grades_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."integration_secrets" ADD CONSTRAINT "integration_secrets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."integration_secrets" ADD CONSTRAINT "integration_secrets_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "app"."integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."integrations" ADD CONSTRAINT "integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."org_settings" ADD CONSTRAINT "org_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sync_runs" ADD CONSTRAINT "sync_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."classification_rules" ADD CONSTRAINT "classification_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."email_messages" ADD CONSTRAINT "email_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lead_notes" ADD CONSTRAINT "lead_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lead_status_changes" ADD CONSTRAINT "lead_status_changes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lead_status_changes" ADD CONSTRAINT "lead_status_changes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "app"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."mcp_tokens" ADD CONSTRAINT "mcp_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."oauth_codes" ADD CONSTRAINT "oauth_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quotations" ADD CONSTRAINT "quotations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."templates" ADD CONSTRAINT "templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buylead_decisions_org_idx" ON "app"."buylead_decisions" USING btree ("org_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buylead_rules_org_uq" ON "app"."buylead_rules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "price_entries_grade_idx" ON "app"."price_entries" USING btree ("grade_id","valid_from","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "grades_product_name_uq" ON "app"."product_grades" USING btree ("product_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_name_uq" ON "app"."products" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "contacts_org_email_idx" ON "app"."contacts" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "contacts_org_phone_idx" ON "app"."contacts" USING btree ("org_id","phone");--> statement-breakpoint
CREATE INDEX "audit_org_entity_idx" ON "app"."audit_logs" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "app"."audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "events_org_type_idx" ON "app"."events" USING btree ("org_id","type","created_at");--> statement-breakpoint
CREATE INDEX "events_unprocessed_idx" ON "app"."events" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_secrets_integration_uq" ON "app"."integration_secrets" USING btree ("integration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_provider_uq" ON "app"."integrations" USING btree ("org_id","provider");--> statement-breakpoint
CREATE INDEX "jobs_pick_idx" ON "app"."jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "app"."jobs" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "app"."memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "app"."memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_settings_org_uq" ON "app"."org_settings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sync_runs_org_provider_idx" ON "app"."sync_runs" USING btree ("org_id","provider","started_at");--> statement-breakpoint
CREATE INDEX "rules_org_idx" ON "app"."classification_rules" USING btree ("org_id","enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "email_org_msg_uq" ON "app"."email_messages" USING btree ("org_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "email_org_class_idx" ON "app"."email_messages" USING btree ("org_id","classification","received_at");--> statement-breakpoint
CREATE INDEX "email_org_thread_idx" ON "app"."email_messages" USING btree ("org_id","gmail_thread_id");--> statement-breakpoint
CREATE INDEX "email_org_received_idx" ON "app"."email_messages" USING btree ("org_id","received_at");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_idx" ON "app"."lead_notes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_status_changes_lead_idx" ON "app"."lead_status_changes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_source_ref_uq" ON "app"."leads" USING btree ("org_id","source","source_ref");--> statement-breakpoint
CREATE INDEX "leads_org_status_idx" ON "app"."leads" USING btree ("org_id","status","received_at");--> statement-breakpoint
CREATE INDEX "leads_org_received_idx" ON "app"."leads" USING btree ("org_id","received_at");--> statement-breakpoint
CREATE INDEX "leads_org_phone_idx" ON "app"."leads" USING btree ("org_id","phone");--> statement-breakpoint
CREATE INDEX "leads_org_email_idx" ON "app"."leads" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "leads_org_thread_idx" ON "app"."leads" USING btree ("org_id","gmail_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tokens_hash_uq" ON "app"."mcp_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mcp_tokens_org_idx" ON "app"."mcp_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_clients_client_id_uq" ON "app"."oauth_clients" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_codes_hash_uq" ON "app"."oauth_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_refresh_hash_uq" ON "app"."oauth_refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "quotations_lead_idx" ON "app"."quotations" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_org_kind_name_uq" ON "app"."templates" USING btree ("org_id","kind","name");