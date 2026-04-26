CREATE TABLE "nx_c_localized-pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"title" text NOT NULL,
	"body" text,
	"slug" text NOT NULL,
	"locale" text NOT NULL,
	"translation_group_id" uuid NOT NULL,
	"_status" text DEFAULT 'draft' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "nx_c_localized-pages" ADD CONSTRAINT "nx_c_localized-pages_created_by_nx_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_c_localized-pages" ADD CONSTRAINT "nx_c_localized-pages_updated_by_nx_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_c_localized-pages_status_idx" ON "nx_c_localized-pages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "nx_c_localized-pages_locale_slug_idx" ON "nx_c_localized-pages" USING btree ("locale","slug");--> statement-breakpoint
CREATE INDEX "nx_c_localized-pages_translation_group_idx" ON "nx_c_localized-pages" USING btree ("translation_group_id");--> statement-breakpoint
CREATE INDEX "nx_c_localized-pages_locale_idx" ON "nx_c_localized-pages" USING btree ("locale");