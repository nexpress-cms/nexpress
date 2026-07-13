-- Access and refresh tokens now share one browser-session row. Legacy rows
-- cannot be paired reliably, so invalidate them explicitly and require one
-- fresh login instead of manufacturing a refresh credential during migration.
TRUNCATE TABLE "np_sessions", "np_member_sessions";--> statement-breakpoint
ALTER TABLE "np_member_sessions" RENAME COLUMN "token_hash" TO "access_token_hash";--> statement-breakpoint
ALTER TABLE "np_member_sessions" RENAME COLUMN "expires_at" TO "access_expires_at";--> statement-breakpoint
ALTER TABLE "np_sessions" RENAME COLUMN "token_hash" TO "access_token_hash";--> statement-breakpoint
ALTER TABLE "np_sessions" RENAME COLUMN "expires_at" TO "access_expires_at";--> statement-breakpoint
ALTER TABLE "np_member_sessions" ADD COLUMN "refresh_token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "np_member_sessions" ADD COLUMN "refresh_expires_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "np_member_sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "np_sessions" ADD COLUMN "refresh_token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "np_sessions" ADD COLUMN "refresh_expires_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "np_sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "np_member_sessions_member_id_idx" ON "np_member_sessions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "np_member_sessions_refresh_expires_at_idx" ON "np_member_sessions" USING btree ("refresh_expires_at");--> statement-breakpoint
CREATE INDEX "np_sessions_user_id_idx" ON "np_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "np_sessions_refresh_expires_at_idx" ON "np_sessions" USING btree ("refresh_expires_at");--> statement-breakpoint
ALTER TABLE "np_member_sessions" ADD CONSTRAINT "np_member_sessions_access_token_hash_unique" UNIQUE("access_token_hash");--> statement-breakpoint
ALTER TABLE "np_member_sessions" ADD CONSTRAINT "np_member_sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash");--> statement-breakpoint
ALTER TABLE "np_sessions" ADD CONSTRAINT "np_sessions_access_token_hash_unique" UNIQUE("access_token_hash");--> statement-breakpoint
ALTER TABLE "np_sessions" ADD CONSTRAINT "np_sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash");
