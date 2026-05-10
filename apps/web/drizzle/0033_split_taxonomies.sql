-- Split the legacy `taxonomies` collection into two: `categories`
-- and `tags`. The reference site exposed a single Taxonomies menu
-- where operators picked the term type from a discriminator
-- dropdown — confusing UX. Operators now see Categories and Tags
-- as distinct sidebar entries pointing at separate tables.
--
-- Data preservation: the M2M tables (np_c_posts__categories /
-- np_c_posts__tags) reference taxonomies row ids today. We copy
-- the rows over PRESERVING the original ids, so the M2M target_id
-- values keep resolving after the FKs are repointed.
--
-- Column shapes match the codegen output exactly (status enum,
-- WITH TIMEZONE timestamps, visibility, slug NOT NULL, no
-- _status because neither categories nor tags opts into draft
-- versions). The earlier draft of this migration drifted from
-- codegen and would have produced a schema mismatch that the
-- runtime ORM rejected on first read.

-- ── Create categories ──────────────────────────────────────────
-- `IF NOT EXISTS` on every CREATE so a partial-fail of a later
-- statement (drizzle-kit runs each statement-breakpoint block in
-- its own transaction, NOT the whole file) doesn't block a re-run
-- by clashing with already-committed creates. Note: the literal
-- statement-breakpoint marker is intentionally NOT spelled out in
-- this comment — the integration-test migration runner splits the
-- file on that exact string and orphans the trailing backtick if
-- the marker text appears inside a backtick-quoted comment.
CREATE TABLE IF NOT EXISTS "np_c_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "np_users"("id"),
  "updated_by" uuid REFERENCES "np_users"("id"),
  "visibility" text DEFAULT 'public' NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "slug" text NOT NULL,
  "site_id" text DEFAULT 'default' NOT NULL,
  "search_vector" tsvector
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "np_c_categories_status_idx" ON "np_c_categories" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "np_c_categories_site_slug_idx" ON "np_c_categories" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "np_c_categories_site_idx" ON "np_c_categories" USING btree ("site_id");--> statement-breakpoint

-- ── Create tags ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "np_c_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "np_users"("id"),
  "updated_by" uuid REFERENCES "np_users"("id"),
  "visibility" text DEFAULT 'public' NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "slug" text NOT NULL,
  "site_id" text DEFAULT 'default' NOT NULL,
  "search_vector" tsvector
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "np_c_tags_status_idx" ON "np_c_tags" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "np_c_tags_site_slug_idx" ON "np_c_tags" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "np_c_tags_site_idx" ON "np_c_tags" USING btree ("site_id");--> statement-breakpoint

-- ── Copy rows preserving id ────────────────────────────────────
-- The legacy taxonomies table is conditionally present (fresh
-- installs after this PR never created it). Wrap in a DO block so
-- the migration is idempotent on those installs too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'np_c_taxonomies') THEN
    INSERT INTO "np_c_categories"
      (id, status, created_at, updated_at, created_by, updated_by,
       visibility, name, description, slug, site_id, search_vector)
    SELECT id, status, created_at, updated_at, created_by, updated_by,
           visibility, name, description, slug, site_id, search_vector
    FROM "np_c_taxonomies"
    WHERE taxonomy = 'category';

    INSERT INTO "np_c_tags"
      (id, status, created_at, updated_at, created_by, updated_by,
       visibility, name, description, slug, site_id, search_vector)
    SELECT id, status, created_at, updated_at, created_by, updated_by,
           visibility, name, description, slug, site_id, search_vector
    FROM "np_c_taxonomies"
    WHERE taxonomy = 'post_tag';
  END IF;
END$$;--> statement-breakpoint

-- ── Repoint M2M FKs ────────────────────────────────────────────
ALTER TABLE "np_c_posts__categories"
  DROP CONSTRAINT IF EXISTS "np_c_posts__categories_target_id_np_c_taxonomies_id_fk";--> statement-breakpoint
ALTER TABLE "np_c_posts__categories"
  ADD CONSTRAINT "np_c_posts__categories_target_id_np_c_categories_id_fk"
  FOREIGN KEY ("target_id") REFERENCES "np_c_categories"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "np_c_posts__tags"
  DROP CONSTRAINT IF EXISTS "np_c_posts__tags_target_id_np_c_taxonomies_id_fk";--> statement-breakpoint
ALTER TABLE "np_c_posts__tags"
  ADD CONSTRAINT "np_c_posts__tags_target_id_np_c_tags_id_fk"
  FOREIGN KEY ("target_id") REFERENCES "np_c_tags"("id") ON DELETE cascade;--> statement-breakpoint

-- ── Drop the legacy table ──────────────────────────────────────
DROP TABLE IF EXISTS "np_c_taxonomies" CASCADE;
