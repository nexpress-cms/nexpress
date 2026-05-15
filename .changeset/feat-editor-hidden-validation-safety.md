---
"@nexpress/core": patch
"@nexpress/admin": patch
---

feat(core, admin): hidden field validation safety (4/7)

PR 4 of the editor progressive-disclosure sequence. Closes the
gap where a `required` field gated by `admin.condition` would
block save with an invisible validation error: operator sees
no failing input but the form refuses to submit.

## The gap

PR 1 wired `admin.condition` to hide fields from the editor. A
field marked `required: true` + `condition: (data) => data.kind
=== "doc"` would:

- Hide for kind=article posts (correct)
- Still fail Zod's `required` check on submit (wrong)

Operator sees nothing to fix; the only signal is the form
refusing to advance. Same gap on the server-side pipeline —
even if the client let the submit through, `pipeline.ts` rebuilt
the schema unconditionally and rejected too.

## Fix

`@nexpress/core/collections/validation` gains a
`hiddenByCondition: ReadonlySet<string>` parameter on
`buildZodSchema` + `getCollectionZodSchema(config, forData?)`.
When set, `required` is dropped for the named fields — they
slip through as if `required: false`. `collectHiddenFieldNames`
is the public helper that walks fields + evaluates conditions
against current data.

### Admin client

`useForm`'s `zodResolver` is replaced with a custom resolver
that computes hidden names per submit, rebuilds a dynamic
schema, then delegates to `zodResolver`. Resolver fires only
on submit (`mode: "onSubmit"` default), so the rebuild cost is
trivial.

### Server pipeline

`saveDocument`'s validation call passes the incoming `data` to
`getCollectionZodSchema(config, data)`. The schema mirrors the
client's drop set — a hidden field can't sneak through the
admin's required check and then trip a server-side one.

### Deduplication

Both surfaces share `collectHiddenFieldNames` from
`@nexpress/core/collections/validation`. The admin had a local
copy from PR 1; that's gone now in favor of the core export.
Single source of truth, single condition-evaluation behavior.

## Edge handling

- **`row` / `collapsible` containers**: walked transparently
  (their nested fields are checked individually).
- **`group` fields**: when the group itself has a condition
  that hides it, the group name + every nested name are all
  marked hidden. Required on a hidden group OR any nested
  required is dropped.
- **Buggy conditions** (throws): treated as "not hidden" —
  surfacing a required error is more recoverable than silently
  dropping the check.

## What does NOT change

- Public surface of `getCollectionZodSchema(config)` (no
  `forData`) — back-compat. Callers that don't have current
  data continue getting the unconditional schema (matches
  pre-#759 behavior).
- Required-without-condition fields: unchanged.
- Default Zod error messages on visible required fields:
  unchanged.

## Test plan

- [x] `core` 442/442 (existing tests cover the unchanged
  unconditional path)
- [x] `admin` build + typecheck clean
- [ ] Browser: edit a doc-kind post → leave `parent` blank →
  save fails with visible error
- [ ] Edit an article post → `parent` hidden → save succeeds
  (previously would have failed with no visible error)
