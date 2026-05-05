---
"@nexpress/blocks": minor
"@nexpress/admin": minor
---

Block prop schema — placeholder / min / max / pattern / rows / group / hiddenWhen (#467, "Stronger prop schema and validation").

Fifth PR off the #467 phase 2-4 queue. The block-prop schema
gains optional constraint metadata so block authors can describe
better UI affordances and lighter validation without writing a
custom field-renderer.

`@nexpress/blocks` — new optional fields on `NpBlockPropField`:

- `placeholder?: string` — native `<input>` / `<textarea>`
  placeholder. Applies to `text` / `textarea` / `url` / `number`.
- `min?: number`, `max?: number`, `step?: number` — for
  `type: "number"`. Wired to the HTML number input attributes
  AND to the new client validator (`lintFieldValue`), so
  out-of-bounds values surface as soft warnings.
- `pattern?: string`, `patternMessage?: string` — regex (string
  source) for `type: "text"` / `type: "url"`. Invalid patterns
  silently drop so a schema typo doesn't crash the editor.
- `rows?: number` — visible rows for `type: "textarea"`.
  Defaults to 4 when omitted (matches the legacy renderer).
- `group?: string` — collapsible-section label. Fields with the
  same `group` render under one bordered card; ungrouped fields
  stay flat.
- `hiddenWhen?: ReadonlyArray<readonly [string, unknown]>` —
  conditional visibility. Hidden when *all* `[propName, value]`
  predicates match the block's current `props`. Lets a schema
  express "show ctaUrl only when showCta is true" without the
  block author writing UI logic.

`@nexpress/admin` props form:

- `FieldControl` reads `placeholder` / `min` / `max` / `step` /
  `pattern` / `rows` from the schema and forwards them to the
  underlying `<Input>` / `<Textarea>`.
- New `lintFieldValue(field, value)` helper runs alongside the
  existing required-missing check. Out-of-bounds numbers and
  pattern-mismatched text surface as amber warnings under the
  field. Soft warnings only — Apply still saves so server-side
  validation has the final say.
- `groupVisibleFields(schema, props)` filters `hiddenWhen` and
  partitions visible fields into groups in declaration order.
  Groups render as bordered cards with a label header; ungrouped
  fields stay flat (no wrapper).

Backward compatible. All metadata fields are optional; pre-PR
schemas render unchanged. Wire format unchanged.
