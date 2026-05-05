---
"@nexpress/blocks": minor
---

Built-in blocks — replace JSON-textarea props with structured array fields.

The five default blocks that previously asked operators to hand-edit a
JSON blob (FAQ, Feature Grid, Pricing, Contact Form, Image Gallery) now
expose their list-shaped props as `type: "array"` with a real
`itemSchema`. The page-builder admin renders an Add / Remove UI per
entry instead of a monospace textarea.

- `faq.items` — Question / Answer per row.
- `feature-grid.features` — Icon / Title / Description per row.
- `pricing.plans` — Plan name / Price / Period / Features (one per
  line) / CTA text / CTA URL / Highlight per row.
- `contact-form.fields` — Field label per row (was `string[]`).
- `image-gallery.images` — Image (URL / library picker) + Alt text
  per row.

Wire format change: `defaultProps` for these props are now real
arrays / objects instead of JSON strings. Each block's render-time
parser still accepts the legacy JSON-string shape, so pages saved
with the old admin keep rendering. New entries written through the
admin go out as plain arrays.

`pricing.plans[].features` is a special case: the new admin-editor
format is a single newline-separated `string` (per-line one
feature, edited via a textarea inside each plan row), while the
legacy default exported a `string[]`. The parser accepts both
shapes — new pages persist a `string`, older pages keep their
`string[]` until the operator next edits and saves the plan.
