CREATE TABLE "np_c_authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"name" text,
	"bio" text,
	"site_id" text DEFAULT 'default' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "np_c_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"title" text,
	"body" jsonb,
	"parent" uuid,
	"order" double precision,
	"site_id" text DEFAULT 'default' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "featured" boolean;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "hero_image" uuid;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "client" text;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "year" double precision;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "np_c_authors" ADD CONSTRAINT "np_c_authors_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_authors" ADD CONSTRAINT "np_c_authors_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_docs" ADD CONSTRAINT "np_c_docs_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_docs" ADD CONSTRAINT "np_c_docs_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_docs" ADD CONSTRAINT "np_c_docs_parent_np_c_docs_id_fk" FOREIGN KEY ("parent") REFERENCES "public"."np_c_docs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_c_authors_status_idx" ON "np_c_authors" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_c_authors_site_idx" ON "np_c_authors" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_docs_status_idx" ON "np_c_docs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_c_docs_site_idx" ON "np_c_docs" USING btree ("site_id");--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_hero_image_np_media_id_fk" FOREIGN KEY ("hero_image") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;