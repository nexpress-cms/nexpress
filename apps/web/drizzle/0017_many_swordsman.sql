CREATE TABLE "np_content_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"viewer_hash" text NOT NULL,
	"viewed_on" date NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_content_views_daily_visitor_uq" UNIQUE("site_id","target_type","target_id","viewer_hash","viewed_on")
);
--> statement-breakpoint
CREATE INDEX "np_content_views_target_idx" ON "np_content_views" USING btree ("site_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "np_content_views_day_idx" ON "np_content_views" USING btree ("site_id","viewed_on");