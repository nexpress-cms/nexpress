ALTER TABLE "np_media" ADD COLUMN "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "np_media_folders" ADD COLUMN "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "np_media_refs" ADD COLUMN "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX "np_media_site_created_idx" ON "np_media" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "np_media_site_hash_idx" ON "np_media" USING btree ("site_id","hash");--> statement-breakpoint
CREATE INDEX "np_media_folders_site_parent_idx" ON "np_media_folders" USING btree ("site_id","parent_id");--> statement-breakpoint
CREATE INDEX "np_media_refs_site_document_idx" ON "np_media_refs" USING btree ("site_id","collection","document_id");