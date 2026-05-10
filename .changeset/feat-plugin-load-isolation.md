---
"@nexpress/core": patch
---

**Plugin load-time error isolation.**

`loadPlugins()` no longer aborts the entire boot when a single
plugin's `setup()` callback (or its `init()` for legacy plugins)
throws. The throw is logged, the partially-registered plugin's
hooks/routes are scrubbed from the registry via
`pluginRegistry.delete(id)`, and the next plugin in the topo
order continues to load.

Behavioral contract change for the existing capability-violation
errors: the throw used to be uncaught, so a plugin trying to
register a `content:afterCreate` hook without declaring
`hooks:content` would crash boot. With load-time isolation, that
plugin is now logged + skipped; surviving plugins keep loading.

Plugin authors still get loud feedback at boot — the `error`-level
log message includes the plugin id and the underlying error
message — but a single buggy plugin no longer takes down the
host's other plugins.

Three new tests in `host.test.ts` pin:
- legacy `init()` throw → other legacy plugins still load
- resolved `setup()` throw → registry is scrubbed; other resolved
  plugins still load
- log-line shape (one `Plugin failed to load` per failure, with
  pluginId + error message in the structured context)

Two existing tests for capability violations were updated to the
new contract (no throw; plugin absent from `getAllPluginIds()`).
