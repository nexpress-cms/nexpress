---
"@nexpress/admin": patch
---

**Auto-form (zod) — closes #599 + #603.**

Two correctness bugs in the settings / plugin-config auto-form
renderer (`packages/admin/src/zod-form/form-renderer.tsx`).
Both surfaced in the G-track but were trigger-driven enough
to ride the post-v0.1 follow-up queue. Easy to batch.

**#599 — string-array editor lost newlines while typing.**
`StringArrayField` parsed the textarea on every `onChange`
(split → trim → drop-empty) and immediately re-controlled the
textarea via `items.join("\n")`. Pressing Enter created a
transient blank line that the controlled re-render erased
before the next character could land — multi-line entries were
effectively impossible.

Fix: keep a local `draft: string | null` state. While the
operator is mid-edit, the textarea owns its content verbatim
(including trailing blanks); on `onBlur` we parse and emit
the array, then reset `draft` to null so external resets take
effect. Display value falls back to the parsed-from-value
joined string when `draft === null`, so a parent re-render
with a different value still updates the textarea when no
edit is pending.

Affected fields: OAuth scopes (`@nexpress/plugin-oauth-*`),
any plugin / theme schema using `z.array(z.string())`.

**#603 — optional text-like fields submitted `""` instead of
`undefined` on clear.** Text / textarea / password / url /
color fields all passed `onChange(e.target.value)` directly,
sending an empty string when the operator cleared the input.
Optional zod schemas (`z.string().url().optional()`,
`z.string().regex(...).optional()`) generally treat `""` as
present-but-invalid rather than absent — so clearing an
optional URL hit "Invalid URL" instead of being accepted.

Fix: extract a `commitText(raw, required)` helper that mirrors
`NumberField`'s empty-→-undefined treatment. When the field is
NOT required, clearing sends `undefined`; required fields keep
the empty-string behavior so `min(1)` / `required_error`
surfaces correctly. Color's twin-input (picker + text input)
gets the same treatment — operators clear via the text box.

No new tests — the `zod-form/` directory has no test suite
today; behavior is exercised by the admin's settings flow
end-to-end and the existing G-track integration tests.
Manual smoke: type multi-line OAuth scopes (newlines persist
while typing, normalize on blur); clear an optional URL field
(no "Invalid URL" error).
