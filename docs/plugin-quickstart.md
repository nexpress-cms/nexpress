# Plugin author quickstart

This guide takes you from "I want to add behavior to NexPress" to a
running plugin in roughly thirty minutes. We'll build a plugin that
logs whenever a post is created and exposes a tiny HTTP endpoint —
the same shape as the bundled `@nexpress/plugin-reading-time`, which
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

Copy the smallest existing plugin (`reading-time`) as a starter.

```bash
cd packages/plugins
cp -R reading-time my-plugin
cd my-plugin
```

Update the package metadata:

```bash
# package.json
sed -i '' 's/@nexpress\/plugin-reading-time/@nexpress\/plugin-my-plugin/' package.json
sed -i '' 's/Reading-time meta plugin for NexPress\./My plugin./' package.json
sed -i '' 's/packages\/plugins\/reading-time/packages\/plugins\/my-plugin/' package.json
```

(GNU `sed` users: drop the `'' ` after `-i`.)

Wipe the example logic so you can write your own:

```bash
rm -rf dist src/index.ts
mkdir -p src
```

Then re-run `pnpm install` from the repo root so the workspace picks
up the new package:

```bash
cd ../../..
pnpm install
```

## Step 2 — Write the plugin

Create `packages/plugins/my-plugin/src/index.ts`:

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

export const myPlugin = definePlugin({
  manifest: {
    id: "my-plugin",
    version: "0.1.0",
    name: "My Plugin",
    description: "Logs when a post is created and exposes /api/plugins/my-plugin/ping.",
    author: { name: "Your Name" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["hooks:content", "api:route"],
    allowedHosts: [],
    provides: {
      blocks: [],
      fields: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: ["/ping"],
      hooks: ["content:afterCreate"],
    },
    agent: { description: "Demo plugin." },
    usesTokens: [],
    styleSlots: {},
  },
  hooks: {
    "content:afterCreate": ({ data }) => {
      const collection = typeof data.collection === "string" ? data.collection : "?";
      const id = (data.doc as { id?: string } | undefined)?.id ?? "?";
      console.log(`[my-plugin] new ${collection}/${id}`);
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

export default myPlugin;
```

The `manifest` is what the plugin host uses to enforce capabilities
and present the plugin in `/admin/plugins`. The fields with empty
arrays (`blocks`, `fields`, `collections`, `adminExtensions`) are
required even when unused — the schema is exhaustive on purpose so a
reviewer can read the manifest and know exactly what the plugin
touches without grepping the source.

## Step 3 — Wire it into the app

Open `apps/web/src/nexpress.config.ts` and add your plugin to the
`plugins` array:

```ts
import { myPlugin } from "@nexpress/plugin-my-plugin";

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
the plugin host runs `loadPlugins()` once at boot, so a new entry in
`plugins` only takes effect on a fresh start. (See [`roadmap.md`](roadmap.md)
category 3 for the hot-reload story.)

## Step 5 — Verify

Two checks confirm the plugin is live.

**Hit the new route**:

```bash
curl http://localhost:3000/api/plugins/my-plugin/ping
# {"ok":true,"at":"2026-05-02T..."}
```

**Trigger the hook** by publishing a post in `/admin/collections/posts/new`.
Watch the dev terminal:

```
[my-plugin] new posts/<uuid>
```

If neither shows up:

- Check `pnpm dev` output for plugin-load errors. `loadPlugins()`
  throws with `[plugin:<id>] declares capabilities …` when a hook
  or route is registered without a matching `capabilities` entry —
  that error surfaces as a startup crash, not a silent skip.
  Successful registrations are intentionally quiet; the plugin's
  own `console.log` (or your structured logger) is the signal that
  the hook fired.
- Confirm the plugin is in the `plugins` array of
  `nexpress.config.ts` and you restarted after editing the config.
- Confirm `pnpm build` finished without errors. A failed `tsup` run
  on the plugin leaves stale `dist/`; sibling `apps/web` would still
  run but never load the plugin.

## Where to go next

You now have the entire surface area in front of you. Pick the next
extension point from the live guides, not from this quickstart:

- [`plugin-render.md`](plugin-render.md) — adding render hooks for
  page contributions (head tags, body tags, structured data).
- [`plugin-admin.md`](plugin-admin.md) — extending the admin UI with
  custom views.
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
