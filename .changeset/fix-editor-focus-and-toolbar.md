---
"@nexpress/editor": minor
---

Two editor bugs fixed in one go.

**Focus loss on every keystroke.** `<LexicalComposer>` was being
re-keyed on the serialized editor value, so every onChange (i.e.
every keystroke) destroyed and recreated the entire editor —
losing DOM focus, the contenteditable selection, and undo
history. The composer now captures the initial editor state
once via `useState(() => …)` and never re-feeds the value prop,
matching how Lexical is meant to be controlled (typing flows
out via the OnChange plugin; the prop is only read at first
mount). Trade-off: external programmatic resets of the form
field won't propagate back into the editor — not a v1 use case
in this codebase. Wire a separate sync effect calling
`editor.setEditorState(…)` if it ever lands.

**Toolbar rendered as unstyled text buttons.** The toolbar
shipped with `np-toolbar*` class hooks but no matching CSS
anywhere, so operators saw a vertical stack of plain "Bold /
Italic / H1 …" text. Replaced with lucide icons + Tailwind
utility classes that compile through the host app's `@source`
glob (no extra CSS file shipped from `@nexpress/editor`).
Buttons gain `aria-label`, `title`, and `aria-pressed` so the
icon-only UI stays screen-reader-correct. The Insert Image
dialog also got a Tailwind facelift — was using a separate
batch of unstyled `np-toolbar-dialog*` classes.

`@nexpress/editor` adds `lucide-react ^1.8.0` as a direct
dependency to keep the editor self-contained.
