---
"@nexpress/core": minor
"@nexpress/admin": minor
"@nexpress/next": minor
"@nexpress/plugin-sdk": minor
"@nexpress/web": patch
---

feat(core, admin, next, plugin-sdk): G.1 — plugin config auto-form + storage migration to np_settings

Plugin authors can now declare a Zod `configSchema` on their definition; the framework introspects it (mirroring the F.3 theme settings path) and renders an admin auto-form on `/admin/plugins/[pluginId]` with no per-plugin form code.

**Plugin SDK** (`@nexpress/plugin-sdk`):
- `NpPluginDefinition.configSchema` (already existed — wired up in G.1) now drives the admin auto-form.
- New `configVersion` and `configMigrate` fields mirror theme `settingsVersion` / `settingsMigrate` for lazy schema migrations.

**Core** (`@nexpress/core`):
- New `getPluginConfig` / `getPluginConfigWithStatus` / `setPluginConfig` / `pluginConfigCacheTag` exports (in `packages/core/src/plugins/config.ts`). Match `getThemeSettings` semantics including the defensive try/catch on the migrator and `safeParse` fallback to schema defaults.
- Auto-form introspector gained a `password` widget, opted into via `.meta({ sensitive: true })` on a Zod string. Both theme and plugin schemas can use it.
- `np_plugins.config` jsonb column dropped (Drizzle migration 0034). Existing rows are copied to `np_settings (siteId, "plugin.config:<id>")` wrapped in the v1 versioned envelope. `np_plugins` is now a lean `(id, enabled, installed_at, updated_at)` meta row.
- `getPluginState` / `updatePluginState` no longer return / accept a `config` field. Callers use `getPluginConfig` / `setPluginConfig` instead.
- `ctx.settings.getPlugin` / `ctx.settings.setPlugin` (plugin runtime context) now read/write through the new path. Plugins with `configSchema` get validation; legacy plugins still work without it.
- Plugins that declare BOTH `configSchema` and `admin.settings.fields` log a console warning at registration; the auto-form wins (per the locked precedence in `docs/design/plugin-config-auto-form.md` § 5.1.1).

**Admin** (`@nexpress/admin`):
- `<PluginAdminPage>` accepts new optional `configFields` and `initialAutoConfig` props. When `configFields` is non-empty, the auto-form `<Card>` replaces the legacy `admin.settings.fields` form.
- `ZodForm` form-renderer dispatches `password` widget to `<Input type="password" autoComplete="new-password">`.

**Next.js helpers** (`@nexpress/next`):
- New `getCachedPluginConfig` wrapper (parallel to `getCachedThemeSettings`) tagged with `np:plugin:<id>`. Per-plugin tag scheme uses the `np` prefix (CLAUDE.md "Naming convention").

**Reference app** (`@nexpress/web`):
- `/admin/plugins/[pluginId]` page introspects `configSchema` server-side and passes the metadata to the client.
- `PUT /api/plugins/[pluginId]` no longer accepts the `config` field — config writes moved to `PUT /api/admin/plugins/[pluginId]/config` (validates via schema, busts `np:plugin:<id>` cache tag).

Migration recipe for existing plugins (each will land as its own G.2 PR):
1. Add `configSchema: z.object({…})` to the plugin definition.
2. Remove `admin.settings.fields` (or set to `[]`).
3. Replace any `getPluginConfig` typed read with the `z.infer<typeof schema>` cast.
