---
"@nexpress/admin": patch
---

**Page-builder hardening — #498-#516 review fallout (#520, #523, #524, #525, #529).**

Five related fixes to the page-builder editor, bundled because
they all sit on the same hydration / contract / UI-filtering
spine:

- **#520 — Preserve nested children on hydration.** The
  `field-renderer` block-field's `toBlockInstances` rebuilt every
  block as `{ id, type, props }`, dropping `children`. Opening a
  saved page with a populated grid mounted the editor with empty
  children; the next save persisted the truncated tree, silently
  deleting operator content. Hydration is now recursive.

- **#523 — Container contracts on DUPLICATE / MOVE_OUT /
  REPLACE_TYPE / DUPLICATE_MANY.** Several reducer actions could
  push past `maxChildren` or violate `allowedChildTypes`:
  - `DUPLICATE` rejects when the parent is at max
  - `MOVE_OUT` checks the grandparent's contract before promoting
  - `REPLACE_TYPE` re-validates carried children against the new
    container's contract (drops invalid children rather than
    failing the whole replace)
  - `DUPLICATE_MANY` walks per-parent and skips duplicates that
    would push past the cap

- **#524 — Doc settings dialog accessibility.** `BlockSettingsDialog`
  rendered every non-boolean field without a programmatic label.
  The dialog now wraps each `FieldControl` with a `<Label
  htmlFor>` + required marker + description, except for boolean
  switches which already embed their own inline label.

- **#525 — Doc canvas hover-rail palette filtering.** Clicking
  `+` on a hovered nested block opened the palette with the full
  field-allowed list. The reducer's `INSERT_AFTER` gate (#523)
  then silently rejected types the parent container excludes.
  The palette now filters by `allowedChildTypes` and respects
  `maxChildren` when an insertion target lives inside a container.

- **#529 — Form-card insert-slot filtering.** The before/after
  `InsertSlot`s inside `ChildrenArea` received the unfiltered
  `availableBlocks` while the sibling Add-child popover used the
  contract-filtered `allowedChildBlocks`. Slots now share the
  filtered list and hide when the parent is at `maxChildren`.
