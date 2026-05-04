---
"@nexpress/admin": minor
"@nexpress/theme-default": minor
"@nexpress/theme-magazine": minor
"@nexpress/theme-portfolio": minor
---

Nav editor + themes now support a single level of sub-menu nesting.

**Editor**: each row gets a `Parent` select alongside `Type`. Picking a
parent nests the item under another top-level item; on save the
flat list with `parentId` collapses into the canonical
`children: NxNavItem[]` shape. The select is disabled on items that
themselves have children (1-level limit). Promoting a parent to be
someone else's child orphans its existing children back to top-level
so the saved tree never grows deeper.

**Themes**: `default`, `magazine`, `portfolio` now render
`item.children` as a nested `<ul>` in their header. Default's
mobile drawer + footer-columns and magazine's mobile drawer + footer
expand children inline. Desktop sub-menus get a hover/focus
dropdown via per-theme CSS (`.nx-site-subnav`,
`.nx-magazine-subnav`, `.nx-portfolio-subnav`).

Server-side resolution (`getNavigation` in `@nexpress/core`) already
walks `children` recursively — added in #429 / #430 and unchanged
here.
