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

Today every plugin admin UI is hand-coded:

- `@nexpress/plugin-forum` — forum settings
- `@nexpress/plugin-newsletter` — newsletter form blocks
- `@nexpress/plugin-oauth-github` / `-google` — provider config
- `@nexpress/plugin-reading-time` — settings
- ... 11 plugins total in repo

Plugin authors writing a new plugin face two costs the F.3
introspector eliminates for theme authors:

1. Write a React component for the admin settings UI.
2. Wire it into the admin shell via `adminExtensions`.

This doc proposes giving plugins the same "declare a zod
schema, get an admin form for free" path themes have.

## 1. Inventory of the surface

Existing plugins by config UI shape:

| Plugin | Has admin config? | Form complexity |
|---|---|---|
| forum | Yes (`/admin/forum/settings`) | Medium — categories list, moderator picker |
| block-callout | No (block props only) | n/a |
| block-embed | No (block props only) | n/a |
| block-latest-posts | No (block props only) | n/a |
| block-newsletter | Yes (provider keys) | Small — text + secret fields |
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
| D | Plugin can mix auto-form + custom panels | **Yes** | A plugin with mostly-simple config + one bespoke "test webhook" button stays partially auto-formed via `adminExtensions` overlay. |
| E | Settings persistence layer | **Drop `np_plugins.config`, store under `np_settings` with key `plugin.config:<id>`** | Repo is pre-1.0 / private — migrating now (data copy + column drop in one migration) trades ~150 LOC for permanent symmetry with theme settings (`theme.settings:<id>`), shared internal helpers (e.g. `getCachedSetting<T>(key)`), and matching function signatures (`getThemeSettings` ↔ `getPluginConfig`). After v1.0 this asymmetry would be locked in. `np_plugins` stays as a lean meta row (`id`, `enabled`, `last_seen`). |
| F | Versioned envelope (D from v0.3) | **Yes — same `__npVersion` / `__npSettings` shape** | Plugins deserve the same migration story themes got. |

## 3. Goals

- A new plugin author writes `configSchema: z.object({...})` and
  gets a working admin settings page at
  `/admin/plugins/<id>/settings` with no further code.
- Existing plugins migrate one at a time, each PR deleting
  their hand-coded UI and adding the schema.
- Plugin config reads + writes route through the same
  `getCachedPluginConfig` / `setPluginConfig` shape that
  themes use, including the v0.3 versioned envelope (D) and
  cache invalidation tag (`nx:plugin:<id>`).
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
  versioning + migration (lifted directly from
  `getThemeSettings`). Storage: `np_settings` row with key
  `plugin.config:<id>` (decision E).
- `setPluginConfig(pluginId, value, updatedBy?)` — write,
  validate, wrap in versioned envelope.
- `getCachedPluginConfig(pluginId)` — `unstable_cache` wrapper
  with tag `nx:plugin:<id>` (busted on save).

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

### 5.2 Phase G.2 — Migrate 5 small-shape plugins

Pilot the surface against simple plugins:

| Plugin | Schema |
|---|---|
| `reading-time` | `z.object({ wordsPerMinute: z.number().int().min(50).max(800).default(220) })` |
| `oauth-github` | `z.object({ clientId, clientSecret, scopes })` |
| `oauth-google` | same shape |
| `block-newsletter` | provider config |
| `seo-audit` | rule toggles (checkboxes) |

Each migration:
1. Add `configSchema` to the manifest
2. Delete the hand-coded admin UI component
3. Update tests to assert the auto-form renders the right
   fields

Doc the migration recipe in `docs/plugin-quickstart.md`.

### 5.3 Phase G.3 — Documented escape hatch for hybrid plugins

Plugins with mostly-simple config plus a bespoke panel
(e.g., forum's "test moderation rules" button) declare BOTH:

```ts
definePlugin({
  manifest: {
    id: "forum",
    configSchema: z.object({ ... }),
    // ...
  },
  admin: {
    settingsPanels: [
      // Custom panel rendered BELOW the auto-form
      { component: TestModerationButton, mountAfter: "auto-form" },
    ],
  },
});
```

Mount semantics: `auto-form` mounts the auto-generated form;
custom panels mount before/after via `mountAfter` /
`mountBefore` keyword. Order is deterministic (declaration
order wins on tied `mountAfter`).

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
4. **G.2 remaining plugins** — newsletter + seo-audit, one per
   PR.
5. **G.3 forum hybrid** — proves the auto-form + custom panel
   composition (the only `mountAfter: "auto-form"` consumer
   in the inventory).
6. **Docs** — update plugin-quickstart.md with the configSchema
   path, mark hand-coded UIs as legacy / opt-out.

Total: ~6 PRs, ~2050 LOC.

## 7. Cache + invalidation

New tag: `nx:plugin:<id>`. Read paths wrap in `unstable_cache`
with this tag; save paths bust it.

`cachedPluginFetch` (parallel to `cachedThemeFetch` from v0.3
H) — plugin route handlers can wrap their own data fetches
with the same per-key cache shape, auto-tagged with
`nx:plugin:<id>`. Out of scope for G.1; tracked as a follow-up.

## 8. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Plugin author needs a widget the F.3 introspector doesn't support (file upload, color picker, …) | 🟡 Medium | Phase G.3 escape hatch — declare `configSchema` for the parts that work, ship a custom panel for the rest |
| Sensitive fields (secrets, tokens) need masked input | 🟢 Resolved | G.1 adds `.meta({ sensitive: true })` to the F.3 introspector + form-renderer (~30 LOC). Locked answer Q1. |
| Plugin schema evolution leaves data behind | 🟢 Low | configMigrate / configVersion mirror theme settings v0.3 D — same migration story |
| Plugins that DON'T migrate look out of place next to migrated peers | 🟢 Low | Both surfaces work; admin lists "uses auto-form" / "custom panel" tag for transparency. Migration is incremental |
| `mountAfter` / `mountBefore` ordering becomes unwieldy with N panels | 🟢 Low | v0.3 plugin admin extensions today have at most 2-3 panels per plugin. Add named-slot mounting if a plugin grows past that |

## 9. Phasing

| Phase | Scope | PR-size estimate |
|---|---|---|
| **G.1** | Manifest fields + `getPluginConfig` + `np_plugins.config` → `np_settings` storage migration + `sensitive` widget hint + auto-form injection into existing plugin detail page | 1 PR, ~750 LOC |
| **G.2.1** | Pilot — `reading-time` migration | 1 PR, ~150 LOC |
| **G.2.2** | OAuth plugins (github + google together) — exercises the `sensitive` widget end-to-end | 1 PR, ~250 LOC |
| **G.2.3** | Newsletter + seo-audit | 1 PR, ~300 LOC |
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
   **Decision: lazy-on-read, mirroring v0.3 D's
   `getThemeSettings`**. First cold read after a plugin
   version bump runs `configMigrate(old, fromVersion)`,
   re-saves the result wrapped in the current envelope, and
   returns it. Migration failure throws → admin renders error
   card; framework keeps stale value in cache so the rest of
   the plugin keeps booting.
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
  <slug>` ships with an empty `configSchema: z.object({})` and
  an admin settings page that renders an empty form (no code
  needed).
- `reading-time` migration deletes its hand-coded UI and the
  admin settings page renders the same wordsPerMinute field
  via auto-form.
- Adding a new field to an existing plugin's `configSchema`
  surfaces in admin without an admin redeploy (plugin reload
  / process restart only).
- Operator opening `/admin/plugins/<id>/settings` for any
  configSchema-bearing plugin sees a form with field labels
  pulled from `.describe()` calls.
