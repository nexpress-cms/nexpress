---
"create-nexpress": patch
---

Scaffold's `posts.ts` and `pages.ts` collection templates were stuck at the PR #335 (templates-as-files split, 2026-04-04ish) shape — multiple hundred lines stale against `apps/web/src/collections`. Operators booting a fresh scaffold saw:

- No per-collection icons in the sidebar nav (introduced in #519). Posts/Pages rendered with the same default folder icon.
- Missing `admin.group: "Content"`, so collections didn't cluster in the sidebar.
- Missing access rules (`isEditorOrAbove`/`isOwnerOrAdmin`), so the scaffolded RBAC was strictly looser than apps/web.
- `pages.ts` missing the i18n config + nav-cache invalidation hook (#517) so multi-locale editing was just absent.
- Missing `seo.urlPath` so `/sitemap.xml` and `/feed.xml` came out malformed.
- `posts.ts` missing `autosave`, `community`, `versions: { max: 20 }`, and other UX defaults.

`categories.ts` and `tags.ts` were already correct from earlier this session.

Root cause: `pnpm sync-snapshot` mirrors `apps/web/src/{app,lib,…}` into `templates/snapshot/`, but `templates.ts` loads collections from `templates/collections/` — outside the snapshot tree. That dir had no automated sync, so each apps/web collection change quietly drifted from the scaffold.

Fixes:

1. Replace scaffold `posts.ts` / `pages.ts` with the current apps/web sources (mirrors what categories/tags already did).
2. Extend `sync-snapshot.ts` to also mirror `apps/web/src/collections` → `packages/cli/templates/collections/`. Now `pnpm sync-snapshot` keeps the four scaffold collection files in lockstep with apps/web automatically.
