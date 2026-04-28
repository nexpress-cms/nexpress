ALTER TABLE "nx_audit_events" ADD COLUMN IF NOT EXISTS "site_id" text;--> statement-breakpoint
ALTER TABLE "nx_plugin_storage" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT '_global_' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_plugin_storage" DROP CONSTRAINT IF EXISTS "nx_plugin_storage_plugin_id_key_pk";--> statement-breakpoint
ALTER TABLE "nx_plugin_storage" DROP CONSTRAINT IF EXISTS "nx_plugin_storage_plugin_id_site_id_key_pk";--> statement-breakpoint
ALTER TABLE "nx_plugin_storage" ADD CONSTRAINT "nx_plugin_storage_plugin_id_site_id_key_pk" PRIMARY KEY("plugin_id","site_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nx_audit_site_idx" ON "nx_audit_events" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nx_plugin_storage_site_idx" ON "nx_plugin_storage" USING btree ("site_id");
