CREATE TABLE "nx_slug_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"collection" text NOT NULL,
	"document_id" text NOT NULL,
	"old_slug" text NOT NULL,
	"new_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "nx_slug_history_lookup_idx" ON "nx_slug_history" USING btree ("site_id","collection","old_slug");--> statement-breakpoint
CREATE INDEX "nx_slug_history_doc_idx" ON "nx_slug_history" USING btree ("site_id","collection","document_id");