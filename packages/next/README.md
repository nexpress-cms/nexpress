# @nexpress/next

Next.js integration helpers for [NexPress](https://github.com/nexpress-cms/nexpress) —
the Next.js-based CMS. Wires `@nexpress/core` into a Next.js 16 App Router
site: bootstrap singletons, auth helpers, collection helpers, cache
invalidation.

> Despite the name, this package is **not** the Next.js framework. It's
> NexPress's integration layer for Next.js apps.

## Install

```bash
pnpm add @nexpress/next
```

## Bootstrap

`createBootstrap()` is the single factory that wires the DB pool,
storage adapter, plugin loader, and pg-boss producer into the
process-wide singletons:

```ts
// src/lib/bootstrap.ts
import { createBootstrap } from "@nexpress/next";
import nexpressConfig from "@/nexpress.config";
import * as generatedSchema from "@/db/generated/collections";

export const { getDb, ensureFor, reloadPlugins, shutdown } = createBootstrap({
  config: nexpressConfig,
  generatedSchema: generatedSchema as unknown as Record<string, unknown>,
});
```

In routes, use the intent-based app wrapper (`apps/web/src/lib/init-core.ts` in
the reference app):

```ts
import { ensureFor } from "@/lib/init-core";

export async function GET() {
  await ensureFor("read"); // DB + storage + collections
  // ...
}
```

Four intents:

- `"read"` — read-only RSC pages, GET routes
- `"plugins"` — render paths that need `runHook` to fire
- `"worker"` — dedicated worker: plugins + email without a competing producer
- `"write"` — mutating routes / server actions / imports (also wires email + jobs)

`getDb()` requires a completed `read` intent. Standalone scripts must call the
terminal, idempotent `shutdown()` method in their exit path. See
[docs/bootstrap.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/bootstrap.md).

## Cache invalidation

Use `revalidateCollection()` instead of importing `next/cache` directly:

```ts
import { defaultRevalidationRules, revalidateCollection } from "@nexpress/next";

revalidateCollection(defaultRevalidationRules, "posts");
```

Sites behind a CDN can also bridge framework invalidation hints to their
provider:

```ts
import { setCdnPurgeAdapter } from "@nexpress/next";

setCdnPurgeAdapter({
  async purge({ paths, tags }) {
    // Call Cloudflare, Fastly, or another CDN provider here.
  },
});
```

## What's also exported

- `createAuthHelpers()` — server-component / route helpers for sessions
- `createCollectionHelpers()` — typed `findOne` / `find` for use from RSC
- `toClientCollectionConfig()` — strip server-only bits before passing
  to a client component

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [AGENTS.md](https://github.com/nexpress-cms/nexpress/blob/main/AGENTS.md) — architecture overview
- [docs/caching.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/caching.md)
- [docs/deployment.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/deployment.md)

## License

MIT
