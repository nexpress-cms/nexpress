CREATE TABLE "nx_c_discussions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"title" text NOT NULL,
	"body" jsonb,
	"category" text,
	"pinned" boolean,
	"locked" boolean,
	"slug" text NOT NULL,
	"_status" text DEFAULT 'draft' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "nx_c_discussions" ADD CONSTRAINT "nx_c_discussions_created_by_nx_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_discussions" ADD CONSTRAINT "nx_c_discussions_updated_by_nx_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_c_discussions_status_idx" ON "nx_c_discussions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_discussions_slug_idx" ON "nx_c_discussions" USING btree ("slug");