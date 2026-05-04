---
"@nexpress/admin": minor
---

Nav editor and the page edit "In navigation" panel now load the
location list from `GET /api/navigation/locations` instead of a
hardcoded `header / footer / main` triplet. The endpoint always
returns those three plus any custom locations the operator has
created.

The editor's location switcher gains a `+ New location…` entry
that opens a dialog: enter a slug (lowercase, hyphens), the
editor PUTs an empty nav at that location, refreshes the list,
and switches to the new entry.

Themes consume custom locations by calling
`getCachedNavigation("your-slug")` — same as the built-in three.
This unlocks per-section sidebars, announcement bars, and other
theme slots without forking the editor.

Backwards compatible: the fallback constant inside both surfaces
keeps the editor / panel functional during the loading flicker
or if `/api/navigation/locations` is unreachable.
