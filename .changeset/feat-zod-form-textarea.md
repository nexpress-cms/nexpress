---
"@nexpress/core": minor
"@nexpress/admin": minor
"@nexpress/theme-portfolio": patch
---

**F.3 follow-up — textarea support in the theme settings auto-form.**

Closes the textarea gap recorded in F.9.1-A/portfolio:
`z.string()` always rendered as a single-line `<input>`, even
when the field semantically wanted multi-line input (operator
bios, long descriptions, etc.).

### How theme authors opt in

Use Zod v4's `.meta()` to tag the field:

```ts
import { z } from "zod";

export const myThemeSettingsSchema = z.object({
  bio: z
    .string()
    .meta({ widget: "textarea", rows: 6 })
    .describe("Studio bio (markdown not supported)."),
});
```

Required: `meta.widget === "textarea"`. Optional: `meta.rows`
(positive integer; defaults to 4).

### What changed

#### `@nexpress/core`
- `NpThemeSettingsTextareaField` — new variant on the
  introspected metadata union with optional `rows` hint.
- `introspectThemeSettingsSchema` reads `inner.meta()` on
  string nodes and emits `type: "textarea"` when the
  `widget` key matches. Falls back to existing
  text/url/color detection otherwise.
- `readMeta(node)` helper — small structural narrower around
  Zod's instance method (the `.meta()` call returns the
  merged description + custom keys).

#### `@nexpress/admin`
- `ZodForm`'s field dispatcher routes `textarea` to a new
  `TextareaField` component using the existing
  `Textarea` UI primitive.
- Honors the `rows` hint when present.

#### `@nexpress/theme-portfolio`
- `aboutCopy` setting now declares `meta({ widget:
  "textarea", rows: 4 })` — operator gets a multi-line
  input in admin → footer bio renders correctly across
  paragraph breaks.

### Tests

4 new unit tests in `settings-schema.test.ts`:
- emits textarea field when `meta({ widget: "textarea" })`
  is set
- carries optional `rows` hint
- unwraps through `.default()` / `.optional()` (meta lives
  on the inner string, not the wrapper)
- ignores `meta` when `widget` key isn't `textarea`

Total core tests: 325 (was 321).

### Cross-axis coverage closure

After F.9.1-C the v0.2 settings cheat-sheet had:
> Magazine: enum/array-heavy
> Docs: text-heavy (5 fields)
> Portfolio: every supported widget except textarea (12 fields)

This PR closes the "except textarea" gap. **Auto-form now
covers every widget shape Zod can declare** through the
combination of native types + `.meta()` extension. Future
custom widgets (color-with-palette, file-picker, slider, etc.)
will follow the same `.meta()` pattern.
