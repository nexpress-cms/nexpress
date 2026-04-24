CREATE TABLE "nx_plugin_storage" (
	"plugin_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_plugin_storage_plugin_id_key_pk" PRIMARY KEY("plugin_id","key")
);
--> statement-breakpoint
CREATE INDEX "nx_plugin_storage_plugin_id_idx" ON "nx_plugin_storage" USING btree ("plugin_id");