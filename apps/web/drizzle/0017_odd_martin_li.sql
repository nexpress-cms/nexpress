-- Phase 15.4 — settings + navigation scoped per site.
-- Idempotent so the integration-test harness (which re-runs
-- every .sql file on each `ensureMigrated` call) doesn't trip
-- on "constraint already exists" / "does not exist" errors.

-- ===== nx_settings =====
ALTER TABLE "nx_settings" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_settings" DROP CONSTRAINT IF EXISTS "nx_settings_pkey";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'nx_settings'
      AND constraint_name = 'nx_settings_site_id_key_pk'
  ) THEN
    ALTER TABLE "nx_settings" ADD CONSTRAINT "nx_settings_site_id_key_pk" PRIMARY KEY ("site_id", "key");
  END IF;
END $$;--> statement-breakpoint

-- ===== nx_navigation =====
ALTER TABLE "nx_navigation" ADD COLUMN IF NOT EXISTS "site_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_navigation" DROP CONSTRAINT IF EXISTS "nx_navigation_location_unique";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'nx_navigation'
      AND constraint_name = 'nx_navigation_site_location_idx'
  ) THEN
    ALTER TABLE "nx_navigation" ADD CONSTRAINT "nx_navigation_site_location_idx" UNIQUE ("site_id", "location");
  END IF;
END $$;
