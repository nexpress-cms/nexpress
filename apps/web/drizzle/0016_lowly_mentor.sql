DROP INDEX "nx_c_discussions_slug_idx";--> statement-breakpoint
DROP INDEX "nx_c_localized-pages_locale_slug_idx";--> statement-breakpoint
DROP INDEX "nx_c_pages_slug_idx";--> statement-breakpoint
DROP INDEX "nx_c_posts_slug_idx";--> statement-breakpoint
ALTER TABLE "nx_c_discussions" ADD COLUMN "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_c_localized-pages" ADD COLUMN "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_c_pages" ADD COLUMN "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_c_posts" ADD COLUMN "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_discussions_site_slug_idx" ON "nx_c_discussions" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "nx_c_discussions_site_idx" ON "nx_c_discussions" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_localized-pages_site_locale_slug_idx" ON "nx_c_localized-pages" USING btree ("site_id","locale","slug");--> statement-breakpoint
CREATE INDEX "nx_c_localized-pages_site_idx" ON "nx_c_localized-pages" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_pages_site_slug_idx" ON "nx_c_pages" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "nx_c_pages_site_idx" ON "nx_c_pages" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_posts_site_slug_idx" ON "nx_c_posts" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "nx_c_posts_site_idx" ON "nx_c_posts" USING btree ("site_id");