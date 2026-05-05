---
"@nexpress/admin": minor
---

Page builder a11y / keyboard workflow (#467, "A11y / keyboard workflow").

Three additions from the #467 phase 1 leftovers, all bundled
because they share the same DOM-attribute contract (`[data-np-
block-row]`).

- **Roving keyboard navigation** — every block row Card is now a
  single keyboard tab stop with `tabIndex={0}` and a
  `data-np-block-row="<id>"` data attribute. The editor section
  intercepts ArrowUp / ArrowDown / Home / End and walks the
  `[data-np-block-row]` set in DOM order, so nested-container
  children flow naturally between their parent and the next
  top-level row. Arrow keys are skipped while focus sits on a
  text-entry surface (input / textarea / contenteditable) so
  caret movement still works inside prop fields.
- **Command menu (Cmd-K / Ctrl-K)** — opens a `Dialog`-based
  command palette filtered by substring. Context-sensitive: when
  a row is focused at the moment the menu opens, block-scoped
  actions (move up / move down / duplicate / delete, all
  targeting the focused row) appear under a "Block" group; the
  full Add-block list and "Edit page JSON" appear under "Add"
  and "Page". Built on the existing `Dialog` + `Input` primitives
  — no `cmdk` dependency, since the action set is small enough
  that a custom matcher keeps the bundle lean.
- **Container focus-within ring** — container blocks
  (`acceptsChildren: true`) get a `focus-within:ring-2
  focus-within:ring-primary/30` so operators can tell which
  subtree is focused while keyboard-navigating into a nested
  child. Leaf blocks just get the normal `focus-visible` ring on
  the row itself.

No wire-format changes. All a11y additions are additive — mouse
operators see no change beyond the focus-within ring on
containers (which only activates while a child is focused).
