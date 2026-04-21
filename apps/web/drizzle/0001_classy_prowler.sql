CREATE TABLE "nx_c_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"title" text NOT NULL,
	"seo_description" text,
	"blocks" jsonb,
	"slug" text NOT NULL,
	"_status" text DEFAULT 'draft' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "nx_c_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"title" text NOT NULL,
	"excerpt" text,
	"cover_image" uuid,
	"content" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"author" uuid,
	"slug" text NOT NULL,
	"_status" text DEFAULT 'draft' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "nx_c_pages" ADD CONSTRAINT "nx_c_pages_created_by_nx_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_pages" ADD CONSTRAINT "nx_c_pages_updated_by_nx_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_posts" ADD CONSTRAINT "nx_c_posts_created_by_nx_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_posts" ADD CONSTRAINT "nx_c_posts_updated_by_nx_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_posts" ADD CONSTRAINT "nx_c_posts_cover_image_nx_media_id_fk" FOREIGN KEY ("cover_image") REFERENCES "public"."nx_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_posts" ADD CONSTRAINT "nx_c_posts_author_nx_users_id_fk" FOREIGN KEY ("author") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_c_pages_status_idx" ON "nx_c_pages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_pages_slug_idx" ON "nx_c_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "nx_c_posts_status_idx" ON "nx_c_posts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_posts_slug_idx" ON "nx_c_posts" USING btree ("slug");