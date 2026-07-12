# Framework settings contract

NexPress has one closed runtime contract for site identity and persisted
framework settings. Core services, Admin, plugins, backup import/export,
OpenAPI, and `doctor` share it. Unknown keys, extra fields, and malformed
stored values fail closed instead of being ignored or replaced with defaults.

## Canonical ownership

`np_sites` owns site identity. Its editable projection is exact:

```ts
interface NpSiteGeneralSettings {
  name: string;
  url: string | null;
  description: string | null;
  defaultLocale: string | null;
  timezone: string | null;
}
```

`name` and `description` map to columns. `url`, `defaultLocale`, and `timezone`
map to the exact `np_sites.settings` object:

```json
{
  "siteUrl": "https://example.com",
  "defaultLocale": "ko-KR",
  "timezone": "Asia/Seoul"
}
```

The URL must be an HTTP(S) origin without credentials, path, query, or hash.
Locales are canonical BCP 47 tags and time zones are valid IANA names. There
are no `np_settings.site` or `np_settings.description` mirrors.

## Persisted settings registry

`np_settings` accepts only these key families:

| Key                        | Value contract                                             |
| -------------------------- | ---------------------------------------------------------- |
| `seo`                      | Exact default image, Twitter handle, and locale object     |
| `theme`                    | Canonical nested theme-token overlay                       |
| `community`                | Exact community settings object                            |
| `activeTheme`              | Canonical registered theme id                              |
| `theme.settings:<themeId>` | Exact versioned envelope; owner must be a registered theme |
| `plugin.config:<pluginId>` | Exact versioned envelope; owner must be a loaded plugin    |
| `page-builder.patterns`    | Bounded, definition-aware block pattern array              |
| `jobs.paused`              | Exact global worker pause state                            |

Theme and plugin values use `{ __npVersion, __npSettings }` with no extra
envelope fields. Owner schemas validate the inner value. Missing rows may use
documented defaults; an existing malformed row never does. Schema migration
errors propagate to the caller.

Use dedicated domain services instead of writing `np_settings` directly:

- `getSiteGeneralSettings` / `setSiteGeneralSettings`
- `getSeoSettings` / `setSeoSettings`
- theme, community, plugin-config, page-pattern, and jobs APIs

Client-safe validators and types are exported from `@nexpress/core/settings`.
New framework keys must be added to that registry and wired through their
owning service, tests, OpenAPI, doctor, and this guide in one change.

## Admin and plugin APIs

`GET /api/settings` returns exactly `{ site, seo }`. `PUT /api/settings`
accepts exactly `{ key: "site" | "seo", value }`; theme, community, and plugin
settings use their dedicated endpoints.

`ctx.settings.getSite()` returns `NpSiteGeneralSettings`.
`ctx.settings.getPlugin()` and `setPlugin()` require `settings:read` and
`settings:write` respectively. Plugin config is always scoped to the current
site and calling loaded plugin id; plugins cannot create arbitrary keys.

## Import, export, and diagnosis

Site-config exports use format version `2`. A full export includes top-level
`site`, registered settings, navigation, theme tokens, and plugin configs.
Exports and imports are current-site scoped. Plugin config appears only in the
top-level `plugins` array so its loaded plugin schema can validate it. A dry
run applies the same validation without writes.

`pnpm run doctor` emits the blocking `settings.contract` check. It scans every
`np_sites` record and `np_settings` row and reports unknown or malformed
values. Repair the stored row or restore a known-good backup; do not add a
fallback that hides the invalid value.
