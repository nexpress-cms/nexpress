---
"@nexpress/admin": minor
"@nexpress/web": minor
---

Settings → Navigation gains a "Manage locations…" surface so
operators can rename or delete custom slots without dropping into
SQL. The dropdown picks up a new sentinel item that opens a dialog
listing every non-default location with inline rename and a delete
button.

Backed by two new endpoints on `/api/navigation`:

- `PATCH ?location=<old>` body `{ newLocation }` — renames the row.
  Validates the slug shape, blocks renames into or against the
  built-in `header` / `footer` / `main`, and 409s instead of
  surfacing the unique-key violation when the target already
  exists. Busts the nav cache for both old and new slugs so theme
  reads land on the current name.
- `DELETE ?location=<slug>` — removes the row. Same protection
  against deleting the three theme-baked defaults; 404s when the
  slug doesn't exist. Defaults reappear in the locations list on
  the next read because the locations endpoint always re-injects
  them — that's intentional, "deleting" a default would be a
  no-op.

The dialog mirrors the rename / delete result client-side: if you
renamed the location you're currently editing, the editor follows
the new slug; if you deleted it, the editor falls back to the
first remaining option.
