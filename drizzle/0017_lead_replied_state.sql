ALTER TABLE "app"."org_settings" ADD COLUMN "remove_replied_after_days" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "last_buyer_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "outbox_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "deleted_reason" text;--> statement-breakpoint
CREATE INDEX "leads_org_replied_idx" ON "app"."leads" USING btree ("org_id","replied_at");--> statement-breakpoint
-- Backfill (GOAL G-OUT, owner's request of 28 Nov 2026: leads are "Not replied" until a reply went out).
-- Leads deleted so far were deleted by a person.
UPDATE "app"."leads" SET "deleted_reason" = 'manual' WHERE "deleted_at" IS NOT NULL AND "deleted_reason" IS NULL;
--> statement-breakpoint
-- The buyer's last message: the enquiry, or a later email from them in the lead.
UPDATE "app"."leads" l SET "last_buyer_message_at" = greatest(l."received_at",
  (SELECT max(e."received_at") FROM "app"."email_messages" e WHERE e."org_id" = l."org_id" AND e."lead_id" = l."id" AND NOT e."is_outgoing"))
WHERE l."last_buyer_message_at" IS NULL;
--> statement-breakpoint
-- Something waits or failed in the Outbox.
UPDATE "app"."leads" l SET "outbox_pending" = true WHERE EXISTS (
  SELECT 1 FROM "app"."outgoing_messages" o WHERE o."org_id" = l."org_id" AND o."lead_id" = l."id" AND o."state" IN ('draft', 'held', 'approved', 'failed'));
--> statement-breakpoint
-- Replied: a message Inquira sent, an email the team sent in the lead's Gmail thread, or a status a person moved past "new".
UPDATE "app"."leads" l SET "replied_at" = x."at" FROM (
  SELECT l2."id", greatest(
    (SELECT max(o."sent_at") FROM "app"."outgoing_messages" o WHERE o."org_id" = l2."org_id" AND o."lead_id" = l2."id" AND o."state" = 'sent'),
    (SELECT max(e."received_at") FROM "app"."email_messages" e WHERE e."org_id" = l2."org_id" AND l2."gmail_thread_id" IS NOT NULL
       AND e."gmail_thread_id" = l2."gmail_thread_id" AND e."is_outgoing" AND 'SENT' = ANY(e."label_ids")),
    (SELECT max(c."created_at") FROM "app"."lead_status_changes" c WHERE c."org_id" = l2."org_id" AND c."lead_id" = l2."id" AND c."to_status" <> 'new')
  ) AS "at" FROM "app"."leads" l2
) x WHERE x."id" = l."id" AND x."at" IS NOT NULL AND l."replied_at" IS NULL;
