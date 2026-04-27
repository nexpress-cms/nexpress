CREATE TABLE "nx_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"hostname" text,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_sites_hostname_idx" UNIQUE("hostname")
);
--> statement-breakpoint
-- Phase 15.1 — seed the default site so single-tenant
-- installs keep working without operator intervention.
-- Subsequent sites are added via the super-admin UI (15.3).
INSERT INTO "nx_sites" ("id", "name", "is_default", "settings")
  VALUES ('default', 'Default site', true, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;
