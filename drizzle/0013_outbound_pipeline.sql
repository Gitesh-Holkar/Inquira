CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"entity_type" text,
	"entity_id" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."outbound_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"match_type" text NOT NULL,
	"pattern" text NOT NULL,
	"note" text,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."outgoing_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"state" text NOT NULL,
	"to_address" text,
	"subject" text,
	"body" text NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"price_entry_ids" uuid[] DEFAULT '{}' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_ids" uuid[] DEFAULT '{}' NOT NULL,
	"hold_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rule_set_version" text NOT NULL,
	"mode" text NOT NULL,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"reply_to_id" uuid,
	"gmail_thread_id" text,
	"in_reply_to_message_id" text,
	"gmail_message_id" text,
	"edited" boolean DEFAULT false NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"cancelled_reason" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"subject" text,
	"body" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "app"."templates_org_kind_name_uq";--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD COLUMN "notifications_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."org_settings" ADD COLUMN "outbound" jsonb;--> statement-breakpoint
ALTER TABLE "app"."email_messages" ADD COLUMN "attachment_names" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."email_messages" ADD COLUMN "reply_planned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "outreach_planned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."templates" ADD COLUMN "purpose" text DEFAULT 'first_quotation' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."templates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."outbound_rules" ADD CONSTRAINT "outbound_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."outgoing_messages" ADD CONSTRAINT "outgoing_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."template_versions" ADD CONSTRAINT "template_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_org_created_idx" ON "app"."notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once_uq" ON "app"."notifications" USING btree ("org_id","kind","entity_id");--> statement-breakpoint
CREATE INDEX "outbound_rules_org_idx" ON "app"."outbound_rules" USING btree ("org_id","enabled");--> statement-breakpoint
CREATE INDEX "outgoing_org_state_idx" ON "app"."outgoing_messages" USING btree ("org_id","state","created_at");--> statement-breakpoint
CREATE INDEX "outgoing_org_lead_idx" ON "app"."outgoing_messages" USING btree ("org_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "outgoing_org_sent_idx" ON "app"."outgoing_messages" USING btree ("org_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_uq" ON "app"."template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "template_versions_org_idx" ON "app"."template_versions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_org_kind_purpose_name_uq" ON "app"."templates" USING btree ("org_id","kind","purpose","name");