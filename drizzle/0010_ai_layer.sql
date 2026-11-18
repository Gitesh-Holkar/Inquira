CREATE TYPE "app"."lead_intent" AS ENUM('new_enquiry', 'document_request', 'sample_request', 'price_negotiation', 'order', 'complaint', 'not_buyer', 'other');--> statement-breakpoint
ALTER TYPE "app"."integration_provider" ADD VALUE 'ai_basic';--> statement-breakpoint
ALTER TYPE "app"."integration_provider" ADD VALUE 'ai_advanced';--> statement-breakpoint
CREATE TABLE "app"."ai_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"org_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"task" text NOT NULL,
	"tier" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"confidence" numeric(4, 3),
	"value" jsonb,
	"detail" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"corrected_at" timestamp with time zone,
	"corrected_by" text,
	"corrected_value" jsonb
);
--> statement-breakpoint
ALTER TABLE "app"."email_messages" ADD COLUMN "ai_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "intent" "app"."lead_intent";--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "filled_by" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "understood_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."ai_decisions" ADD CONSTRAINT "ai_decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_decisions_org_tier_created_idx" ON "app"."ai_decisions" USING btree ("org_id","tier","created_at");--> statement-breakpoint
CREATE INDEX "ai_decisions_org_entity_idx" ON "app"."ai_decisions" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "leads_org_understood_idx" ON "app"."leads" USING btree ("org_id","understood_at");