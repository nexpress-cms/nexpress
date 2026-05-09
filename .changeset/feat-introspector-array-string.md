---
"@nexpress/core": minor
"@nexpress/admin": minor
"@nexpress/plugin-oauth-github": patch
"@nexpress/plugin-oauth-google": patch
---

feat(core, admin): introspector — `z.array(z.string())` support, dedicated `string-array` widget

Closes the G-track follow-up tracked in `docs/design/plugin-config-auto-form.md` § 10. `z.array(z.string())` schemas (e.g., OAuth scopes, category allowlists) previously fell through to the `unsupported` JSON-textarea fallback — operators had to type literal JSON like `["read:user","user:email"]` to edit them.

This release wires a typed widget through the F.3 / G.1 introspector + form-renderer:

**Schema introspection** (`packages/core/src/themes/settings-schema.ts`):
- New `NpThemeSettingsStringArrayField` type (`{ type: "string-array" }`) added to the `NpThemeSettingsField` union.
- `introspectField`'s `array` branch now discriminates on element type — `z.array(z.object(...))` keeps emitting the existing typed-row form (`type: "array"`); `z.array(z.string())` emits `type: "string-array"`. Other element types (`z.array(z.number())`, nested arrays) still fall through to `unsupported`.

**Form renderer** (`packages/admin/src/zod-form/form-renderer.tsx`):
- New `StringArrayField` component renders a `<textarea>` with one item per line. Lines are trimmed + non-empty-filtered on commit so trailing returns / whitespace don't introduce blank entries.

**OAuth README updates** (`@nexpress/plugin-oauth-github` / `oauth-google`):
- "Scopes are not yet editable in the auto-form" callout removed. Scopes table row now shows the editable `one item per line` widget with the actual default values.

3 new unit tests cover the discriminator (string-array, object-array, unrecognized fallback). 364 core tests pass; existing test "returns unsupported for non-object array element" updated to use `z.array(z.array(...))` since `z.array(z.string())` is now supported.

Verified: `pnpm typecheck` (58/58), `pnpm build` (31/31).
