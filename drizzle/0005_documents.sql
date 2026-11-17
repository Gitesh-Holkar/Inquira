CREATE TYPE "app"."document_type" AS ENUM('coa', 'tds', 'msds', 'specification', 'brochure', 'certificate');--> statement-breakpoint
CREATE TABLE "app"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"org_id" uuid NOT NULL,
	"product_id" uuid,
	"type" "app"."document_type" NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"batch" text,
	"issue_date" date,
	"expiry_date" date,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_org_product_type_idx" ON "app"."documents" USING btree ("org_id","product_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_key_uq" ON "app"."documents" USING btree ("storage_key");