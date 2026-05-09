-- G.1 — move plugin config from `np_plugins.config` jsonb column to
-- `np_settings` rows keyed by `plugin.config:<id>`.
--
-- Locked decision E in `docs/design/plugin-config-auto-form.md`:
-- pre-1.0 / private repo lets us spend ~150 LOC once for permanent
-- symmetry with theme settings (np_settings + theme.settings:<id>),
-- shared internal helpers, and matching getThemeSettings ↔
-- getPluginConfig signatures. After v1.0 this asymmetry would be
-- locked in.
--
-- Migration shape:
--  1. INSERT every np_plugins row whose config is a non-null,
--     non-empty object into np_settings — siteId defaults to
--     'default' (multi-site deploys keep their existing per-site
--     state because np_plugins itself is currently single-site;
--     once multi-site plugin config lands, that's a separate
--     migration that fans out per site).
--  2. The value column wraps the original config in the v1
--     versioned envelope shape so future configMigrate runs match
--     the theme settings pipeline.
--  3. ON CONFLICT DO NOTHING so re-runs are idempotent (e.g. a
--     CI replay against a prod-snapshot dev DB).
--  4. DROP the np_plugins.config column once the data lives in
--     np_settings.
INSERT INTO np_settings (site_id, key, value, updated_at, updated_by)
SELECT
  'default' AS site_id,
  'plugin.config:' || id AS key,
  jsonb_build_object(
    '__npVersion', 1,
    '__npSettings', config
  ) AS value,
  updated_at,
  NULL::uuid AS updated_by
FROM np_plugins
WHERE
  config IS NOT NULL
  AND jsonb_typeof(config) = 'object'
  AND config <> '{}'::jsonb
ON CONFLICT (site_id, key) DO NOTHING;
--> statement-breakpoint
ALTER TABLE "np_plugins" DROP COLUMN "config";
