---
"@nexpress/admin": minor
---

The nav editor's page picker becomes a search-as-you-type
combobox so sites with more than 100 pages stop silently dropping
the rest. The previous picker fetched the first 100 pages at
collection limit and rendered them as a flat `<Select>` —
anything past row 100 was unreachable.

The new picker:

- Opens a Popover containing a search input and a debounced
  result list (200ms keystroke debounce, `?search=<term>&limit=20`
  against the existing collection list endpoint, sorted by title).
- Resets its query on close so reopening shows the latest
  default results, not the previous search state.
- Updates a shared title cache as the operator interacts, so
  every picker on the page benefits from titles already resolved.
- Shows `(unknown page)` only when a nav item references an id
  the cache hasn't seen yet — and on editor mount the editor
  proactively fetches titles for every `pageId` in the loaded
  nav items via `GET /api/collections/pages/<id>` so that label
  resolves before first paint even on a >100-page site.
