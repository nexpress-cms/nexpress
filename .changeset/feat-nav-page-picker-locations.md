---
"@nexpress/core": minor
"@nexpress/admin": minor
---

Navigation editor wires up two missing pieces:

1. **Page picker** — selecting `type: "page"` for a nav item now lets
   the operator pick from the live pages list (`/api/collections/pages`)
   and stores `pageId` instead of a hardcoded URL. `getNavigation()`
   resolves `pageId` → current page slug → URL on read, so renaming a
   page slug doesn't silently break header/footer links. Items whose
   linked page was unpublished or deleted fall through to `#` rather
   than dropping out of the cached menu.
2. **Location switcher** — the editor exposes a Header / Footer / Main
   selector (the `nx_navigation` table has always keyed by location;
   the UI was hardcoded to `"main"`). Each location's items load and
   save against its own `(siteId, location)` row.

`NxNavItem`'s shape is unchanged — `pageId` and `url` were already
declared on the type. Editor migration: existing items with
`type: "page" + url` keep working because the page-typed branch falls
back to `#` only when `pageId` is absent and `url` is empty.
