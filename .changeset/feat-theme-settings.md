---
"@nexpress/core": minor
"@nexpress/next": minor
"@nexpress/admin": minor
"@nexpress/web": patch
---

**Phase F.3 — `manifest.settingsSchema` + admin auto-form: operator-tunable theme options.**

Third implementation phase of the v0.2 theme contract extension
(see `docs/design/theme-v0.2-extension.md` §4.3). Themes can now
expose Zod-described operator settings; the admin renders the
form fields automatically. Closes the no-code-customization
loop for theme-shipped variants like "hero style", "show
byline", or "newsletter signup URL".

### Surface added

#### `@nexpress/core`

- `NpThemeManifest.settingsSchema?: unknown` — typed loose
  (theme authors construct via `z.object({...})` and get full
  Zod inference at the call site; framework narrows back to
  `ZodTypeAny` at introspection / validation).
- `getThemeSettings(themeId?)` — read parsed settings; defaults
  to active theme.
- `getThemeSettingsWithStatus(themeId?)` — same plus `hasPersisted`
  + `parseError` so admin can show "settings reset" banners
  when the persisted value fails the current schema.
- `setThemeSettings(themeId, value, updatedBy?)` — validates
  via the schema, writes the row, returns the parsed value.
  Throws `NpValidationError` on failure with field-level issues.
- `introspectThemeSettingsSchema(schema)` — server-side walker
  that emits JSON form metadata.
- `NpThemeSettingsField` (and per-type variants) — the metadata
  shape the admin consumes. Browser doesn't need zod at runtime.
- `activeThemeContributesSeo()` — structural check on
  `impl.seo`. The settings save path uses this to decide
  whether to additionally bust `nx:sitemap:*` / `nx:feed:*` tags.

#### `@nexpress/next`

- `getCachedThemeSettings(themeId?)` — `unstable_cache` wrapper
  that reuses the existing `nx:theme:<siteId>` tag (shared with
  tokens + active theme id). Per design doc §5.3 — settings
  read on the same paths as tokens, so a shared bust avoids
  fragmenting the tag namespace.

#### `apps/web`

- `GET/PUT /api/admin/themes/[id]/settings` — list returns
  `{ fields, value, hasPersisted, parseError }`; PUT validates
  + persists + invalidates `nx:theme:<siteId>` (and SEO tags
  when the active theme declares `impl.seo`).
- Theme settings page now renders the new `ThemeSettingsPanel`
  below the existing `ThemeEditor` (token editor).

#### `@nexpress/admin`

- `packages/admin/src/zod-form/` — generic auto-form generator
  consumed by the theme settings panel. Same primitive will
  serve plugin config UIs in a follow-up.
- `ThemeSettingsPanel` — fetches schema + value, renders
  `ZodForm`, PUTs on save. Shows the "schema mismatch reset"
  banner when `parseError` is set.

### Field type coverage (v0.2 initial)

| Zod type | Auto-form widget |
|----------|------------------|
| `z.string()` | text input |
| `z.string().url()` | URL input |
| `z.string().regex(/^#[0-9a-f]{6}$/i)` | color picker (heuristic) |
| `z.number().int().min().max()` | number input with range |
| `z.boolean()` | toggle |
| `z.enum([...])` | select |
| `z.object({...})` | nested fieldset |
| `z.array(z.object({...}))` | repeating subform |

`.default(value)` and `.describe("...")` are honored. Anything
else introspects as `unsupported` and falls back to a JSON
textarea (operator can still edit; coverage widens in a
follow-up).

### Storage

`np_settings` row at `(siteId, "theme.settings:<themeId>")`,
value JSONB. Coexists with the v0.1 `theme` (tokens) and
`activeTheme` rows; per design doc §4.3 coexistence table.

### Cache invalidation

- Reuses existing `nx:theme:<siteId>` tag on every save
  (settings live on the same read paths as tokens — splitting
  the tag would force two evictions on every change).
- Additionally busts `nx:sitemap:<siteId>` + `nx:feed:<siteId>`
  when `activeThemeContributesSeo()` returns true.

### Schema evolution

v0.2 ships strict `parse()`. Mismatch → returns schema defaults
+ surfaces `parseError` so admin shows a "settings reset"
banner. Migration helpers (`migrate(old, fromVersion)`)
deferred to v0.3 unless F.9 reference rebuild surfaces real
demand.

### Tests

15 unit tests covering: empty / non-object schema, text, url,
color (regex heuristic), number constraints, boolean, enum
options, default value capture, optional → required:false,
description capture, nested object, array of objects, plus
two unsupported-type fallbacks (string-array, date).

Total core tests: 306 (was 291).

### What's not in this phase

- Plugin config auto-form migration — F.3 builds the
  zod-to-form primitive in `@nexpress/admin/zod-form`; plugins
  keep their hand-coded config UIs until a follow-up migrates
  them. (Already recorded in design doc §10.)
- `migrate(old, fromVersion)` schema-evolution helpers — v0.3
  candidate.
- Type-narrowing the form value at submit — v0.2 PUTs the raw
  draft and lets the server re-validate. Client-side validation
  before submit is a polish pass.
