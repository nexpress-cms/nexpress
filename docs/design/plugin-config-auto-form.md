# Plugin Config Auto-Form — Design Plan

> Version: 0.2 (Locked — ready for implementation)
> Date: 2026-05-09
> Status: Decisions locked. G.1 ready to implement.
> Prerequisites:
>   - F.3 introspector (`packages/core/src/themes/settings-schema.ts`)
>     — already shipping for theme settings
>   - `docs/plugin-manifest.md` (existing plugin manifest contract)
>   - `docs/plugin-quickstart.md` (existing plugin author surface)

---

## 0. Position statement

F.3 (theme settings auto-form) shipped a zod-to-form
introspector in v0.2 that turns a `z.object({...})` schema
into admin form metadata + UI without theme authors writing a
form themselves. The same infrastructure exists, sits unused,
for plugins.

Today plugins declare admin settings through
`PluginAdminExtension` (in `packages/core/src/plugins/host.ts`):

```ts
definePlugin({
  // ...
  admin: {
    settings: {
      title?, description?,
      fields: NpFieldConfig[],   // hand-rolled field list
    },
    // also: widgets, actions, tables, collectionTabs, dashboardWidgets
  },
});
```

The `fields: NpFieldConfig[]` shape is declarative (no React),
but plugin authors must spell out each field config by hand —
field name, type, label, validation rules, description, etc. —
duplicating what a `z.object({...})` schema already encodes.
Zod schemas are the canonical source of TYPE for plugin code
that reads its own config; the hand-rolled `NpFieldConfig[]`
is a parallel description used only by the admin form.

This doc proposes giving plugin authors the same "declare a
zod schema, get an admin form for free" path themes already
have via F.3. Plugins keep `PluginAdminExtension` for the
parts the introspector can't represent (status widgets,
imperative actions like "test webhook", custom tables); the
`fields` part of `admin.settings` becomes a one-or-the-other
choice with `manifest.configSchema` (see § 5.1.1).

Inventory: 11 plugins in repo, 8 with admin settings. See § 1.

## 1. Inventory of the surface

Existing plugins by config UI shape:

| Plugin | Has admin config? | Form complexity |
|---|---|---|
| forum | Yes (`/admin/forum/settings`) | Medium — categories list, moderator picker |
| block-callout | No (block props only) | n/a |
| block-embed | No (block props only) | n/a |
| block-latest-posts | No (block props only) | n/a |
| block-newsletter | No (block-only — per-instance `propsSchema`) | n/a (revised after code inspection) |
| block-pricing | No (block props only) | n/a |
| block-stats | No | n/a |
| oauth-github | Yes | Small — client id + secret + scopes |
| oauth-google | Yes | Small — client id + secret + scopes |
| reading-time | Yes (read speed) | Tiny — single number field |
| seo-audit | Yes (rule toggles) | Medium — checkbox grid |

Eight of eleven plugins have an admin config UI; six are
small-to-medium shapes that map cleanly to F.3's introspector
output (text / number / boolean / enum / array of objects).

## 2. Locked decisions (final)

Locked 2026-05-09. See § 11 for the four open-question answers
that fed into these.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| A | Plugin manifest gains optional `configSchema` field | **Yes** | The whole point of the project. |
| B | Existing hand-coded plugin UIs work unchanged | **Yes** | Migration is per-plugin, not forced. Plugins that opt in delete their hand-coded UI; ones that don't keep theirs. |
| C | Auto-form supports the same widget set as theme F.3 + new `sensitive` hint | **Yes** | Reuse the `NpThemeSettingsField` introspector verbatim. G.1 also adds `.meta({ sensitive: true })` → `<Input type="password">` so G.2.2 oauth migrations don't carry the introspector change. |
| D | Plugin can mix auto-form + custom panels | **Yes — via a G.3-defined slot in `PluginAdminExtension`** | A plugin with mostly-simple config + one bespoke "test webhook" button stays partially auto-formed. The exact slot shape is locked at G.3 entry, not now (see § 5.3). |
| E | Settings persistence layer | **Drop `np_plugins.config`, store under `np_settings` with key `plugin.config:<id>`** | Repo is pre-1.0 / private — migrating now (data copy + column drop in one migration) trades ~150 LOC for permanent symmetry with theme settings (`theme.settings:<id>`), shared internal helpers (e.g. `getCachedSetting<T>(key)`), and matching function signatures (`getThemeSettings` ↔ `getPluginConfig`). After v1.0 this asymmetry would be locked in. `np_plugins` stays as a lean meta row (`id`, `enabled`, `last_seen`). |
| F | Versioned envelope (D from v0.3) | **Yes — same `__npVersion` / `__npSettings` shape** | Plugins deserve the same migration story themes got. |

## 3. Goals

- A new plugin author writes `configSchema: z.object({...})` and
  gets a working admin settings form rendered into the existing
  `/admin/plugins/[pluginId]` detail page with no further code.
- Existing plugins migrate one at a time, each PR deleting
  their hand-coded UI and adding the schema.
- Plugin config reads + writes route through the same
  `getCachedPluginConfig` / `setPluginConfig` shape that
  themes use, including the v0.3 versioned envelope (D) and
  cache invalidation tag (`np:plugin:<id>`).
- The auto-form surface in admin reuses
  `packages/admin/src/zod-form/` (already F.3-ready) — no new
  form-renderer code.

## 4. Non-goals

- Letting plugins skip declaring an admin route entirely (yes,
  plugins still appear under `/admin/plugins/<id>` — that's
  the admin's plugin index UX).
- Migrating theme settings to merge with plugin config storage.
  Themes and plugins are different lifecycles; separate keys.
- Replacing the `definePlugin().admin` extension API. Plugins
  with bespoke UIs (test buttons, file uploaders) keep using
  it for the bespoke parts.
- Sandbox / capability scoping for what config a plugin can
  read. That's plugin v2 (per `docs/roadmap.md` category 4).

## 5. Contract additions

Three phases, each adding optional fields to the plugin
manifest. Existing plugins work unchanged.

### 5.1 Phase G.1 — `manifest.configSchema` + auto-form injection

Adds three manifest fields:

```ts
interface NpPluginManifest {
  // ... existing fields ...

  /**
   * Zod schema for operator-tunable plugin config. When
   * present, the framework injects an auto-generated form into
   * the existing `/admin/plugins/<id>` page using the same
   * introspector the theme contract uses (F.3). Plugin author
   * doesn't write a form component.
   *
   * Defaults: `.default()` on each field becomes the form's
   * initial value AND the value `getPluginConfig(id)` returns
   * before the operator's first save.
   *
   * Use `.describe()` for the field's label / help text.
   * Use `.meta({ sensitive: true })` to render `<input
   * type="password">` (added in G.1 — used by oauth client
   * secrets, etc.).
   */
  configSchema?: unknown; // typed as unknown for the same
                          // reason theme settingsSchema is —
                          // avoids forcing zod into the public
                          // surface; framework narrows at the
                          // call site

  /**
   * v0.3 D pattern reused — operator settings persist in a
   * versioned envelope. Bump when configSchema changes shape
   * non-additively.
   */
  configVersion?: number;

  /**
   * Migrate a v(N-1) value to the current shape. Same
   * contract as theme `settingsMigrate` (v0.3 D). Runs lazily
   * on first cold read after a plugin version bump.
   */
  configMigrate?: (old: unknown, fromVersion: number) => unknown;
}
```

Framework implementations:

- `getPluginConfig(pluginId): Promise<unknown>` — read with
  versioning + lazy migration. Mirrors `getThemeSettings`
  exactly, including its defensive try/catch and parse-fallback
  semantics (locked answer Q3). Storage: `np_settings` row
  with key `plugin.config:<id>` (decision E).
- `getPluginConfigWithStatus(pluginId): Promise<NpPluginConfigResult>`
  — same read with `{ value, hasPersisted, parseError? }` shape.
  Mirror of `getThemeSettingsWithStatus`. Admin uses this to
  render a "settings were reset" banner when the migrator
  threw or the post-migrate value failed `safeParse`.
- `setPluginConfig(pluginId, value, updatedBy?)` — write,
  validate, wrap in versioned envelope.
- `getCachedPluginConfig(pluginId)` — `unstable_cache` wrapper
  with tag `np:plugin:<id>` (busted on save).

The existing `/admin/plugins/[pluginId]/page.tsx` (single-page
detail view) gains a `configFields` prop on `<PluginAdminPage>`.
When the manifest declares `configSchema`, the framework
introspects it and passes the field metadata; the page renders
the auto-form above the existing custom-panel slot. No new
URL — locked answer Q2.

Storage migration (decision E): one Drizzle migration moves
existing `np_plugins.config` jsonb into `np_settings` rows
(`key = 'plugin.config:<id>'`, value wrapped in the v1
versioned envelope), then drops the column. Post-migration,
`np_plugins` is a lean `(id, enabled, last_seen)` meta row.
`getPluginState` / `updatePluginState` lose the `config`
field; callers either move to `getPluginConfig` /
`setPluginConfig` or stop reading config entirely (state is
just the enable flag).

#### 5.1.1 `configSchema` vs existing `admin.settings.fields`

Both are declarative settings sources. The two paths
**coexist without conflict** because they answer different
questions:

| Source | Lives on | Purpose |
|---|---|---|
| `manifest.configSchema` (new) | manifest (boot-time) | Validation + storage shape + zod-driven auto-form |
| `admin.settings.fields` (existing) | runtime `PluginAdminExtension` | Hand-rolled field list for the admin form only |

Precedence in the admin renderer (locked):

1. **If `manifest.configSchema` is declared** — admin renders
   the auto-form from the introspected schema. Any
   `admin.settings.fields` on the same plugin is **ignored
   for rendering** and the plugin detail page emits a console
   warning naming both sources. The schema is the single
   source of truth; the `fields` array is dead code waiting
   to be deleted.
2. **If only `admin.settings.fields` is declared** — admin
   keeps rendering the legacy field list as it does today.
   No behavior change for unmigrated plugins.
3. **If neither is declared** — admin shows no settings
   section (current empty-state).

G.2 migration recipe consequence: each migration PR removes
the plugin's `admin.settings.fields` (or sets it to `[]`)
in the same diff that adds `manifest.configSchema`, so the
warning never surfaces in production. This is the "delete the
hand-coded admin UI" step in § 5.2.

The `admin.settings.fields` API itself stays on the public
surface for v0.x — plugins not yet migrated keep working,
and authors who legitimately need a non-zod path (rare) keep
it as an option. We do NOT plan to delete the legacy path
inside the G-track; that's a v1.0 cleanup.

### 5.2 Phase G.2 — Migrate 5 small-shape plugins

Pilot the surface against simple plugins:

| Plugin | Schema |
|---|---|
| `reading-time` | `z.object({ wordsPerMinute: z.number().int().min(50).max(800).default(220) })` |
| `oauth-github` | `z.object({ clientId, clientSecret, scopes })` |
| `oauth-google` | same shape |
| ~~`block-newsletter`~~ | _Removed during G.2.3 — code inspection showed the plugin is block-only with per-instance `propsSchema`. No plugin-global config to migrate._ |
| `seo-audit` | `z.object({ titleMin: z.number().int().min(0).max(200).default(30), titleMax: z.number().int().min(10).max(300).default(60), descriptionMin / Max, minBodyWords: z.number().default(250), includeDescription: z.boolean().default(true) })` |

Each migration:
1. Add `configSchema` to the manifest
2. Delete the hand-coded admin UI component
3. Update tests to assert the auto-form renders the right
   fields

Doc the migration recipe in `docs/plugin-quickstart.md`.

### 5.3 Phase G.3 — Documented escape hatch for hybrid plugins

> **G.3 contract is sketch-only in this doc.** The exact
> shape (new `admin.settings.panels` array? extend the
> existing `admin.actions` slot?) is NOT locked. G.3 starts
> with its own decision-locking pass, the same way G.1 did.
> Listed here only so reviewers see the intent.

Use case: plugins with mostly-simple config plus a bespoke
imperative panel — e.g., forum's "test moderation rules"
button, or oauth's "verify credentials" round-trip.

Sketch — actual API will be locked at the start of G.3:

```ts
// SKETCH — not a current API surface
definePlugin({
  manifest: {
    id: "forum",
    configSchema: z.object({ ... }),
    // ...
  },
  admin: {
    settings: { fields: [] },          // legacy field list left empty
    // a NEW slot to be added in G.3 — name TBD:
    customPanels: [
      { component: TestModerationButton, mountAfter: "auto-form" },
    ],
  },
});
```

Mount keyword space (locked answer Q4): G.1 ships
`"auto-form"` only. No other slot keywords (`top` / `bottom`
/ `mountBefore`) are reserved. G.3 may add more — and lock
them at G.3 entry — if a plugin's needs require it; today
only `forum` is on the inventory and a single `auto-form`
anchor covers its case.

## 6. Reference implementation plan

Sequence:

1. **G.1 framework** — manifest fields, `getPluginConfig` etc.,
   `np_plugins.config` → `np_settings` storage migration,
   `sensitive` widget hint, auto-form injection into existing
   plugin detail page. ~750 LOC (was ~600 — +150 for the
   storage migration per locked decision E, baseline already
   includes the `sensitive` widget per locked answer Q1).
2. **G.2 reading-time pilot** — smallest plugin, single field.
   Validates the path end-to-end. ~150 LOC (mostly DELETE of
   the hand-coded UI).
3. **G.2 oauth-github + oauth-google** — proves the
   `sensitive` widget end-to-end (clientSecret masked). One
   PR for both since they share the schema shape.
4. **G.2 remaining plugins** — seo-audit only (newsletter dropped
   per § 1 inventory revision).
5. **G.3 forum hybrid** — proves the auto-form + custom panel
   composition (the only `mountAfter: "auto-form"` consumer
   in the inventory).
6. **Docs** — update plugin-quickstart.md with the configSchema
   path, mark hand-coded UIs as legacy / opt-out.

Total: 6 PRs, ~2050 LOC.

## 7. Cache + invalidation

New tag: `np:plugin:<id>`. Read paths wrap in `unstable_cache`
with this tag; save paths bust it.

`cachedPluginFetch` (parallel to `cachedThemeFetch` from v0.3
H) — plugin route handlers can wrap their own data fetches
with the same per-key cache shape, auto-tagged with
`np:plugin:<id>`. Out of scope for G.1; tracked as a follow-up.

> **Prefix note.** Per the framework's owned-identifier policy
> (CLAUDE.md "Naming convention"), every new framework-owned
> tag uses the `np` prefix, including this one. The legacy
> `nx:theme:<siteId>` tag in `packages/core/src/themes/settings.ts`
> predates the prefix migration and is **not** the convention
> for new surfaces; G-track does not extend the `nx:` namespace.
> Renaming the legacy theme tag is a separate cleanup and is
> not bundled into G.1 to keep the storage migration focused.

## 8. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Plugin author needs a widget the F.3 introspector doesn't support (file upload, color picker, …) | 🟡 Medium | Phase G.3 escape hatch — declare `configSchema` for the parts that work, ship a custom panel for the rest |
| Sensitive fields (secrets, tokens) need masked input | 🟢 Resolved | G.1 adds `.meta({ sensitive: true })` to the F.3 introspector + form-renderer (~30 LOC). Locked answer Q1. |
| Plugin schema evolution leaves data behind | 🟢 Low | configMigrate / configVersion mirror theme settings v0.3 D — same migration story |
| Plugins that DON'T migrate look out of place next to migrated peers | 🟢 Low | Both surfaces work; admin lists "uses auto-form" / "custom panel" tag for transparency. Migration is incremental |
| Mount-keyword vocabulary grows unwieldy past G.3 | 🟢 Low | G.1 ships only `"auto-form"` (locked answer Q4). G.3 locks any additional keywords at its own entry. Plugin admin extensions today have ≤2-3 panels per plugin, so a small named-slot vocabulary suffices |

## 9. Phasing

| Phase | Scope | PR-size estimate |
|---|---|---|
| **G.1** | Manifest fields (`configSchema` / `configVersion` / `configMigrate`); `getPluginConfig` + `getPluginConfigWithStatus` + `setPluginConfig` + `getCachedPluginConfig`; `np_plugins.config` → `np_settings` storage migration; `sensitive` widget hint; auto-form injection into the existing plugin detail page | 1 PR, ~750 LOC |
| **G.2.1** | Pilot — `reading-time` migration | 1 PR, ~150 LOC |
| **G.2.2** | OAuth plugins (github + google together) — exercises the `sensitive` widget end-to-end | 1 PR, ~250 LOC |
| **G.2.3** | seo-audit (newsletter dropped — block-only, no plugin config) | 1 PR, ~300 LOC |
| **G.3** | Hybrid composition (forum) | 1 PR, ~400 LOC |
| **G.docs** | plugin-quickstart.md + plugin-manifest.md updates | 1 PR, ~200 LOC |

Total: 6 PRs, ~2050 LOC. G.1 unblocks all subsequent phases.

## 10. Deferred (recorded, not abandoned)

- **`cachedPluginFetch` helper** — plugin parallel to v0.3 H's
  `cachedThemeFetch`. Trivial implementation once the tag
  exists, but no plugin currently needs it badly enough to
  bundle into G.1.
- **Plugin discovery + install UI** — listing available config
  fields on the marketplace before install. Roadmap category 9
  (plugin marketplace).
- **Cross-plugin config dependencies** — plugin A's config
  depending on plugin B being installed. Not needed for the
  current 11 plugins; would constrain phase G.1 if added now.
- **Per-site plugin config** — today plugin config is
  site-scoped via `np_settings`. The discriminator only matters
  if multi-site sites want different per-site config. Already
  works via existing siteId filter.
- **Introspector `.refine()` passthrough** — surfaced in G.2.3
  while writing the seo-audit schema. Cross-field constraints
  (e.g. `titleMin <= titleMax`) naturally live as `.refine()` on
  the outer `z.object`, but the F.3 introspector's `unwrap()`
  only handles `default / optional / nullable` wrappers. Adding
  `.refine()` turns the schema into a refine/effects/pipe wrapper
  whose `_def.type` isn't `"object"`, so the introspector returns
  an empty field list and the form renders blank. Needs an
  additional unwrap step that walks past refine wrappers and
  reads the inner object's shape. ~20 LOC in
  `packages/core/src/themes/settings-schema.ts`. Plugins that
  want cross-field validation today have to re-parse the raw
  config in their `setup()` — out-of-band check.
- **Introspector `array(string)` support** — surfaced in G.2.2
  while writing oauth schemas. Plugin scopes are
  `z.array(z.string())`, but the introspector currently only
  handles `array(object)` — emits `unsupported`. Operators can't
  edit oauth scopes via the form today. ~15 LOC follow-up.

## 11. Locked answers

Locked 2026-05-09 alongside § 2.

1. **`.meta({ sensitive: true })` for secret fields** — F.3's
   introspector today supports `text / textarea / url / color
   / number / boolean / enum / object / array / unsupported`
   only (`packages/core/src/themes/settings-schema.ts` widget
   matrix). **Decision: G.1 adds `sensitive` as a `.meta()`
   hint** → introspector emits `{ type: "password" }`,
   form-renderer dispatches to `<Input type="password">`.
   ~30 LOC. Done in G.1 so G.2.2 oauth migrations stay
   single-concern.
2. **Plugin admin route ownership** — today
   `/admin/plugins/[pluginId]/page.tsx` is a single-page
   detail view (87 LOC, no tabs, no `/settings` sub-route).
   **Decision: do NOT add `/admin/plugins/<id>/settings`.
   Inject the auto-form into the existing detail page**.
   `<PluginAdminPage>` gains a `configFields` prop; auto-form
   mounts above the custom panel slot. Plugins without
   `configSchema` see no auto-form section, no dead route.
3. **`configMigrate` semantics across plugin versions** —
   **Decision: match `getThemeSettings` exactly, including
   its actual error-handling shape** (verified against
   `packages/core/src/themes/settings.ts` `applyMigration` +
   `getThemeSettingsWithStatus`). On a read where the stored
   `__npVersion` is below `manifest.configVersion`:
   1. Run `configMigrate(rawValue, fromVersion)` inside a
      defensive `try / catch`. A throwing migrator falls back
      to the original `rawValue` (not stale cache, not error
      card).
   2. `safeParse` the result against the current
      `configSchema`. On parse success, return the parsed
      value.
   3. On parse failure (buggy migrator, schema drift the
      migrator didn't cover), return schema defaults with
      `parseError` surfaced via the status variant
      (`getPluginConfigWithStatus`) so the admin can render a
      "settings were reset" banner.
   The read path **does not re-save** the migrated value —
   themes don't either. Persistence happens only on the next
   operator save through `setPluginConfig`.
4. **Custom panel `mountAfter` keyword space** — **Decision:
   G.1 ships `"auto-form"` only**. `"top"` / `"bottom"` are
   not reserved — defining slot keywords without a real
   consumer is self-imposed cost. Add them when a hybrid
   plugin that needs them appears (currently only `forum`
   in G.3, and it uses `auto-form` alone).

## 12. NOT in scope (record so it doesn't creep)

- Renaming `definePlugin().admin` to `definePlugin().settings`.
  The existing API field stays.
- Letting plugin authors define new field-config types beyond
  what F.3 supports. Field-type vocabulary is framework-owned.
- Sandbox enforcement of what config a plugin can read. Plugin
  v2 territory.
- Auto-migrating existing hand-coded UIs. Each plugin opts in
  per its own PR.

## 13. Success criteria

- A new plugin scaffolded via `nexpress create hook-plugin
  <slug>` ships with an empty `configSchema: z.object({})`;
  opening `/admin/plugins/[pluginId]` shows the auto-form
  region rendering an empty form (no code needed).
- `reading-time` migration deletes its hand-coded UI and the
  admin settings page renders the same wordsPerMinute field
  via auto-form.
- Adding a new field to an existing plugin's `configSchema`
  surfaces in admin without an admin redeploy (plugin reload
  / process restart only).
- Operator opening `/admin/plugins/[pluginId]` for any
  configSchema-bearing plugin sees a form (above any custom
  panel) with field labels pulled from `.describe()` calls.
