---
"@nexpress/theme-portfolio": patch
---

Fix: portfolio's seeded `/` front page now renders the project grid instead of an empty fallback. Previously the nine `SEED_PROJECTS` entries shipped without an explicit `kind`, so `posts.kind`'s `defaultValue: "article"` was applied — but `PageFrontTemplate` queries `fetchFrontListPosts({ kind: "project" })`, which then returned zero docs and the asymmetric 12-col grid rendered empty.

Two corrections, applied together:

- Every `SEED_PROJECTS` entry now sets `kind: "project"` so the seeder writes rows that the front-page template can find.
- `manifest.requires.collections.posts` now declares `kind` as a select option (`{ label: "Project", value: "project" }`) and registers a `kinds.project` metadata block (`label`, `labelPlural`, `icon: "Briefcase"`, `urlPattern: "/work/:slug"`). The first half makes `"project"` a valid value for the merged kind union (it was previously not in the option list at all — so any operator authoring a project post had no `Project` choice in the kind picker). The second half lets the framework's `seo.urlPath` emit canonical `/work/<slug>` permalinks for project posts (matching the `routes: [{ pattern: "/work/:slug" }]` entry the theme already shipped) instead of the article fallback `/blog/<slug>`.

No migration is needed for existing portfolio installs: the kind field is `text`/`select` at runtime, and rows seeded by older portfolio versions retain their `kind: "article"` value. Operators who already activated portfolio and want the redesigned front page to populate can re-run reseed from `/admin/settings → Theme`.
