# Plugin author quickstart

This guide takes you from "I want to add behavior to NexPress" to a
running plugin in about ten minutes — five if you use the
`nexpress create *-plugin` generator. We'll build a plugin that logs
whenever a post is created and exposes a tiny HTTP endpoint — the
same shape as the bundled `@nexpress/plugin-reading-time`, which
this guide pulls from.

For the *why* behind the plugin model, see
[`AGENTS.md`](../AGENTS.md) (the **Plugin model (v1)** section); for
deeper hook semantics see [`plugin-render.md`](plugin-render.md).
This document is the procedure, not the design.

## What you can and can't do in v1

The v1 plugin model is **npm-package + rebuild**. A plugin can:

- Register **hooks** — content lifecycle (`content:beforeCreate`,
  `content:afterCreate`, `content:beforeUpdate`, `content:afterUpdate`,
  `content:beforePublish`, `content:afterPublish`,
  `content:beforeDelete`, `content:afterDelete`), plus
  `member:*`, `media:*`, and the render contributions
  (`render:beforePage` and friends — see
  [`plugin-render.md`](plugin-render.md)).
- Register **routes** (`/api/plugins/<id>/<path>`).
- Register **actions** (`/api/plugins/<id>/actions/<id>`).
- Register **scheduled tasks** (run via the pg-boss worker).
- Provide **blocks**, **fields**, **admin extensions**, **collections**.
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
  - **A `create-nexpress` project** — your plugin lives wherever
    you publish it from (a sibling repo or workspace) and is
    installed via `pnpm add @your-scope/plugin-<name>`.

The walkthrough below uses the monorepo path because it's faster to
iterate against. The **External projects** section at the bottom
covers the npm-publish variant.

## Step 1 — Scaffold

The fastest path is the `nexpress create *-plugin` generator. It picks
the right starter for what you're building:

| Command | Starter shape |
|---|---|
| `nexpress create block-plugin <slug>` | One static page-builder block. |
| `nexpress create block-plugin <slug> --interactive` | Static block + a `"use client"` form, with the directive / `splitting: false` / self-import wiring pre-configured. |
| `nexpress create hook-plugin <slug>` | One `content:afterCreate` hook handler. |
| `nexpress create route-plugin <slug>` | One public `GET /health` route. |
| `nexpress create admin-plugin <slug>` | Settings form + status widget + manual action, all wired through `ctx.actions.register`. |
| `nexpress create scheduled-plugin <slug>` | One nightly cron task at 02:00. |

```bash
cd packages/plugins
pnpm exec nexpress create hook-plugin my-plugin
cd my-plugin
```

Each generator writes the same baseline:
`package.json`, `tsconfig.json`, `tsup.config.ts`, `README.md`, and
`src/index.tsx` with a heavily commented `definePlugin()` body that
explains *why* each field is there. Edit the body, build, register in
`nexpress.config.ts` — that's it.

> **Without the CLI?** You can copy `packages/plugins/reading-time` by
> hand and edit `package.json` + `src/index.ts`. The CLI just removes
> the busywork; the underlying plugin shape is identical.

When the generator finishes, build it once so dependent packages can
type-check against the new dist:

```bash
pnpm install
pnpm --filter <packageName> build
```

Then add it to `nexpress.config.ts`:

```ts
import { myPluginPlugin } from "@nexpress/plugin-my-plugin";

export default defineConfig({
  // ...
  plugins: [myPluginPlugin],
});
```

Restart the dev server (or click "Reload all" in `/admin/plugins` for
config / state changes — see [`plugin-reload.md`](plugin-reload.md) for
the limits) and your plugin runs.

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
    "content:afterCreate": ({ data, collection, ctx }) => {
      const doc = (data as { doc?: { id?: string } }).doc;
      ctx.log.info("New document created", {
        collection: collection ?? "?",
        id: doc?.id ?? "?",
      });
    },
  },
  routes: [
    {
      method: "GET",
      path: "/ping",
      handler: async () => ({
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
explicitly only when you *need* them — see
[`plugin-manifest.md`](plugin-manifest.md) for the full field
reference and [`plugin-capabilities.md`](plugin-capabilities.md) for
the capabilities `definePlugin` can't auto-derive (such as
`storage:kv` or `network:fetch`).

## Step 3 — Wire it into the app

Open `apps/web/src/nexpress.config.ts` and add your plugin to the
`plugins` array:

```ts
import { myPluginPlugin } from "@nexpress/plugin-my-plugin";

export default defineConfig({
  // …
  plugins: [
    readingTimePlugin,
    seoAuditPlugin,
    forumPlugin,
    githubOAuthPlugin,
    googleOAuthPlugin,
    myPluginPlugin,
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

If you're not in the monorepo, the steps differ slightly:

1. Create a new package somewhere convenient (workspace, sibling
   repo, monorepo elsewhere). Use a private scope you control.
2. `pnpm add @nexpress/plugin-sdk` (and `@nexpress/core` only as a
   `peerDependency` — never bundle it).
3. Write the same `definePlugin` body shown above.
4. `pnpm publish` to your private registry, or `pnpm pack` and
   `pnpm add file:./your-plugin-0.1.0.tgz` for local testing.
5. In the consuming site, `pnpm add @your-scope/plugin-<name>` and
   add it to `nexpress.config.ts` exactly as in Step 3.

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
  + `capabilities` from your declared surface.
- [`plugin-capabilities.md`](plugin-capabilities.md) — capability ↔
  `ctx.*` method mapping table, runtime error messages, authoring
  tips for `network:fetch` / `storage:kv` / `media:write`.
- [`plugin-reload.md`](plugin-reload.md) — what `/admin/plugins`
  "Reload all" picks up, what needs a worker / dev-server restart,
  and why pg-boss work loops can't reconcile across processes.
- [`plugin-render.md`](plugin-render.md) — render-extension hook
  semantics, head-tag and script contributions.
- [`plugin-admin.md`](plugin-admin.md) — declarative admin extensions
  (settings, widgets, actions, tables, dashboard, collection tabs).
- [`agent-integration.md`](agent-integration.md) — exposing a plugin
  to LLM-driven agents through the manifest's `agent` field.
- [`scheduled-publishing.md`](scheduled-publishing.md) — registering
  scheduled tasks against the pg-boss worker.
- [`api-error-codes.md`](api-error-codes.md) — what to throw and
  what to catch from a route handler.

The bundled plugins are the best reference for "how is this done in
practice":

| Plugin                                             | Demonstrates                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/plugins/reading-time`                    | Hooks, routes, plain handler                                       |
| `packages/plugins/seo-audit`                       | More elaborate routes, admin extension, capabilities               |
| `packages/plugins/forum`                           | Defining a collection from a plugin (`defineDiscussionsCollection`)|
| `packages/plugins/oauth-github`, `oauth-google`    | OAuth provider wiring through plugin routes                        |
