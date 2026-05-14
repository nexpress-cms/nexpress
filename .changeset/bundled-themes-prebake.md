---
"@nexpress/core": patch
"@nexpress/app": patch
---

Bundled-themes prebake: built-in theme swaps no longer need a migration.

**Background** — scaffolded sites already ship `themes: [...defaultThemes]`, and `defineConfig` already runs `mergeThemeRequirements` over every entry. The union of every built-in's `requires.collections` therefore lands in the merged schema at boot, and the first `pnpm db:generate && pnpm db:migrate` materialises every column any built-in needs. What was missing was (a) a CI gate that asserts the union is conflict-free, and (b) an admin UI that hides theme-synthesised collections whose owning theme isn't active. Without (b), the docs-only operator sees Magazine's `authors` slug in the sidebar despite never picking Magazine.

**`@nexpress/core`** — `mergeThemeRequirements` now stamps `admin._themeOrigin: <themeId>` on collections it synthesises via a theme's `requires.collections.<slug>.createIfAbsent: true`. Collections the operator declared (or that two themes both declare via `createIfAbsent`) carry no origin tag — they're owned by the operator. `NpCollectionConfig.admin._themeOrigin` is a new optional string field; never set it by hand from operator config.

**`@nexpress/app`** — the protected admin layout reads `_themeOrigin` and filters out collections whose origin theme is not the active one. Operator-declared collections always pass; theme-synthesised collections appear in the sidebar only while their owning theme is active. The collection's database table remains in place across swaps, so re-activating the theme re-surfaces any previously captured rows.

A CI gate (`apps/web/tests/builtin-themes-union.unit.test.ts`) asserts that the union of every built-in's `requires` produces zero theme-vs-theme field conflicts against the default collections array. Future built-ins that collide with an existing one fail this test before reaching `main`.

Field-level visibility (e.g. hiding Magazine's `posts.featured` while running Docs) is intentionally NOT filtered today — the column stays on the edit view so any data captured under another theme remains addressable. Promote this to a separate follow-up once the data-preservation UX is settled.
