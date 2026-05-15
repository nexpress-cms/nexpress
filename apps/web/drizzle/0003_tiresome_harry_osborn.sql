DROP TABLE "np_c_docs" CASCADE;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "lede" text;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "stable_since" text;