---
"@nexpress/admin": minor
---

Page builder media picker — search / pagination / upload / broken state (#467, "Richer image/media authoring").

Sixth PR off the #467 phase 2-4 queue. The block-image picker
(`BlockImagePicker`) gets four upgrades.

- **Search** — filter the loaded library by filename / alt text
  (300 ms debounce). Currently a client-side filter over the
  loaded pages; once `/api/media` accepts a `q` parameter this
  will switch to server-side. Tracked as a follow-up.
- **Pagination** — page-based "Load more" so libraries with
  thousands of assets stay reachable. The picker reads
  `totalPages` from the media response to decide when to hide the
  button.
- **Upload from the picker** — file input inside the dialog
  POSTs to `/api/media` with multipart form data, refreshes the
  listing, and immediately fills the URL field with the new
  asset's URL. Handles multiple files (sequentially) and surfaces
  upload errors as a banner.
- **Broken-image state** — the inline preview now shows an
  amber-bannered "Image preview failed to load. Check the URL or
  pick from the library." instead of silently collapsing when the
  URL 404s. Combined with a new **Remove** button next to the URL
  input, operators can recover from a stale URL without retyping.

Backward compatible. Wire format unchanged (`image` field still
stores a URL string). The picker keeps working with the existing
media route.
