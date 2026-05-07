-- Pages collection becomes i18n-enabled. Drops the demo
-- `localized-pages` table (replaced by Translation Tabs on the
-- regular Pages edit screen) and adds locale + translation_group_id
-- columns to np_c_pages so every existing page row gains a default
-- locale and a unique translation group id.
--
-- The codegen drizzle-kit produced added the new columns as NOT
-- NULL without DEFAULT, which would fail against any non-empty
-- pages table. Hand-edit the SQL to supply DEFAULTs so existing
-- rows backfill cleanly:
--   - locale → site's default locale ('en' per apps/web/i18n.config.ts)
--   - translation_group_id → gen_random_uuid() per row (Postgres 13+
--     ships this in core; no pgcrypto extension required)
--
-- After the backfill commits, the DEFAULT clauses are dropped so
-- future inserts MUST supply values (the pipeline always does;
-- this protects against bare SQL inserts that forget the columns).

ALTER TABLE "np_c_localized-pages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "np_c_localized-pages" CASCADE;--> statement-breakpoint
DROP INDEX "np_c_pages_site_slug_idx";--> statement-breakpoint
ALTER TABLE "np_c_pages" ADD COLUMN "locale" text NOT NULL DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "np_c_pages" ADD COLUMN "translation_group_id" uuid NOT NULL DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "np_c_pages" ALTER COLUMN "locale" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "np_c_pages" ALTER COLUMN "translation_group_id" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_pages_site_locale_slug_idx" ON "np_c_pages" USING btree ("site_id","locale","slug");--> statement-breakpoint
CREATE INDEX "np_c_pages_translation_group_idx" ON "np_c_pages" USING btree ("translation_group_id");--> statement-breakpoint
CREATE INDEX "np_c_pages_locale_idx" ON "np_c_pages" USING btree ("locale");
