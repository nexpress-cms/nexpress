---
"@nexpress/admin": patch
---

Page builder — post-review fixes for #487–#491.

Bundle of seven small fixes flagged in the deep review of the
phase 2-4 PRs.

Reducer contract gates (closes the bypass paths #490 added):

- `INSERT_BEFORE` / `INSERT_AFTER` now check the parent
  container's `allowedChildTypes` and `maxChildren` before
  inserting. Previously the slot affordances bypassed the same
  gate the Add-block popover already respected.
- `INSERT_PATTERN` checks the parent contract for every block
  in the pattern, with cumulative `maxChildren` enforcement —
  a pattern that would push the count past the cap truncates
  rather than overflowing. Empty result returns the unchanged
  state.
- `WRAP_IN` validates the wrapper's `allowedChildTypes` against
  the source block's type — wrapping a `hero` in a strict
  `["pricing-tier"]`-only container now fails closed instead
  of producing an instantly-invalid tree.

Prop schema validation (#487):

- `lintFieldValue` regex is now anchored (`^(?:…)$`) to match
  HTML5 `<input pattern>` semantics, so the soft warning and
  the native browser validation agree on whether a value passes.
- Required-missing check on the props form now reads
  `block.props[field.name]` directly (pre-default), so a
  required number with no `defaultValue` is correctly flagged
  when the operator hasn't supplied a value. The previous
  check used the post-`getFieldValue` value, which always
  resolved to `0` for numbers — required + number was
  effectively un-flaggable.

Media picker robustness (#488):

- `loadMedia` now uses `AbortController` so a slow earlier
  request can't overwrite the response from a newer query
  search. Aborted requests skip the error banner.
- `handleUploadFiles` caps concurrency at 3 simultaneous
  uploads. A 100-file drop runs in cohorts instead of opening
  100 parallel POSTs and saturating the rate limit.

No wire-format changes. All gates fail closed (return unchanged
state) so the editor's existing reducer-output invariants hold.
