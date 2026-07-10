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
Each locale contains at least one trimmed key and every value is a string.
Messages use ICU MessageFormat; invalid plural/select/interpolation syntax is
rejected while the plugin module loads rather than failing on the first render.

`definePlugin()` derives entries such as `en:my-plugin.greeting` into
`manifest.provides.translations`. The core host repeats validation for
SDK-bypassing definitions. Plugin doctor reports malformed bundles as
`plugins.i18n_invalid` and shared locale/key ownership as
`plugins.translation_conflict`.

Plugin bundles are source-aware. Later plugins override earlier plugins for the
same locale/key, but reload or disable removes only that plugin's strings and
restores the previous value. App/theme base strings remain intact. Namespace
keys with the plugin id unless a load-order override is deliberate.

Use `t()` for async render paths that include site-scoped operator overrides,
or `tSync()` only where an async lookup is impossible. The generated
`page-plugin` starter contains English and Korean ICU examples.
