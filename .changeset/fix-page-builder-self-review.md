---
"@nexpress/admin": patch
"@nexpress/cli": patch
---

Self-review follow-ups for #502–#506.

`@nexpress/cli` template `protected-layout.tsx` now passes
`getRegisteredPatterns()` to `BlocksRegistryProvider`, mirroring
`apps/web`. Without this, sites scaffolded after #503 silently
missed plugin / theme contributed patterns in the page-builder's
command-menu picker.

- `DUPLICATE_MANY` no longer double-clones a descendant when both
  it and an ancestor are in the selection. The recursive walk
  emits a clone for every selected id, so the descendant was
  cloned once inside the ancestor's clone AND once on its own —
  4× the descendant, 2× the ancestor. Pre-filtering the selection
  to drop ids whose ancestor is also selected fixes the count.
- Preview-iframe selection highlight survives `srcDoc` swaps. The
  iframe replaces its document on every preview refetch (every
  500ms-debounced edit), which discarded the injected `<style
  data-np-preview-selection>`. Re-applying on `onLoad` keeps the
  highlight stable across debounced renders. Block-id is now
  `CSS.escape`-d before going into the attribute selector so an
  id with a quote / backslash can't break the selector.
- Paste-pattern shape check recurses into `children`. A malformed
  deep node (e.g. `children` not an array, or a child missing
  `id`) used to pass the top-level guard and crash the reducer's
  `cloneBlockDeep` later. The dialog rejects the paste up front
  with a readable error instead.
- Wrap-picker dismisses on outside-click and auto-closes when the
  selection stops being wrap-eligible. The render guard
  `{wrapPickerOpen && wrapEligible}` was hiding the popup
  visually but leaving `wrapPickerOpen` true — re-eligibility
  would then re-open the popup without the operator clicking.
