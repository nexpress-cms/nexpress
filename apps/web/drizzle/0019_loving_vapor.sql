-- Phase D — UI string admin overrides. Idempotent so the
-- integration-test harness's re-apply-every-migration loop
-- doesn't trip on re-runs.

CREATE TABLE IF NOT EXISTS "nx_string_overrides" (
	"site_id" text DEFAULT 'default' NOT NULL,
	"locale" text NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "nx_string_overrides_site_id_locale_key_pk" PRIMARY KEY("site_id","locale","key")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'nx_string_overrides'
      AND constraint_name = 'nx_string_overrides_updated_by_nx_users_id_fk'
  ) THEN
    ALTER TABLE "nx_string_overrides" ADD CONSTRAINT "nx_string_overrides_updated_by_nx_users_id_fk"
      FOREIGN KEY ("updated_by") REFERENCES "public"."nx_users"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
