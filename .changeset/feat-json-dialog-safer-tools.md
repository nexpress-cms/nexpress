---
"@nexpress/admin": minor
---

Page builder JSON dialogs — safer tools (#467, "Safer advanced JSON tools").

Both the per-block and page-level JSON editors gain a small toolbar
+ stronger guards before Apply. Pulled from the #467 phase-1.5
queue — JSON apply is the most destructive operator action, so the
safety net here matters more than anywhere else in the editor.

Per-block JSON dialog:

- **Format** button — pretty-prints the current textarea via
  `JSON.parse` + `JSON.stringify(_, null, 2)`. Surfaces parse
  errors inline.
- **Copy** button — writes the current text to the clipboard with
  a transient "Copied!" label. Silent on Clipboard-API failure;
  operators can fall back to select-all + Cmd-C.
- **Schema lint** — when the block's `propsSchema` is registered,
  Apply runs a soft lint pass that warns on missing `required`
  keys and unknown keys (the row UI already flagged "unknown
  block type" — this catches bad keys *inside* a known block).
  Warnings don't block Apply; they surface as an amber banner
  the operator can act on.

Page-level JSON dialog:

- **Format / Copy** — same shape as the per-block dialog.
- **Import as new blocks** toggle — when on, Apply appends the
  validated input to the current tree with fresh ids (recursive,
  including nested children) instead of replacing the tree. Lets
  operators paste a section from another page without nuking the
  current one.
- **Apply preview** — Apply now goes through a two-stage flow:
  click Preview to see "{before} → {after} blocks (+added /
  −removed / ~modified)" plus the active mode (Replace vs.
  Import-as-new), then click Confirm apply to commit. Stage 2
  is intentionally a separate click — the diff makes it cheap
  to spot a paste that's about to overwrite work.

Backward compatible: dialog wire format unchanged, Apply still
dispatches the same RESET / REPLACE_PROPS reducer actions.
