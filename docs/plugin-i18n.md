# Plugin translations

The definition-level `i18n` registry contributes UI strings by locale:

```ts
definePlugin({
  manifest: {/* … */},
  i18n: {
    en: { "my-plugin.greeting": "Hello, {name}!" },
    ko: { "my-plugin.greeting": "안녕하세요, {name}!" },
  },
});
```

Locale keys must be canonical BCP 47 tags such as `en`, `ko`, or `pt-BR`.
Each locale contains at least one trimmed key and every value is a bounded safe
string. Messages use ICU MessageFormat; invalid plural/select/interpolation
syntax is rejected while the plugin module loads rather than failing on the
first render. Plugin, theme, app, Admin override, and persisted-row paths all
delegate to the client-safe `@nexpress/core/i18n-contract` validator.

`definePlugin()` derives entries such as `en:my-plugin.greeting` into
`manifest.provides.translations`. The core host repeats validation for
SDK-bypassing definitions. Plugin doctor reports malformed bundles as
`plugins.i18n_invalid` and shared locale/key ownership as
`plugins.translation_conflict`.

Plugin bundles are source-aware. Later active plugins override earlier active
plugins for the same locale/key. `t()` filters the process-wide registry by the
current site's activation snapshot, so disabling one plugin restores the
previous active value only for that site; reload/removal drops its process
registration. App/theme base strings remain intact. Namespace keys with the
plugin id unless a load-order override is deliberate.

`pnpm run doctor` validates the shared project locale catalog and persisted
override rows. Plugin doctor continues to report invalid plugin catalogs and
cross-plugin locale/key conflicts; Admin Health also exposes contained runtime
ICU formatting failures.

Use `t()` for async render paths that include site-scoped operator overrides
and plugin activation. `tSync()` exposes the process registry and cannot apply
a request site's activation gate, so reserve it for tooling where an async
lookup is impossible. The generated `page-plugin` starter contains English and
Korean ICU examples.
