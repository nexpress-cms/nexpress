---
"@nexpress/admin": minor
---

Page builder editor — phase 5 (rich field types).

Two block-prop field types upgrade from raw text inputs to the
proper interactive editors the rest of the admin already ships.

- **`richtext` → Lexical editor.** The block-prop form now uses
  the same `NpRichTextEditor` (lazy-loaded from
  `@nexpress/editor/client`) that the collection field-renderer
  uses for `richText` fields. Replaces the legacy "monospace JSON
  in a textarea" fallback. Block render functions still receive
  the same parsed Lexical content object — wire format unchanged.
- **`image` → URL input + library picker.** The field shows a
  URL input (escape hatch for external CDNs and remote assets)
  side-by-side with a "Library" button that opens a media-picker
  Dialog. Selecting a media doc fills the URL input with the
  doc's `url`. Block props still store a URL string — keeps the
  wire format simple, no relationship resolution at render time.
  Live image preview below the input confirms the URL resolves.

The `textarea` field type stays a plain Textarea (no Lexical) —
it's intended for short freeform copy, not formatted content.
