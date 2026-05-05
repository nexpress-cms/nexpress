---
"@nexpress/core": minor
"@nexpress/admin": minor
"@nexpress/web": patch
---

Page builder — server-side media search + hierarchy moves in row header (#467 follow-ups).

Two improvements flagged in the post-merge audit of the #467
work.

- **Server-side media search.** `listMedia()` (and the
  `/api/media` route via a new `q` query param) now runs an
  `ILIKE` over `filename` + `alt`, OR-joined, with `%` / `_`
  escaped so filenames containing them aren't misread as
  wildcards. The page-builder block-image picker drops its
  client-side filter and passes `q` to the API instead, so
  search hits the whole library instead of only the loaded
  pages.
- **Hierarchy moves in the row header.** Each
  `SortableBlockItem` header gets a new "More actions"
  dropdown (lucide `MoreHorizontal`) with three sections:
  - "Move out of <parent>" when the row has a parent.
  - "Move into <container>" — one entry per valid target
    (resolved lazily on dropdown open via
    `getMoveIntoCandidates(id)`).
  - "Wrap in <container>" — one entry per available container
    type that isn't the row's own type.
  Mirrors the Cmd-K commands so mouse operators discover the
  same set of cross-hierarchy moves.

Backward compatible. `listMedia()`'s new `q` field is
optional; admin / web clients that don't pass it see the
existing list-everything behavior. The dropdown is purely
additive — same row layout, same actions reachable from
Cmd-K stay where they were.
