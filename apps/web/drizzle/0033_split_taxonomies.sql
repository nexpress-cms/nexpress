-- Split the legacy `taxonomies` collection into two: `categories`
-- and `tags`. The reference site exposed a single Taxonomies menu
-- where operators picked the term type from a discriminator
-- dropdown — confusing UX. Operators now see Categories and Tags
-- as distinct sidebar entries pointing at separate tables.
--
-- Data preservation: the M2M tables (np_c_posts__categories /
-- np_c_posts__tags) reference taxonomies row ids today. We copy
-- the rows over PRESERVING the original ids, so the M2M target_id
-- values keep resolving after the FKs are repointed. Without the
-- id preservation, every post would lose its category/tag links.
--
-- Order matters:
--   1. Create the new tables empty
--   2. Copy rows by `taxonomy` discriminator into the right table
--      (preserving id)
--   3. Drop the old FK constraints on the M2M tables
--   4. Add new FK constraints pointing at the new tables
--   5. Drop the legacy taxonomies table

-- ── Create categories ──────────────────────────────────────────
CREATE TABLE "np_c_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "name" text NOT NULL,
  "description" text,
  "slug" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "site_id" text DEFAULT 'default' NOT NULL,
  "_status" text DEFAULT 'draft' NOT NULL,
  "search_vector" tsvector,
  CONSTRAINT "np_c_categories_created_by_np_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "np_users"("id"),
  CONSTRAINT "np_c_categories_updated_by_np_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "np_users"("id")
);--> statement-breakpoint
CREATE INDEX "np_c_categories_status_idx" ON "np_c_categories" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_categories_site_slug_idx" ON "np_c_categories" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_categories_site_idx" ON "np_c_categories" USING btree ("site_id");--> statement-breakpoint

-- ── Create tags ────────────────────────────────────────────────
CREATE TABLE "np_c_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "name" text NOT NULL,
  "description" text,
  "slug" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "site_id" text DEFAULT 'default' NOT NULL,
  "_status" text DEFAULT 'draft' NOT NULL,
  "search_vector" tsvector,
  CONSTRAINT "np_c_tags_created_by_np_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "np_users"("id"),
  CONSTRAINT "np_c_tags_updated_by_np_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "np_users"("id")
);--> statement-breakpoint
CREATE INDEX "np_c_tags_status_idx" ON "np_c_tags" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_tags_site_slug_idx" ON "np_c_tags" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_tags_site_idx" ON "np_c_tags" USING btree ("site_id");--> statement-breakpoint

-- ── Copy rows preserving id ────────────────────────────────────
-- The legacy taxonomies table is conditionally present (fresh
-- installs after this PR never created it). Wrap in a DO block so
-- the migration is idempotent on those installs too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'np_c_taxonomies') THEN
    INSERT INTO "np_c_categories"
      (id, created_at, updated_at, created_by, updated_by,
       name, description, slug, status, site_id, _status, search_vector)
    SELECT id, created_at, updated_at, created_by, updated_by,
           name, description, slug, status, site_id, _status, search_vector
    FROM "np_c_taxonomies"
    WHERE taxonomy = 'category';

    INSERT INTO "np_c_tags"
      (id, created_at, updated_at, created_by, updated_by,
       name, description, slug, status, site_id, _status, search_vector)
    SELECT id, created_at, updated_at, created_by, updated_by,
           name, description, slug, status, site_id, _status, search_vector
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
