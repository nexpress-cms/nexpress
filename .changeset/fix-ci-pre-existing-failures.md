---
"@nexpress/core": patch
"@nexpress/admin": patch
---

**Fix two pre-existing CI failures exposed once push-time triggers were
restored** (#640).

### `getPluginConfig` read/write asymmetry

`ctx.settings.setPlugin(data)` writes to `np_settings` for any
`pluginId`, regardless of whether the plugin is registered in the
in-process host. But `getPluginConfigWithStatus` short-circuited with
`{ value: {}, hasPersisted: false }` whenever registration was missing,
**before** querying the table — so the stored row was silently
unreadable.

The asymmetry surfaced as the `ctx-settings` integration test failing
with `expected {} to deeply equal { apiKey: 'abc', refreshInterval:
60 }`. Real-world impact is bigger: a plugin that registers later than
the first read (HMR re-boot, dynamic plugin install) loses access to
its own persisted config until restart.

Fix: drop the early return on missing registration. Treat
"unregistered" the same as "registered without `configSchema`":
surface the row raw if it exists, return empty if it doesn't.
Validation paths that require a schema still gate on
`if (!schema)` — semantics there are unchanged.

### E2E admin sign-in flow

`tests/e2e/auth.spec.ts` waited 30s for a button matching
`/E2E Admin/` in the topbar dropdown, but the topbar shows only the
first word of `user.name` (`"E2E"`), so the regex never matched the
button's accessible name.

Fix: add `aria-label="Open user menu"` to the dropdown trigger in
`admin-topbar.tsx` and switch the test to locate by that stable
label. The visible-text behavior is unchanged.
