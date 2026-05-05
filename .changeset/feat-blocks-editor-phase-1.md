---
"@nexpress/admin": minor
"@nexpress/blocks": minor
---

Page builder editor — phase 1 (composition ergonomics).

First slice of the upgrades scoped in #467: precise insertion,
undo/redo, collapsed-row summaries, and confirm-before-destruct on
deletes.

- **Insert above / below** — every block row gets a thin "+" slot
  above and below it (and the same inside container `children`
  lists). Picking a block from the popover fires the new
  `INSERT_BEFORE` / `INSERT_AFTER` reducer actions, so the new
  block lands exactly next to the target instead of always at the
  end of the list. Empty pages keep the existing bottom-of-page
  Add-block button.
- **Undo / redo** — the editor reducer is now wrapped in a
  past/present/future stack with toolbar buttons and Cmd+Z /
  Cmd-Shift-Z / Ctrl-Y shortcuts. Consecutive `UPDATE_PROPS` to
  the same block within 600 ms collapse into a single undo step
  so a sentence-long text edit doesn't bury earlier history. The
  shortcut handler skips when focus sits on an input / textarea /
  contenteditable surface, so native input undo still works while
  typing into prop fields. History resets when the backing
  document or page-level JSON edit replaces the tree.
- **Collapsed-row summaries** — `NpBlockMetadata` gains an optional
  `summaryFields?: readonly string[]` hint. The page-builder reads
  the first non-empty string-shaped value from those props and
  shows it inline next to the block label (e.g. `Hero — Build pages
  block by block`). Wired up on the seven built-in display blocks
  (hero, cta, faq, feature-grid, pricing, contact-form,
  image-gallery). Pure presentational hint — runtime renders ignore
  the field.
- **Confirm destructive deletes** — the trash button now opens a
  Dialog when the block has nested children OR any prop that
  diverges from the registered defaults. Plain rows still delete
  in one click, so the confirmation only shows up when there's
  actual work to lose.

Backward compatible: existing page block JSON keeps loading
unchanged; `summaryFields` is optional; undo state is internal and
doesn't change wire format.
