---
"@nexpress/admin": minor
---

Page builder editor — phase 4 (raw JSON editing).

Two new escape hatches for power users:

- **Per-block "Edit as JSON"** — a `Braces` icon button in each
  block header opens a Dialog with the block's `props` as
  pretty-printed JSON. Apply replaces the entire props object
  (REPLACE_PROPS, not the merge that the field form uses) so
  removing a key in JSON actually drops it. Validates JSON
  parse + object shape; richer schema validation is left to the
  server-side save path.
- **Page-level "Edit JSON"** — a button next to "Add block" at
  the editor footer opens a Dialog with the entire blocks tree.
  Apply RESETs the editor state. Validates each block has a
  string `id` + string `type` (recursively through `children`).
  Unknown types soft-warn but don't block saves — operators can
  paste in plugin-block JSON before the plugin is enabled.

The reducer gains `REPLACE_PROPS` for the per-block path. The
existing `RESET` action was reused for the page-level path.
