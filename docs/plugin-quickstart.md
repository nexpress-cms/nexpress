# Plugin author quickstart

This guide takes you from "I want to add behavior to NexPress" to a
running plugin in about ten minutes — five if you use the
`nexpress create *-plugin` generator. We'll build a plugin that logs
whenever a post is created and exposes a tiny HTTP endpoint — the
same shape as the bundled `@nexpress/plugin-reading-time`, which
this guide pulls from.

For the _why_ behind the plugin model, see
[`AGENTS.md`](../AGENTS.md) (the **Plugin model (v1)** section); for
deeper hook semantics see [`plugin-render.md`](plugin-render.md).
This document is the procedure, not the design.

## What you can and can't do in v1

The v1 plugin model is **npm-package + rebuild**. A plugin can:

- Register **hooks** — content lifecycle (`content:beforeCreate`,
  `content:afterCreate`, `content:beforeUpdate`, `content:afterUpdate`,
  `content:beforePublish`, `content:afterPublish`,
  `content:beforeUnpublish`,
  `content:beforeDelete`, `content:afterDelete`), plus
  auth hooks (`auth:afterLogin`, `auth:beforeLogout`,
  `auth:afterRegister`), media hooks (`media:beforeUpload`,
  `media:afterUpload`), and render contributions
  (`render:beforePage`). See [`plugin-hooks.md`](plugin-hooks.md) and
  [`plugin-render.md`](plugin-render.md).
- Register **routes** (`/api/plugins/<id>/<path>`).
- Register **page routes** (public-site URLs the plugin owns; see
  [`plugin-pages.md`](plugin-pages.md)).
- Register **actions** (`/api/plugins/<id>/actions/<id>`).
- Register **scheduled tasks** (run via the pg-boss worker).
- Provide **blocks**, **patterns**, **page templates**, **translations**, and
  **admin extensions**.
- Read and write **plugin-scoped storage** (`np_plugin_storage`).

It cannot:

- Add or modify collection schemas at runtime — schema changes go
  through `defineCollection()` + `pnpm db:generate && pnpm db:migrate`.
- Hot-reload — adding or changing a plugin requires restarting the
  app. (Hot reload is on the Plugin v2 list; see
  [`roadmap.md`](roadmap.md).)
- Run in a sandbox — plugins have full Node access. Only install
  plugins you trust.

## Prerequisites

- Node ≥ 20, pnpm 10.33.
- A working NexPress install. Either:
  - **The monorepo** — `git clone` and `pnpm install`, then build
    once with `pnpm build`. Your plugin lives under
    `packages/plugins/<name>/`.
  - **A `create-nexpress` project** — local plugins can live under
    `packages/plugins/<name>/`; published plugins can still live in a
    sibling repo and be added to the site with
    `pnpm exec nexpress plugin add @your-scope/plugin-<name>`.

The walkthrough below uses the local workspace path because it's
faster to iterate against. The **External projects** section at the
bottom covers the npm-publish variant.

For a block-first starter, run `nexpress create block-plugin <slug>` (or add
`--interactive` for a separate client entry). The generated definition follows
the validation and collision rules in [`plugin-blocks.md`](plugin-blocks.md)
and includes a source-less starter pattern following
[`plugin-patterns.md`](plugin-patterns.md).

## Step 1 — Scaffold

The fastest path is the `nexpress create *-plugin` generator. It picks
the right starter for what you're building:

| Command                                                         | Starter shape                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `nexpress create block-plugin <slug> --workspace`               | One static page-builder block under `packages/plugins/<slug>`.                                                           |
| `nexpress create block-plugin <slug> --interactive --workspace` | Static block + a `"use client"` form, with the directive / `splitting: false` / self-import wiring pre-configured.       |
| `nexpress create hook-plugin <slug> --workspace`                | One `content:afterCreate` hook handler.                                                                                  |
| `nexpress create route-plugin <slug> --workspace`               | One public `GET /health` route.                                                                                          |
| `nexpress create page-plugin <slug> --workspace`                | Typed public page route plus page-template and ICU translation examples.                                                 |
| `nexpress create admin-plugin <slug> --workspace`               | `configSchema` settings form + status widget + manual action, wired through a typed definition-level `actions` registry. |
| `nexpress create scheduled-plugin <slug> --workspace`           | One typed nightly cron task at 02:00 UTC.                                                                                |

```bash
pnpm exec nexpress create hook-plugin my-plugin --workspace
```

Run from the project root, `--workspace` writes
`packages/plugins/my-plugin`. If you want a different workspace
member directory, use `--out <dir>` instead.

Each generator writes the same baseline:
`package.json`, `tsconfig.json`, `tsup.config.ts`, `README.md`, and
`src/index.tsx` with a heavily commented `definePlugin()` body that
explains _why_ each field is there. Edit the body, build, register
with `pnpm exec nexpress plugin add <packageName>` — that's it.

> **Without the CLI?** You can copy `packages/plugins/reading-time` by
> hand and edit `package.json` + `src/index.ts`. The CLI just removes
> the busywork; the underlying plugin shape is identical.

When the generator finishes, build it once so dependent packages can
type-check against the new dist:

```bash
pnpm install
pnpm --filter <packageName> build
```

In the NexPress monorepo the generated package uses `workspace:*`
for framework deps. In a `create-nexpress` project it inherits the
site's installed `@nexpress/blocks` and `@nexpress/plugin-sdk`
ranges, so the local plugin workspace installs against the same
framework version as the app.

Then register it from the project root:

```bash
pnpm exec nexpress plugin add my-plugin
```

For a generated local workspace package, that command uses
`pnpm add my-plugin@workspace:* -w` and updates the plugin marker
sections in `nexpress.config.ts`. Its success output also gives the
post-restart verification command:
`pnpm --silent run ops:plugins -- doctor --json`.

Restart the dev server (or click "Reload all" in `/admin/plugins` for
config / state changes — see [`plugin-reload.md`](plugin-reload.md) for
the limits) and your plugin runs.

To remove it later, run:

```bash
pnpm exec nexpress plugin remove my-plugin
```

That command unregisters the marker-managed config entry, removes the
package dependency, and prints the same restart plus
`pnpm --silent run ops:plugins -- doctor --json` verification step.

## Step 1b — From-scratch scaffold (without the CLI)

If the CLI generator isn't available or you prefer to start from
nothing, the minimum on-disk shape is four files:

```
packages/plugins/my-plugin/
├── package.json    # name + dependency on @nexpress/plugin-sdk
├── tsconfig.json   # extends ../../../tsconfig.base.json
├── tsup.config.ts  # mirrors any sibling plugin's
└── src/index.ts    # the definePlugin body — see Step 2
```

Copy `tsconfig.json` and `tsup.config.ts` verbatim from any sibling
plugin (`packages/plugins/reading-time` is the smallest reference).
Then run `pnpm install` from the repo root so the workspace picks up
the new package.

## Step 2 — Write the plugin

Create `packages/plugins/my-plugin/src/index.ts`:

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

export const myPluginPlugin = definePlugin({
  manifest: {
    id: "my-plugin",
    version: "0.1.0",
    name: "My Plugin",
    description: "Logs when a post is created and exposes /api/plugins/my-plugin/ping.",
    author: { name: "Your Name" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  hooks: {
    "content:afterCreate": ({ data, ctx }) => {
      ctx.log.info("New document created", {
        collection: data.collection,
        id: data.documentId,
      });
    },
  },
  routes: [
    {
      method: "GET",
      path: "/ping",
      handler: () => ({
        status: 200,
        body: { ok: true, at: new Date().toISOString() },
      }),
    },
  ],
});

export default myPluginPlugin;
```

The export-name doubles "Plugin" because the CLI's convention is
`<identifier>Plugin` (the slug `my-plugin` → identifier `myPlugin`
→ export `myPluginPlugin`). Stick to it so a CLI-scaffolded plugin
and a hand-written one read the same.

That's the entire manifest — seven fields. `definePlugin` auto-fills
the rest: `capabilities` is derived from the surface (the
`content:afterCreate` hook adds `hooks:content`, the route adds
`api:route`), `provides.*` is derived from the same surface for
catalog metadata, and the optional metadata blocks (`agent`,
`allowedHosts`, `usesTokens`, `styleSlots`, `requires`,
`apiVersion`) all default to empty/sensible values. You add them
explicitly only when you _need_ them — see
[`plugin-manifest.md`](plugin-manifest.md) for the full field
reference, [`plugin-api-routes.md`](plugin-api-routes.md) for the exact
route/request/response contract, and [`plugin-capabilities.md`](plugin-capabilities.md) for
the capabilities `definePlugin` can't auto-derive (such as
`storage:kv` or `network:fetch`). Hook payloads are listed in
[`plugin-hooks.md`](plugin-hooks.md).

## Step 2b — Operator-tunable config (optional)

If your plugin has settings the operator should tune at runtime
(e.g., a words-per-minute reading speed, an auto-lock threshold,
an OAuth client secret), declare a `configSchema` on the plugin
definition. The framework introspects it into a labeled form on
`/admin/plugins/[pluginId]` — no per-plugin form component
required.

The `nexpress create admin-plugin <slug>` starter uses this pattern
by default, then layers widgets and actions beside the auto-form. Its
definition-level `actions` registry lets `definePlugin()` and
`nexpress ops plugins doctor` verify every admin `actionId` without running
setup.

```ts
import { definePlugin } from "@nexpress/plugin-sdk";
import { z } from "zod";

const configSchema = z.object({
  wordsPerMinute: z.number().int().min(50).max(800).default(220).describe("Words per minute"),
});

export type MyPluginConfig = z.infer<typeof configSchema>;

export default definePlugin<MyPluginConfig>({
  manifest: {
    id: "my-plugin",
    version: "0.1.0",
    name: "My Plugin",
    nexpress: { minVersion: "0.1.0" },
  },
  configSchema,
  hooks: {
    "content:afterCreate": ({ data, ctx }) => {
      // ctx.config is typed Readonly<MyPluginConfig>
      const text = typeof data.document.content === "string" ? data.document.content : "";
      const minutes = text.split(/\s+/).filter(Boolean).length / ctx.config.wordsPerMinute;
      // ...
    },
  },
});
```

### What you get

| Surface                                    | Behavior                                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/plugins`                           | Configure dialog uses the same auto-form for plugins with `configSchema`; legacy plugins without a schema fall back to their `admin.settings.fields` form or raw JSON. |
| `/admin/plugins/<id>`                      | Auto-form rendered above any other admin extensions, persists to `np_settings (key="plugin.config:<id>")` on save.                                                     |
| `ctx.config` (in hooks / routes / actions) | Typed `Readonly<MyPluginConfig>`. The framework reads + validates on every dispatch (no restart for config changes).                                                   |
| Reading from outside the plugin            | `import { getPluginConfig } from "@nexpress/core"; const c = (await getPluginConfig("my-plugin")) as MyPluginConfig;`                                                  |

### Field types the introspector supports today

| Zod node                                           | Form widget                                       |
| -------------------------------------------------- | ------------------------------------------------- |
| `z.string()`                                       | `<input type="text">`                             |
| `z.string().url()`                                 | `<input type="url">`                              |
| `z.string().regex(/^#…/)` matching a hex pattern   | `<input type="color">` + companion hex text input |
| `z.string().meta({ widget: "textarea", rows: N })` | `<textarea>`                                      |
| `z.string().meta({ sensitive: true })`             | `<input type="password">`                         |
| `z.number().int().min().max()`                     | `<input type="number">` with bounds               |
| `z.boolean()`                                      | `<Switch>`                                        |
| `z.enum([...])`                                    | `<select>`                                        |
| `z.array(z.object({...}))`                         | repeated nested object form                       |
| `z.array(z.string())`                              | one-item-per-line `<textarea>`                    |
| `z.object({...})`                                  | nested fieldset                                   |

Anything else introspects as `unsupported` and falls back to a
**raw-JSON textarea editor** — the operator CAN still edit the
value, but as JSON literal rather than a typed widget. The
schema still validates the parsed value on save. Known gaps
where a typed widget would be friendlier are tracked in
[`docs/design/plugin-config-auto-form.md`](design/plugin-config-auto-form.md)
§ 10. Cross-field `.refine()` validation is safe to use: Zod 4
keeps object refinements on the same object node, so the
introspector still renders the object fields and validation runs
on save.

### Schema migrations (configVersion / configMigrate)

When you change the schema in a non-additive way (rename a field,
remove one, tighten a default), bump `configVersion` and pair it
with a `configMigrate(old, fromVersion)` callback. The framework
runs the migrator lazily on first cold read after upgrade,
mirroring the theme-settings migration pipeline. Stored values always use the
exact `{ __npVersion, __npSettings }` envelope. A throwing migrator or a value
that fails the current schema stops the read and must be fixed; it is never
silently replaced with defaults.

```ts
definePlugin<MyPluginConfig>({
  manifest: {
    id: "my-plugin",
    version: "0.1.0",
    name: "My Plugin",
    nexpress: { minVersion: "0.1.0" },
  },
  configSchema,
  configVersion: 2,
  configMigrate: (old, fromVersion) => {
    if (fromVersion === 1) {
      const o = old as { wpm?: number };
      return { wordsPerMinute: o.wpm ?? 220 };
    }
    return old;
  },
});
```

### Legacy `admin.settings.fields` precedence

Plugins authored before configSchema landed may have an
`admin.settings.fields` array on their `admin` block. When BOTH
are declared on the same plugin, the auto-form wins and the
legacy field list is ignored at render time (with a console
warning at boot). Migrating: remove `admin.settings.fields` in
the same diff that adds `configSchema`. Other admin extensions
(widgets, actions, tables, dashboardWidgets, collectionTabs)
keep working independently.

## Step 3 — Wire it into the app

Run the registration command from the project root:

```bash
pnpm exec nexpress plugin add my-plugin
```

The CLI installs the package and rewrites the
`// @nexpress:plugins-imports-*` and
`// @nexpress:plugins-list-*` marker sections in
`nexpress.config.ts`. For local plugins under `packages/plugins`,
pnpm projects get a workspace dependency (`"my-plugin":
"workspace:*"`) instead of a registry lookup.

The manual equivalent is still just an import plus a `plugins` array
entry:

```ts
import myPlugin from "my-plugin";

export default defineConfig({
  // …
  plugins: [
    readingTimePlugin,
    seoAuditPlugin,
    forumPlugin,
    githubOAuthPlugin,
    googleOAuthPlugin,
    myPlugin,
  ],
});
```

Order matters when two plugins register the same hook — they fire
in array order. Default to "new plugin at the end" unless you need
to interpose.

## Step 4 — Build and run

```bash
pnpm build                          # one-time, propagates dts to siblings
pnpm dev                            # starts watch + next dev
```

If `pnpm dev` was already running you must stop and restart it —
the plugin host imports `nexpress.config.ts` once at boot, so a new
entry in `plugins` only takes effect on a fresh start. Once a plugin
is loaded, edits to its config or enabled-state can be picked up
without a restart via `/admin/plugins` "Reload all" — see
[`plugin-reload.md`](plugin-reload.md) for what reload does and
doesn't cover.

## Step 5 — Verify

Two checks confirm the plugin is live.

**Hit the new route**:

```bash
curl http://localhost:3000/api/plugins/my-plugin/ping
# {"ok":true,"at":"2026-05-02T..."}
```

**Trigger the hook** by publishing a post in `/admin/collections/posts/new`.
Watch the dev terminal — `ctx.log.info` emits a structured line
through whatever logger is wired (default: `console`):

```
[my-plugin] New document created collection=posts id=<uuid>
```

If neither shows up:

- Check `pnpm dev` output for plugin-load errors. `loadPlugins()`
  throws with `[plugin:<id>] declares capabilities …` when a hook
  or route is registered without a matching `capabilities` entry —
  that error surfaces as a startup crash, not a silent skip.
  Successful registrations are intentionally quiet; the plugin's
  own `ctx.log.info` (or `console.log`) is the signal that the hook
  fired.
- Confirm the plugin is in the `plugins` array of
  `nexpress.config.ts` and you restarted after editing the config.
- Confirm `pnpm build` finished without errors. A failed `tsup` run
  on the plugin leaves stale `dist/`; sibling `apps/web` would still
  run but never load the plugin.

## External projects

If you're not using the local `packages/plugins` workspace, the steps
differ slightly:

1. Create a new package somewhere convenient (workspace, sibling
   repo, monorepo elsewhere). Use a private scope you control. The
   CLI can still write the starter:
   ```bash
   nexpress create hook-plugin @your-scope/plugin-<name> --out <dir>
   ```
2. `pnpm add @nexpress/plugin-sdk` (and `@nexpress/core` only as a
   `peerDependency` — never bundle it).
3. Write the same `definePlugin` body shown above.
4. `pnpm publish` to your private registry, or `pnpm pack` and
   `pnpm add file:./your-plugin-0.1.0.tgz` for local testing.
5. In the consuming site, run:
   ```bash
   pnpm exec nexpress plugin add @your-scope/plugin-<name>
   ```

The `@nexpress/plugin-sdk` package is the only thing your plugin
imports from. Importing from `@nexpress/core` directly is permitted
but inflates the install — stick to `@nexpress/plugin-sdk` types
and the `definePlugin` factory it re-exports unless you're sure.

## Publishing

If you want others to install your plugin from npm:

1. Bump the version in `package.json`.
2. `pnpm build` — produces `dist/index.js` + `dist/index.d.ts`.
3. `pnpm publish --access=public` (or your registry's equivalent).
4. Optional: list it on the upcoming plugin marketplace
   (roadmap category 8). Submission flow lands when the marketplace
   MVP ships.

Treat the manifest's `nexpress.minVersion` as a contract — bump it
when you start using a hook or capability that didn't exist in older
NexPress. The plugin host refuses to load plugins whose
`minVersion` exceeds the running core.

## Where to go next

The reference docs go deeper on each surface:

- [`plugin-manifest.md`](plugin-manifest.md) — every manifest field,
  what it defaults to, and how `definePlugin` auto-derives `provides`
  and `capabilities` from your declared surface.
- [`plugin-capabilities.md`](plugin-capabilities.md) — capability ↔
  `ctx.*` method mapping table, runtime error messages, authoring
  tips for `network:fetch` / `storage:kv` / `media:write`.
- [`plugin-reload.md`](plugin-reload.md) — what `/admin/plugins`
  "Reload all" picks up, what needs a worker / dev-server restart,
  and why pg-boss work loops can't reconcile across processes.
- [`plugin-render.md`](plugin-render.md) — render-extension hook
  semantics, head-tag and script contributions.
- [`plugin-blocks.md`](plugin-blocks.md) — block definition, props schema,
  container, collision, and diagnostics contracts.
- [`plugin-patterns.md`](plugin-patterns.md) — reusable block trees, source
  stamping, block-reference validation, and pattern diagnostics.
- [`plugin-admin.md`](plugin-admin.md) — declarative admin extensions
  (settings, widgets, actions, tables, dashboard, collection tabs).
- [`agent-integration.md`](agent-integration.md) — exposing a plugin
  to LLM-driven agents through the manifest's `agent` field.
- [`plugin-scheduled-tasks.md`](plugin-scheduled-tasks.md) — typed task ids,
  five-field UTC cron expressions, worker lifecycle, and doctor diagnostics.
- [`api-error-codes.md`](api-error-codes.md) — what to throw and
  what to catch from a route handler.

The bundled plugins are the best reference for "how is this done in
practice":

| Plugin                                          | Demonstrates                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugins/reading-time`                 | Hooks, routes, plain handler, **`configSchema` (single-field auto-form)**                                                                         |
| `packages/plugins/seo-audit`                    | More elaborate routes, admin extension, capabilities, **`configSchema` (mixed number / boolean fields)**                                          |
| `packages/plugins/analytics-lite`               | Render contribution, plugin storage, API routes, scheduled rollup, and definition-level metric/table actions                                      |
| `packages/plugins/webhook-relay`                | Content hooks, outbound HTTP, HMAC signing, stored delivery status, and definition-level status/action handlers                                   |
| `packages/plugins/block-callout`                | Block, reusable pattern, page template, and locale-keyed ICU messages in one definition                                                           |
| `packages/plugins/block-*`                      | Static, interactive, data-bound, nested-array, route-backed, and collection-aware block examples                                                  |
| `packages/plugins/forum`                        | Defining a collection from a plugin (`defineDiscussionsCollection`)                                                                               |
| `packages/plugins/oauth-github`, `oauth-google` | OAuth provider wiring through plugin routes, **`configSchema` with `.meta({ sensitive: true })` masked secret + hybrid env-or-admin credentials** |
