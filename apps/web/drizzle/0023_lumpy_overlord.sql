ALTER TABLE "nx_bans" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_comments" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_follows" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_member_mutes" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_member_roles" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_notifications" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_reactions" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_reports" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_follows" DROP CONSTRAINT IF EXISTS "nx_follows_unique";--> statement-breakpoint
ALTER TABLE "nx_member_roles" DROP CONSTRAINT IF EXISTS "nx_member_roles_grant_uq";--> statement-breakpoint
ALTER TABLE "nx_member_mutes" DROP CONSTRAINT IF EXISTS "nx_member_mutes_member_id_target_id_pk";--> statement-breakpoint
ALTER TABLE "nx_member_mutes" DROP CONSTRAINT IF EXISTS "nx_member_mutes_member_id_target_id_site_id_pk";--> statement-breakpoint
ALTER TABLE "nx_member_mutes" ADD CONSTRAINT "nx_member_mutes_member_id_target_id_site_id_pk" PRIMARY KEY("member_id","target_id","site_id");--> statement-breakpoint
ALTER TABLE "nx_follows" ADD CONSTRAINT "nx_follows_unique" UNIQUE("follower_id","target_type","target_id","site_id");--> statement-breakpoint
ALTER TABLE "nx_member_roles" ADD CONSTRAINT "nx_member_roles_grant_uq" UNIQUE NULLS NOT DISTINCT("member_id","role","scope_type","scope_id","site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nx_bans_site_idx" ON "nx_bans" USING btree ("site_id","member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nx_comments_site_idx" ON "nx_comments" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nx_follows_site_idx" ON "nx_follows" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nx_member_roles_site_idx" ON "nx_member_roles" USING btree ("site_id","member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nx_notifications_site_inbox_idx" ON "nx_notifications" USING btree ("site_id","member_id","read_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nx_reactions_site_idx" ON "nx_reactions" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nx_reports_site_queue_idx" ON "nx_reports" USING btree ("site_id","resolved_at");
