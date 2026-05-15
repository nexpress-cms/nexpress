---
"@nexpress/admin": patch
---

feat(admin): honor `admin.condition` for fields nested inside row / collapsible containers (13/14)

PR 13 of the editor progressive-disclosure sequence. Closes a
gap flagged in PR 4 (#759) and PR 7 (#762) self-reviews: the
filter pipeline operated on top-level fields only, so a
conditional field inside a `row` or `collapsible` container
always rendered regardless of its condition.

Server-side `collectHiddenFieldNames` (PR 4) already recursed
into containers, so `required` was correctly dropped at the
schema level. The CLIENT side just didn't hide the input.

## Two helpers

- `filterContainerChildren(field, formValues, showAll)` —
  recursively strips condition-failing children from `row` /
  `collapsible` containers. Returns the field unchanged when
  not a container. Threaded through every `FieldRenderer`
  call in the main + sidebar render walks.
- `fieldTreeHasError(fields, errors)` — recursively scans
  field trees for current validation errors. Replaces the
  shallow `group.fields.some` check that decided force-open;
  a required-but-empty field nested in a container now
  triggers its parent group to force open on save failure.

## Edge handling

- Nested containers (row inside collapsible, etc.) recurse all
  the way down.
- Empty container after filter: still rendered (container
  styling around 0 fields is fine; alternative would be to
  prune the container itself, but that changes the layout
  shape based on transient form values which feels jumpy).

## Test plan

- [x] admin build + typecheck clean
- [ ] Browser: put a kind=doc-conditional field inside a row
  container → field hides on article posts; row container
  renders empty
- [ ] Required field nested in collapsible fails validation →
  parent group force-opens
