---
"@nexpress/next": minor
---

**`cachedPluginFetch` helper** — plugin parallel of
`cachedThemeFetch`, closing one of the v0.3 G-track follow-ups
(see `docs/design/plugin-config-auto-form.md` § 10).

```ts
import { cachedPluginFetch } from "@nexpress/next";

const data = await cachedPluginFetch(
  "my-forum",                          // plugin id
  ["list", String(page)],              // caller-supplied key parts
  () => findDocuments("discussions", { page, limit: 20 }),
  { revalidate: 60, extraTags: ["nx:collection:discussions"] },
);
```

Wraps a plugin route's data fetch in `unstable_cache` with the
plugin's config tag (`np:plugin:<pluginId>`) auto-attached. Saving
the plugin's config in `/admin/plugins/<id>` or disabling /
reloading the plugin busts the cache automatically (the framework
already revalidates this tag inside `setPluginConfig`).

**Why this lands now:** the plugin-route track (#623) ships
plugin-owned URLs. Forum's list / profile-discussions routes are
the first plugin pages doing real DB work on every render — they
work today without caching, but a busy site benefits from
deduping. Adding the helper now means new plugin route authors
don't roll their own `unstable_cache` wrappers (and forget the
cache-tag plumbing that makes admin "Save config" propagate).

**Same shape as `cachedThemeFetch`:**
- Per-site cache keying via `getCurrentSiteId()` so multi-tenant
  deployments don't leak across sites.
- 60-second default `revalidate`; caller can override.
- `extraTags` slot for content-driven invalidation. Note: tags
  are advisory — they invalidate only when something else fires
  `revalidateTag` against them. The framework auto-fires the
  `np:plugin:<id>` tag (always-on) but NOT collection-scoped
  tags; the host's `RevalidationMap` is responsible for those.
- Falls back to the uncached fetcher when Next's incremental
  cache is unreachable (integration tests, scripts, background
  workers).

7 new tests in `cache.test.ts`: per-site/per-plugin keying,
default revalidate, override, extraTags merge, fallback on
incremental-cache miss, error propagation, distinct namespaces
across plugins.

Doc update: `docs/plugin-pages.md` gains a "Caching expensive
reads" section showing the recipe.
