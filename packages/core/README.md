# @nexpress/core

Server-only core for [NexPress](https://github.com/nexpress-cms/nexpress) — the
Next.js-based CMS. Houses the collections pipeline, auth, jobs, media,
plugins, observability, SEO helpers, i18n, and the multi-site model.

> **You probably don't install this directly.** It's wired up by
> `@nexpress/next` from a project scaffolded with `npx create-nexpress`.
> If you're adding a custom backend behavior to a NexPress site, see
> [docs/plugin-render.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-render.md)
> first — most extension points live in the plugin SDK, not core.

## Install

```bash
pnpm add @nexpress/core
```

Server-only — `@nexpress/core` imports `pg`, `sharp`, `@node-rs/argon2`,
`pg-boss`, `jose`. Importing it from a client component breaks the build.
The standard NexPress app declares it in
[`serverExternalPackages`](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).

`defineConfig()` validates the exact active project surface at module
evaluation. `npAnalyzeProjectConfig()` and `npValidateProjectConfig()` expose
the same non-throwing site, storage, i18n, and plugin-inventory contract for
tooling.

## Subpath exports

Domain-bounded entries — prefer these over the catch-all root:

```ts
import { can } from "@nexpress/core/auth";
import { npIsApiError } from "@nexpress/core/api-contract";
import { enqueueJob } from "@nexpress/core/jobs";
import { getLogger } from "@nexpress/core/observability";
import { buildSitemap } from "@nexpress/core/seo";
import { canOnSite } from "@nexpress/core/sites";
import { t } from "@nexpress/core/i18n";
```

Available server subpaths include `auth`, `community`, `db`, `i18n`, `jobs`,
`media`, `observability`, `routes`, `seo`, and `sites`. Client-safe contract
subpaths include `api-contract`, `auth-contract`, `collection-contract`,
`community-contract`, `fields`, `i18n-contract`, `jobs-contract`,
`media-contract`, `navigation`, `revisions`, `settings`, and `theme`. The root `@nexpress/core` keeps
re-exporting everything for back-compat but remains server-only.

## Quick example

```ts
import { defineCollection } from "@nexpress/core";

export const posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "body", type: "richText" },
    { name: "publishedAt", type: "date" },
  ],
});
```

The collection becomes a typed Drizzle table, generated Zod validators,
and a CRUD API at `/api/collections/posts` once you re-run
`pnpm db:generate && pnpm db:migrate`.

`defineCollection()` is also the runtime definition boundary: it rejects
unknown keys, invalid nested field shapes, duplicate or reserved names,
inconsistent bounds, and broken slug/Admin references before codegen.
`npAnalyzeCollectionDefinition()` and `npValidateCollectionDefinition()` expose
the same non-throwing contract for tooling; the plural forms additionally check
duplicate slugs and cross-collection relationship targets.

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [AGENTS.md](https://github.com/nexpress-cms/nexpress/blob/main/AGENTS.md) — architecture overview
- [docs/](https://github.com/nexpress-cms/nexpress/tree/main/docs) — live guides (deployment, jobs, caching, observability, …)
- [Issues](https://github.com/nexpress-cms/nexpress/issues)

## License

MIT
