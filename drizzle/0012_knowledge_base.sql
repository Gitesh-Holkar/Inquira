ALTER TABLE "app"."price_entries" ADD COLUMN "floor_per_kg_inr" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."price_entries" ADD COLUMN "ceiling_per_kg_inr" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."products" ADD COLUMN "hsn_code" text;--> statement-breakpoint
ALTER TABLE "app"."products" ADD COLUMN "lead_time" text;--> statement-breakpoint
ALTER TABLE "app"."products" ADD COLUMN "payment_terms" text;--> statement-breakpoint
ALTER TABLE "app"."products" ADD COLUMN "sample_available" boolean;--> statement-breakpoint
ALTER TABLE "app"."org_settings" ADD COLUMN "sample_policy" jsonb;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "score_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "scored_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "leads_org_score_idx" ON "app"."leads" USING btree ("org_id","score","received_at");