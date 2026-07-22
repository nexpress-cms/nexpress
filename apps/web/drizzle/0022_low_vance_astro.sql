CREATE TABLE "np_site_plugins" (
	"site_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_site_plugins_site_id_plugin_id_pk" PRIMARY KEY("site_id","plugin_id")
);
--> statement-breakpoint
CREATE INDEX "np_site_plugins_plugin_id_idx" ON "np_site_plugins" USING btree ("plugin_id");--> statement-breakpoint
CREATE INDEX "np_site_plugins_site_id_idx" ON "np_site_plugins" USING btree ("site_id");--> statement-breakpoint
INSERT INTO "np_site_plugins" ("site_id", "plugin_id", "enabled", "updated_at")
SELECT "sites"."id", "np_plugins"."id", false, "np_plugins"."updated_at"
FROM (
	SELECT "id" FROM "np_sites"
	UNION ALL
	SELECT 'default' WHERE NOT EXISTS (SELECT 1 FROM "np_sites")
) AS "sites"
CROSS JOIN "np_plugins"
WHERE "np_plugins"."enabled" = false
ON CONFLICT ("site_id", "plugin_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "np_plugins" DROP COLUMN "enabled";
