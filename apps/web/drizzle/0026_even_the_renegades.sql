CREATE TABLE "nx_c_posts__categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"posts_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_c_posts__tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"posts_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_c_taxonomies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"name" text NOT NULL,
	"taxonomy" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "nx_c_posts__categories" ADD CONSTRAINT "nx_c_posts__categories_posts_id_nx_c_posts_id_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."nx_c_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_posts__categories" ADD CONSTRAINT "nx_c_posts__categories_target_id_nx_c_taxonomies_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."nx_c_taxonomies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_posts__tags" ADD CONSTRAINT "nx_c_posts__tags_posts_id_nx_c_posts_id_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."nx_c_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_posts__tags" ADD CONSTRAINT "nx_c_posts__tags_target_id_nx_c_taxonomies_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."nx_c_taxonomies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_taxonomies" ADD CONSTRAINT "nx_c_taxonomies_created_by_nx_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_taxonomies" ADD CONSTRAINT "nx_c_taxonomies_updated_by_nx_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_c_posts__categories_posts_id_idx" ON "nx_c_posts__categories" USING btree ("posts_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_posts__categories_parent_target_uidx" ON "nx_c_posts__categories" USING btree ("posts_id","target_id");--> statement-breakpoint
CREATE INDEX "nx_c_posts__tags_posts_id_idx" ON "nx_c_posts__tags" USING btree ("posts_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_posts__tags_parent_target_uidx" ON "nx_c_posts__tags" USING btree ("posts_id","target_id");--> statement-breakpoint
CREATE INDEX "nx_c_taxonomies_status_idx" ON "nx_c_taxonomies" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_taxonomies_site_slug_idx" ON "nx_c_taxonomies" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "nx_c_taxonomies_site_idx" ON "nx_c_taxonomies" USING btree ("site_id");