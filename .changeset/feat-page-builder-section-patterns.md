---
"@nexpress/admin": minor
---

Page builder section patterns (#467, "Section patterns / reusable block groups").

Ninth and final PR off the #467 phase 2-4 queue. The editor
gains a "patterns" surface — pre-shaped block subtrees the
operator can drop into a page in one click — plus a save-as-
pattern flow so custom compositions persist across sessions.

`@nexpress/admin/src/blocks/patterns.ts` — new module:

- `NpPattern` type: `{ id, label, description?, source:
  "built-in" | "custom", blocks: NpBlockInstance[] }`.
- `getBuiltInPatterns()` ships three defaults: **Landing
  hero**, **FAQ section**, **Pricing section**.
- `getCustomPatterns()` / `saveCustomPattern()` /
  `deleteCustomPattern()` persist user-saved patterns in
  `localStorage` (`np-page-builder.custom-patterns`).

Block reducer:

- New `INSERT_PATTERN { pattern, parentId? }` action.
  Re-ids every block in the pattern via `cloneBlockDeep` so
  each insertion is independent. Filters unknown types
  defensively (a saved pattern might outlive a plugin that
  contributed one of its blocks).

Cmd-K command menu:

- "Insert pattern: <label>" actions for built-ins + custom
  patterns under a new **Pattern** group (between Block
  actions and Add block).
- "Save <focused block> as pattern" — prompts for a label,
  serializes the focused row's subtree, persists to
  localStorage, and surfaces immediately in the same session.

Backward compatible. No wire-format changes for saved pages.
Patterns are an admin-only authoring affordance; the wire is
the same `NpBlockInstance[]` the rest of the editor speaks.
