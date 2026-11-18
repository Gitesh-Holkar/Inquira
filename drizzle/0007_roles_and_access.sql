ALTER TYPE "app"."member_role" ADD VALUE 'qa' BEFORE 'viewer';--> statement-breakpoint
ALTER TYPE "app"."member_role" ADD VALUE 'accounts' BEFORE 'viewer';--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD COLUMN "granted" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD COLUMN "revoked" text[] DEFAULT '{}' NOT NULL;