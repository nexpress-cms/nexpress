---
"@nexpress/theme-magazine": patch
"@nexpress/theme-docs": patch
"@nexpress/theme-portfolio": patch
"@nexpress/web": patch
---

fix(themes, web): strip `<main>` from `(site)`-tree components — eliminate nested landmarks

`(site)/layout.tsx` already emits `<main className="np-site-main">` as the page's single landmark. Eight components inside the layout's children also emitted their own `<main>`, producing nested mains:

- `apps/web/src/app/(site)/not-found.tsx` (default JSX)
- `apps/web/src/app/(site)/error.tsx` (DefaultError JSX)
- `packages/themes/magazine/src/not-found.tsx` (`MagazineNotFound`)
- `packages/themes/magazine/src/components/error.tsx` (`MagazineError`)
- `packages/themes/magazine/src/archives.tsx` (`ArchiveLayout`)
- `packages/themes/docs/src/not-found.tsx` (`DocsNotFound`)
- `packages/themes/docs/src/search.tsx` (`DocsSearch`, two branches)
- `packages/themes/portfolio/src/not-found.tsx` (`PortfolioNotFound`)

HTML spec allows one `<main>` per page; nesting breaks landmark navigation in screen readers and confuses ATs. Cleanup mirrors the same fix M.ref applied to the `(member)` tree (per the M.ref self-review). Each component now uses `<div>` with a class name unchanged, with an inline comment pointing to the layout's outer `<main>` as the single landmark.

No visual change — `<main>` and `<div>` render identically without browser default styling. No CSS selectors changed (all selectors target the class names).

Verified with `pnpm typecheck` (58/58) and `pnpm build` (31/31).

Memory note `(site) tree nested-main cleanup` (recorded as a deferred follow-up after M.ref) is now closed.
