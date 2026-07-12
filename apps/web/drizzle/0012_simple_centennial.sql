UPDATE "np_sites" AS site
SET
  "name" = COALESCE(
    (
      SELECT CASE
        WHEN jsonb_typeof(setting."value" -> 'name') = 'string'
          AND length(btrim(setting."value" ->> 'name')) BETWEEN 1 AND 160
        THEN btrim(setting."value" ->> 'name')
        ELSE NULL
      END
      FROM "np_settings" AS setting
      WHERE setting."site_id" = site."id" AND setting."key" = 'site'
      LIMIT 1
    ),
    site."name"
  ),
  "description" = COALESCE(
    site."description",
    (
      SELECT CASE
        WHEN jsonb_typeof(setting."value") = 'string' THEN setting."value" #>> '{}'
        ELSE NULL
      END
      FROM "np_settings" AS setting
      WHERE setting."site_id" = site."id" AND setting."key" = 'description'
      LIMIT 1
    )
  ),
  "settings" = jsonb_build_object(
    'siteUrl', CASE
      WHEN jsonb_typeof(site."settings" -> 'siteUrl') = 'string' THEN site."settings" -> 'siteUrl'
      WHEN jsonb_typeof((
        SELECT setting."value" -> 'url'
        FROM "np_settings" AS setting
        WHERE setting."site_id" = site."id" AND setting."key" = 'site'
        LIMIT 1
      )) = 'string' THEN (
        SELECT setting."value" -> 'url'
        FROM "np_settings" AS setting
        WHERE setting."site_id" = site."id" AND setting."key" = 'site'
        LIMIT 1
      )
      ELSE 'null'::jsonb
    END,
    'defaultLocale', CASE
      WHEN jsonb_typeof(site."settings" -> 'defaultLocale') = 'string' THEN site."settings" -> 'defaultLocale'
      WHEN jsonb_typeof((
        SELECT setting."value" -> 'defaultLocale'
        FROM "np_settings" AS setting
        WHERE setting."site_id" = site."id" AND setting."key" = 'site'
        LIMIT 1
      )) = 'string' THEN (
        SELECT setting."value" -> 'defaultLocale'
        FROM "np_settings" AS setting
        WHERE setting."site_id" = site."id" AND setting."key" = 'site'
        LIMIT 1
      )
      ELSE 'null'::jsonb
    END,
    'timezone', CASE
      WHEN jsonb_typeof(site."settings" -> 'timezone') = 'string' THEN site."settings" -> 'timezone'
      WHEN jsonb_typeof((
        SELECT setting."value" -> 'timezone'
        FROM "np_settings" AS setting
        WHERE setting."site_id" = site."id" AND setting."key" = 'site'
        LIMIT 1
      )) = 'string' THEN (
        SELECT setting."value" -> 'timezone'
        FROM "np_settings" AS setting
        WHERE setting."site_id" = site."id" AND setting."key" = 'site'
        LIMIT 1
      )
      ELSE 'null'::jsonb
    END
  );--> statement-breakpoint

DELETE FROM "np_settings" WHERE "key" IN ('site', 'description');--> statement-breakpoint

ALTER TABLE "np_sites"
  ALTER COLUMN "settings"
  SET DEFAULT '{"siteUrl":null,"defaultLocale":null,"timezone":null}'::jsonb;
