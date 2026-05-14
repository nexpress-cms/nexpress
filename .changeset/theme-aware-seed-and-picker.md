---
"@nexpress/theme": patch
"@nexpress/app": patch
"create-nexpress": patch
---

Theme-aware first-boot seed + setup-wizard theme picker.

**Why** — the framework's `seedAll` shipped one set of "Welcome to NexPress" pages + framework-themed posts. For a magazine site that's the wrong visual; for a portfolio site that's the wrong visual; for docs that's very wrong. With the bundled-themes prebake landed, the missing piece is letting each theme ship its own demo content so the first-boot view actually matches what the operator picked.

**`@nexpress/theme`** — new `NpThemeImpl.seedContent?` slot on the theme contract. Shape: `{ tags?, categories?, pages?, posts?, navigation? }` (see `NpThemeSeedContent`). Each slot is independent — a theme that overrides only `posts` keeps the framework's generic pages and seeds the posts on top. Static data only; themes declare WHAT to seed, not HOW (the framework's seeder owns the `saveDocument` call so access control / hooks / validation always run). Asset URLs in block props bake into the seeded pages exactly as authored.

**`@nexpress/app`** — `seedAll(actor, theme?)` accepts an optional theme. When `theme.impl.seedContent` is set, each per-slot seeder takes the theme's samples; unset slots fall through to today's hardcoded framework content (same content as v0.1 today). The single-arg form `seedAll(actor)` still works for the existing `seed:content` script. Internal sample types switched to the public `NpThemeSeedPage` / `NpThemeSeedPost` / `NpThemeSeedTerm`.

**Setup wizard** — `/api/admin/setup` accepts an optional `themeId` in the body. When provided, the handler calls `setActiveThemeId(themeId, …)` inside the same `withCurrentSite` block as `seedAll` so the activation lands atomically with the seed. Unknown ids fail with a `NpValidationError` before the user write, so a stale tab can't silently fall back to the default. The wizard UI renders a text-only picker (name + one-line description) in step 2; the bundled-themes prebake makes the pick non-binding so the description ends with "you can change this from Appearance."

**`create-nexpress`** — new `--theme <id>` (and `--theme=<id>`) flag plus an interactive picker that runs when neither `--theme` nor `--yes` is set. The chosen id is written to the scaffold's `.env` as `NP_ADMIN_THEME=<id>`; the setup wizard reads that env var and forwards it as the picker's initial selection. The CLI's static option list is hardcoded (mirrors `defaultThemes`) so it doesn't depend on workspace packages that aren't installed yet at scaffold time.

What this does NOT do — the four built-in themes don't ship `seedContent` data yet. Each theme drops in its own demo content with its respective design refactor; today the operator picks a theme and gets the framework default seed. The plumbing exists end-to-end so theme refactor PRs only have to author the static data.
