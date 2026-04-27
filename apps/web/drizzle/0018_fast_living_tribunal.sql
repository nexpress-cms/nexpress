-- Phase 15.5 — site memberships + super-admin flag.
-- Idempotent so the integration-test harness's
-- re-apply-every-migration loop tolerates re-runs.

CREATE TABLE IF NOT EXISTS "nx_site_memberships" (
	"site_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "nx_user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_site_memberships_site_id_user_id_pk" PRIMARY KEY("site_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "nx_users" ADD COLUMN IF NOT EXISTS "is_super_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'nx_site_memberships'
      AND constraint_name = 'nx_site_memberships_user_id_nx_users_id_fk'
  ) THEN
    ALTER TABLE "nx_site_memberships" ADD CONSTRAINT "nx_site_memberships_user_id_nx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."nx_users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
