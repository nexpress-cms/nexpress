---
"@nexpress/admin": patch
---

feat(admin): surface validation errors on Save with toast + auto-focus (6/7)

PR 6 of the editor progressive-disclosure sequence.

## The gap

Before this PR, clicking Save with a required field empty
silently failed: `react-hook-form` set `formState.errors` but
no aggregated UI appeared, and the offending field might be
inside a collapsed sidebar group — invisible to the operator.
The only visible signal was "Save doesn't seem to do anything."

## Fix

`form.handleSubmit(success, onValidationErrors)` now wires the
second callback. On validation failure:

- A toast surfaces the affected field labels — single field
  gets named directly; ≥2 get a comma-separated list capped at
  three with a `+N more` overflow.
- `form.setFocus(firstName)` moves keyboard focus to the first
  invalid input, which also scrolls it into view.
- For fields whose renderer wraps the input atypically (block
  editors, upload tiles), the focus call's error falls back to
  a DOM query for `[name=...]` / `[data-field-name=...]` and
  manual `scrollIntoView` + `focus`.

`fieldLabelByName` walks `effectiveFields` (recursing through
`row` / `collapsible` / `group`) to resolve the field-name →
visible label so the toast reads "Please complete the
\"Lede\" field." rather than "Please complete lede."

## What this PR does NOT do (queued)

- **Auto-expand a collapsed group containing the failing
  field.** Today: the toast names it, focus moves to it,
  scrollIntoView fires — but if the field sits inside a
  closed group, it's still hidden. Lifting the group's
  open-state out of `SidebarGroupCard` so the parent can
  force-open on validation error is the next step. PR 7 / a
  follow-up.

## Test plan

- [x] `@nexpress/admin` build + typecheck clean
- [ ] Browser: leave a required field blank → click Save →
  toast appears naming the field; focus jumps to the input.
- [ ] Toast lists ≥2 field labels when multiple fail.
