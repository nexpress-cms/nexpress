-- Backfill `seed_source = 'theme:default'` onto legacy pages rows
-- so the admin's Switch & reseed flow (introduced in PR-track
-- #779-#785) can replace them on a theme switch. Pre-PR1 installs
-- carry NULL `seed_source` on every page; reseed wipes only marked
-- rows and then hits a slug uniqueness violation on `/` when it
-- tries to write the new theme's home page.
--
-- Scope: default site, NULL `seed_source` only, slugs that match
-- the framework's original marketing seed (`/`, `about`, `pricing`,
-- `contact`). Operator-edited slugs are left untouched on purpose
-- — the reseed POST surfaces an actionable conflict in that case
-- so the operator can decide. Posts are NOT backfilled because the
-- 2026-05 default theme refresh changed every post title, and
-- legacy post rows are more likely to be operator content than a
-- recognisable framework seed.
UPDATE np_c_pages
SET seed_source = 'theme:default'
WHERE seed_source IS NULL
  AND site_id = 'default'
  AND slug IN ('/', 'about', 'pricing', 'contact');
