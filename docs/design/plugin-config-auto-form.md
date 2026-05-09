# Plugin Config Auto-Form — Design Plan

> Version: 0.1 (Draft — design phase)
> Date: 2026-05-09
> Status: Design — pending review and decision-locking
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

## 2. Locked decisions (proposed)

To be confirmed before implementation.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| A | Plugin manifest gains optional `configSchema` field | **Yes** | The whole point of the project. |
| B | Existing hand-coded plugin UIs work unchanged | **Yes** | Migration is per-plugin, not forced. Plugins that opt in delete their hand-coded UI; ones that don't keep theirs. |
| C | Auto-form supports the same widget set as theme F.3 | **Yes** | Reuse the existing `NpThemeSettingsField` introspector verbatim — rename if the type now serves both is misleading, but keep the surface single-implementation. |
| D | Plugin can mix auto-form + custom panels | **Yes** | A plugin with mostly-simple config + one bespoke "test webhook" button stays partially auto-formed via `adminExtensions` overlay. |
| E | Settings persistence layer | **Reuse `np_settings`** with key `plugin.config:<id>` | Mirrors theme settings (`theme.settings:<id>`); avoids new table. |
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

### 5.1 Phase G.1 — `manifest.configSchema` + auto-form route

Adds two manifest fields:

```ts
interface NpPluginManifest {
  // ... existing fields ...

  /**
   * Zod schema for operator-tunable plugin config. When
   * present, the framework auto-generates a settings page at
   * `/admin/plugins/<id>/settings` using the same introspector
   * the theme contract uses (F.3). Plugin author doesn't
   * write a form component.
   *
   * Defaults: `.default()` on each field becomes the form's
   * initial value AND the value `getPluginConfig(id)` returns
   * before the operator's first save.
   *
   * Use `.describe()` for the field's label / help text.
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
   * contract as theme `settingsMigrate` (v0.3 D).
   */
  configMigrate?: (old: unknown, fromVersion: number) => unknown;
}
```

Framework implementations:

- `getPluginConfig(pluginId): Promise<unknown>` — read with
  versioning + migration (lifted directly from
  `getThemeSettings`).
- `setPluginConfig(pluginId, value, updatedBy?)` — write,
  validate, wrap in versioned envelope.
- `getCachedPluginConfig(pluginId)` — `unstable_cache` wrapper
  with tag `nx:plugin:<id>` (busted on save).

The `/admin/plugins/<id>/settings` route detects `configSchema`
on the manifest and renders the auto-form; renders the
existing custom panel (if any) below.

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
   admin route auto-detection. ~600 LOC.
2. **G.2 reading-time pilot** — smallest plugin, single field.
   Validates the path end-to-end. ~150 LOC (mostly DELETE of
   the hand-coded UI).
3. **G.2 oauth-github** — proves secret-field handling
   (configSchema with a `.describe("Client secret (sensitive)")`
   probably wants special UI rendering for masking).
4. **G.2 remaining 3 plugins** — bulk migration, one per PR.
5. **G.3 forum hybrid** — proves the auto-form + custom panel
   composition.
6. **Docs** — update plugin-quickstart.md with the configSchema
   path, mark hand-coded UIs as legacy / opt-out.

Total: ~7 PRs, ~2000 LOC.

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
| Sensitive fields (secrets, tokens) need masked input | 🟡 Medium | Add `.meta({ sensitive: true })` hint on the field; renderer treats as password input. Coordinate with F.3 (already supports `.meta({ widget: "textarea" })` from F.3 follow-up) |
| Plugin schema evolution leaves data behind | 🟢 Low | configMigrate / configVersion mirror theme settings v0.3 D — same migration story |
| Plugins that DON'T migrate look out of place next to migrated peers | 🟢 Low | Both surfaces work; admin lists "uses auto-form" / "custom panel" tag for transparency. Migration is incremental |
| `mountAfter` / `mountBefore` ordering becomes unwieldy with N panels | 🟢 Low | v0.3 plugin admin extensions today have at most 2-3 panels per plugin. Add named-slot mounting if a plugin grows past that |

## 9. Phasing

| Phase | Scope | PR-size estimate |
|---|---|---|
| **G.1** | Manifest fields + `getPluginConfig` + admin route auto-detection | 1 PR, ~600 LOC |
| **G.2.1** | Pilot — `reading-time` migration | 1 PR, ~150 LOC |
| **G.2.2** | OAuth plugins (github + google together) — proves sensitive-field rendering | 1 PR, ~250 LOC |
| **G.2.3** | Newsletter + seo-audit | 1 PR, ~300 LOC |
| **G.3** | Hybrid composition (forum) | 1 PR, ~400 LOC |
| **G.docs** | plugin-quickstart.md + plugin-manifest.md updates | 1 PR, ~200 LOC |

Total: 6 PRs, ~1900 LOC. G.1 unblocks all subsequent phases.

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

## 11. Open questions

These need answers before phasing locks.

1. **`.meta({ sensitive: true })` for secret fields** — does
   F.3's introspector already support a `sensitive` widget
   hint? Decide before G.2.2 (oauth migrations need it).
2. **Plugin admin route ownership** — today
   `/admin/plugins/<id>` is a generic plugin detail page.
   The auto-form lives at `/admin/plugins/<id>/settings`
   per §5.1; confirm this URL doesn't conflict with the
   index page's tabs.
3. **`configMigrate` semantics across plugin versions** — when
   a plugin npm-upgrades from v0.1.0 to v0.2.0, does the
   migration run on first cold read post-upgrade? Mirror
   theme settings (yes, lazy-on-read) and document.
4. **Custom panel `mountAfter` keyword space** — currently
   proposed `auto-form`. Reserve other keywords for future
   slot points (`top` / `bottom`) before the first plugin
   ships and locks the convention.

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
