---
"@nexpress/admin": patch
---

feat(admin): nested-group error aggregation in toast (14/14) — closes the editor sequence

PR 14 of the editor progressive-disclosure sequence. Closes
the last flag from PR 6 (#761): nested-group errors weren't
aggregated.

## The gap

`Object.keys(form.formState.errors)` is shallow. When a field
nested in a `group` field fails, RHF surfaces the error at the
nested path (`errors.seo.metaTitle = { type, message }`). The
shallow walk saw `seo` as a key, fed it to `fieldLabelByName`
which returned the group's label — the toast said "Please
complete the 'SEO' field." but the actual failing input was
`metaTitle` inside it.

## Fix

`flattenErrorPaths(errors)` recursively walks the nested error
object. Leaves (objects with a `type` string property) become
dot-paths; containers (objects without `type`) recurse. Skips
RHF's `root` key which holds form-level errors.

`{ title: { type, message }, seo: { metaTitle: { type } } }` →
`["title", "seo.metaTitle"]`

`fieldLabelByName` switches from single-name lookup to a path
walk. Splits on dots, finds each segment in the current field
list, recurses into `group` fields when the path has more
segments. Falls back to the last segment when no label is
found (`seo.metaTitle` → `metaTitle`) — better than echoing
internal path structure.

`findNamed` (new helper) walks through `row` / `collapsible`
containers (which don't have names) to find a named field at
the current level — used by the segment-walk above.

`setFocus` accepts dot-paths through RHF's path-aware
registry, so the focus call on `setFocus("seo.metaTitle")`
just works without manual handling.

## Closes out

This is the final PR of the 14-PR sequence. Together with
#756–#768 the editor is now:

- Fields grouped by purpose, with icons + descriptions
- Kind-based hiding works end-to-end (client + server, expr form)
- Empty-state Card when every group is hidden
- Main column grouping (symmetric with sidebar)
- SEO meta fields with length hints
- Required-but-hidden never blocks save
- Container-nested fields honor conditions
- Save errors surface as toast + focus + auto-expand to the
  failing field, including nested ones
- a11y + motion polish

## Test plan

- [x] admin build + typecheck clean
- [ ] Browser: failing nested group field surfaces in toast
  with the leaf field's label (or last path segment as
  fallback)
- [ ] `setFocus` with dot-path lands on the right input
