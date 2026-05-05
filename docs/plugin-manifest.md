# Plugin manifest reference

Every NexPress plugin starts with `definePlugin({ manifest, … })`. The
manifest is the metadata block — the host reads it to gate
capabilities, validate compatibility, and surface plugin info in admin
UIs and machine-readable catalogs (npm search, the Discover panel).

This page is a flat reference. For the procedural side see
[`plugin-quickstart.md`](plugin-quickstart.md). For capability ↔ ctx
mappings see [`plugin-capabilities.md`](plugin-capabilities.md).

## What you actually have to type

After `definePlugin`'s defaults + auto-derivation kicked in, the
minimum viable manifest is **seven fields**:

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "my-plugin",
    version: "0.1.0",
    name: "My plugin",
    description: "Does something useful.",
    author: { name: "Me" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  // ...your hooks / routes / blocks / admin / scheduled go here
});
```

Everything else (`capabilities`, `provides`, `agent`, `requires`,
`allowedHosts`, `usesTokens`, `styleSlots`, `apiVersion`) has a default
or is auto-derived from your declared surface. You add them when you
*need* them, not because the type system forces you.

## Field reference

### Required (no default)

| Field | Type | Notes |
|---|---|---|
| `id` | string | npm-package-shaped slug. Also the row key in `np_plugins`. |
| `version` | semver | Authored by you, NOT the framework version. |
| `name` | string | Human label. Surfaces in `/admin/plugins`. |
| `description` | string (1–500 chars) | One-line summary. The agent block falls back to this when its own description is empty. |
| `author` | `{ name, email?, url? }` | At minimum, `name`. |
| `license` | string | SPDX id (`"MIT"`, `"Apache-2.0"`, etc.). |
| `nexpress.minVersion` | semver | Lowest framework version this plugin is known to work against. The host refuses to load it on older versions and logs why. |

### Auto-defaulted (you can omit)

| Field | Default | What it's for |
|---|---|---|
| `apiVersion` | `"1"` | Plugin manifest schema version. Bumps on breaking shape changes; older plugins keep loading on a newer host until major. |
| `capabilities` | `[]` + auto-derived | See "Capabilities" below — `routes` / `hooks` add entries automatically. |
| `provides.{blocks, fields, hooks, apiRoutes, adminExtensions, collections}` | derived from declared surface | Catalog metadata. The block array's `type`s end up in `provides.blocks`, etc. Author-declared entries merge with derived ones. |
| `agent` | empty descriptor | AI / catalog metadata. Listing it explicitly with `category` / `tags` improves discoverability in the Browse panel. |
| `requires` | `[]` | Other plugin ids this one depends on. The host topo-sorts the load order. |
| `allowedHosts` | `[]` | Hostnames `ctx.http.fetch` may call. Empty = no outbound HTTP allowed. |
| `usesTokens` | `[]` | Theme tokens the plugin reads. Documentation only. |
| `styleSlots` | `{}` | CSS custom-property slots the plugin's blocks render against. Documentation only. |

## Capabilities

`capabilities` declares what the host should let your plugin do at
runtime. Two kinds:

**Auto-derived from surface** — `definePlugin` adds these for you:

- `routes: [...]` ⟶ `api:route`
- `hooks: { "<ns>:<event>": ... }` ⟶ `hooks:<ns>` (one per namespace)

**Author-declared** — you list these because the host can't statically
tell from the top-level definition that your handler will call them.
Examples: `storage:kv`, `media:read`, `network:fetch`, `content:write`,
`admin:panel`. Full list + the matching `ctx.*` methods is in
[`plugin-capabilities.md`](plugin-capabilities.md).

A merge happens — author entries + derived entries with no duplicates.
You only ever add what auto-derive can't infer.

## Compatibility — `nexpress.minVersion` / `maxVersion`

The host parses these at boot, compares against its own framework
version, and refuses to load the plugin if it falls outside the range.

```ts
nexpress: {
  minVersion: "0.1.0",
  maxVersion: "0.5.0", // optional
}
```

If you only set `minVersion`, you implicitly support every later
framework version. Set `maxVersion` when you know a newer release ships
breaking changes you haven't tested against — the operator gets a
clean "skipping incompatible plugin" log line instead of a deep
runtime crash.

## Inter-plugin dependencies — `requires`

```ts
manifest: {
  // ...
  requires: ["@nexpress/plugin-forum"],
}
```

The host topologically sorts the load order so your `setup(ctx)` runs
*after* every plugin in `requires` has finished its own setup. If a
required plugin is missing, the dependent is skipped with a `missing
required plugin(s)` warning — and the cascade continues, so a plugin
whose dep was skipped is also skipped (issue #464).

Cycles are detected and break with `dependency cycle — refusing to
load` warnings; the rest of the plugin set still loads.

## What auto-derivation does NOT touch

`capabilities` like `storage:kv`, `media:write`, `network:fetch`,
`content:write` aren't auto-derived because they require static
analysis of route handler / setup bodies — silently granting them
would be a privilege footgun. List them explicitly when you call
`ctx.storage.set()`, `ctx.media.upload()`, `ctx.http.fetch()`, etc.
The host throws at registration time if a hook / route hits a
namespace you didn't declare.

## See also

- [`plugin-quickstart.md`](plugin-quickstart.md) — step-by-step from
  scaffold to running plugin.
- [`plugin-capabilities.md`](plugin-capabilities.md) — capability ↔
  `ctx.*` mapping table.
- [`plugin-reload.md`](plugin-reload.md) — what `/admin/plugins`
  "Reload all" does and what it doesn't.
- [`plugin-render.md`](plugin-render.md) — render-extension hook
  semantics.
