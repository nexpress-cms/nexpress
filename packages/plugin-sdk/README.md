# @nexpress/plugin-sdk

Plugin SDK for [NexPress](https://github.com/nexpress-cms/nexpress) — the
Next.js-based CMS. Author plugins with `definePlugin()`.

## Install

```bash
pnpm add @nexpress/plugin-sdk
```

## Plugin model (v1)

Plugins are **npm-package + rebuild**, not hot-loadable. A plugin can
register hooks, REST routes, public-site page routes, page-builder
blocks and patterns, declarative admin extensions, custom field types,
operator config schemas, and scheduled tasks at startup. It **cannot**
add collection schemas to a site at runtime — collections still require
codegen + a DB migration. Plugins run in-process with full Node access;
there is no sandbox in v1.

## Quick example

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "reading-time",
    name: "Reading Time",
    version: "0.1.0",
  },
  hooks: {
    "content:beforeSave": async ({ doc, ctx }) => {
      if (typeof doc.body === "string") {
        const words = doc.body.split(/\s+/).length;
        doc.readingMinutes = Math.max(1, Math.round(words / 220));
      }
      return doc;
    },
  },
});
```

Then in your `nexpress.config.ts`:

```ts
import readingTime from "@nexpress/plugin-reading-time";

export default defineConfig({
  // ...
  plugins: [readingTime],
});
```

Restart the server — the hook fires on every `content:beforeSave`.

## Available extension points

- **`hooks`** — `content:*`, `auth:*`, `render:*`, `media:*`
- **`actions`** — handlers registered through `ctx.actions` and
  dispatched by admin widgets, buttons, tables, or
  `/api/plugins/<id>/actions/<name>`
- **`routes`** — full route handlers at `/api/plugins/<id>/<...path>`
  (rate-limited at the framework level — see
  [AGENTS.md](https://github.com/nexpress-cms/nexpress/blob/main/AGENTS.md))
- **`pageRoutes`** — public-site pages rendered inside the active theme
  shell
- **`blocks` / `patterns`** — page-builder contributions rendered by
  the shared block registry
- **`admin`** — declarative settings, widgets, actions, tables,
  collection tabs, and dashboard widgets
- **`configSchema`** — Zod-backed operator config auto-form persisted
  under `np_settings` as `plugin.config:<id>`
- **`scheduled`** — cron-style tasks dispatched by pg-boss

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [docs/plugin-admin.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-admin.md)
- [docs/plugin-capabilities.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-capabilities.md)
- [docs/plugin-pages.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-pages.md)
- [docs/plugin-render.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-render.md)
- [Reference plugins](https://github.com/nexpress-cms/nexpress/tree/main/packages/plugins) — `reading-time`, `seo-audit`, `forum`, `oauth-github`, `oauth-google`

## License

MIT
