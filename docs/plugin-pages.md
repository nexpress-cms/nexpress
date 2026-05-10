# Plugin page routes

Plugins can register **public-site URL routes** that the host catch-all
serves directly. The route component is your code, the URL pattern is
yours, and the host plugs the rendered output into the standard page
shell — same chrome (header / footer / theme styles) any operator-
authored page gets.

This is what enables a plugin like `@nexpress/plugin-forum` to own
`/discussions/*` end-to-end without the host app shipping a
`(site)/discussions/` directory.

For the architectural rationale + locked design decisions, see
[`docs/design/plugin-routes.md`](design/plugin-routes.md). This page is
the operator-facing how-to.

---

## Quickstart

```ts
import { definePlugin, type NpPluginPageRouteRegistration } from "@nexpress/plugin-sdk";
import type { NpRouteRenderProps } from "@nexpress/next";

async function ListPage(_props: NpRouteRenderProps) {
  return (
    <main>
      <h1>Discussions</h1>
      {/* …your render… */}
    </main>
  );
}

async function listMetadata() {
  return { title: "Discussions" };
}

export default definePlugin({
  manifest: {
    id: "my-forum",
    version: "0.1.0",
    name: "My Forum",
    description: "Forum routes.",
    author: { name: "Me" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  pageRoutes: [
    {
      pattern: "/discussions",
      component: ListPage,
      metadata: listMetadata,
    },
  ],
});
```

That's it — install the plugin, the operator visits `/discussions`,
the catch-all dispatches to your component, and the response carries
the metadata your `metadata()` function returned.

---

## The route entry

Each entry in `pageRoutes` is an `NpPluginPageRouteRegistration`:

| Field | Type | Required | Default | Purpose |
| --- | --- | --- | --- | --- |
| `pattern` | string | yes | — | The URL pattern. See "Pattern grammar" below. |
| `component` | `ComponentType<NpRouteRenderProps>` | yes | — | Your route component. **Must be a Server Component** unless wrapped — see "Server / client boundary." |
| `metadata` | `(ctx) => Metadata \| Promise<Metadata>` | no | — | Builder for the route's `<head>` (Next.js `Metadata` type). Without it, the framework emits site-wide fallback SEO. |
| `surface` | `"site" \| "member"` | no | `"site"` | Which audience this route is for. Affects the shell wrap (member surface support is **deferred to v0.2** — today both surfaces render in the site shell). |
| `locale` | `"auto" \| "none"` | no | `"auto"` | `"auto"` (the only setting plumbed today) means the host strips the locale prefix before matching, so `/en/discussions` and `/discussions` both match `/discussions`. `"none"` is reserved for v1.x. |

Order matters in the array because the dispatcher is **first-match-
wins**. Put more-specific patterns before parametric ones:

```ts
pageRoutes: [
  { pattern: "/discussions/new", component: NewPage },
  { pattern: "/discussions/:slug/edit", component: EditPage },
  { pattern: "/discussions/:slug", component: DetailPage },
  // /discussions/new would match /discussions/:slug if it came AFTER
],
```

---

## Pattern grammar

```
/literal
/:name              — captures any single segment as `params.name`
/:name(regex)       — captures only when the regex matches
/literal/:nested    — segments mix freely
```

- Literal segments must match exactly.
- `:name` captures a single non-slash segment.
- `:name(regex)` adds a constraint: `:year(\\d{4})` requires four digits.
- Segment **count must agree** — `/discussions` does not match
  `/discussions/foo`. There is no glob / wildcard / catch-all in v0.1.

The captured params arrive on the route component's props as
`params: Record<string, string>`. Numeric params are still strings —
parse them yourself.

---

## Component shape — `NpRouteRenderProps`

```ts
import type { NpRouteRenderProps } from "@nexpress/next";

export interface NpRouteRenderProps {
  params: Record<string, string>;
  searchParams: Record<string, string | string[] | undefined>;
  blockCtx: NpBlockRenderContext;
}
```

- `params` is **already resolved** — unlike Next.js's file-based routes
  where `params: Promise<...>`, the dispatcher unwraps it for you.
- `searchParams` mirrors Next's shape. A repeated query key arrives as
  an array (`?tag=a&tag=b` → `["a", "b"]`).
- `blockCtx` is the same render context the host passes to themes;
  use it if you call `renderBlocks(...)` inside your route.

`metadata({ params, searchParams, blockCtx })` receives the same
shape — building metadata from URL state is straightforward:

```ts
async function detailMetadata(ctx: NpRouteRenderProps) {
  const slug = ctx.params.slug;
  const doc = await findDocuments("discussions", { where: { slug }, limit: 1 });
  return buildPageMetadata({
    title: doc.docs[0]?.title ?? "Discussion",
    path: `/discussions/${slug}`,
  });
}
```

The host runs `metadata` and the page render in parallel (Next.js
behavior), so don't share mutable state between the two.

---

## Precedence

The catch-all dispatches in this order:

1. **Page slug** (`pages` collection) — operator-authored content
   always wins.
2. **Slug history redirect** — renames don't break links.
3. **Theme route** — declared on `NpThemeImpl.routes` /
   `NpThemeImpl.archives`.
4. **Plugin route** — your `pageRoutes` entries.
5. `/` empty-state fallback → `notFound()`.

So an operator who publishes a `pages` row with slug `discussions`
**shadows** the forum plugin's `/discussions` route silently. That's
intentional — operator content is authoritative.

---

## Boot warnings — collisions

The dispatcher logs once-per-pattern-per-process when:

- A theme pattern shadows a plugin pattern (theme > plugin
  precedence). Your plugin's route is silently inert.
- Two plugins claim the same pattern. The first registered wins.

```
[nexpress/plugin-routes] pattern "/discussions" registered by plugin
"my-forum" is shadowed by the active theme — the theme owns the path.
Drop the override from the theme or rename the plugin's route.
```

Both warnings name the conflicting pattern + plugin id(s).

---

## Server / client boundary

Plugin route components are **server components** by default — they
run on the host's server, can `await` the database, can call
`getSiteMember()`, and don't get hydrated.

If your route needs interactive UI (forms, useState, useRouter),
those parts go in **client components** that you import. The
recommended layout is a `./client` subpath in your plugin package:

```
my-plugin/
  src/
    index.ts                 # plugin definition + pageRoutes (server)
    client.ts                # ./client subpath aggregator
    client/
      my-form.tsx            # "use client" — the actual interactive bits
    routes/
      list.tsx               # server component, imports my-form via package self-import
```

In `routes/list.tsx`:

```ts
// Wrong — bundles the client file into dist/index.js with no
// "use client" directive at the top of the bundle, so React
// throws "useState is not a function" when the page renders.
import { MyForm } from "../client/my-form.js";

// Right — Node's exports map resolves to dist/client.js (which
// carries the "use client" banner), keeping the RSC boundary intact.
import { MyForm } from "@nexpress/plugin-my/client";
```

Configure `tsup` to mark the `./client` subpath as `external` for the
index entry, OR follow the dual-entry pattern in
[`packages/plugins/forum/tsup.config.ts`](../packages/plugins/forum/tsup.config.ts).

---

## Working with collections you defined

Plugins that ship a collection (via `defineCollection()`) often want
their routes to query that collection. The host's typed read API
(`findDiscussions`, etc.) is **codegen output that lives in the host
app** — not importable from a plugin package. Use the untyped reads
instead:

```ts
import { findDocuments } from "@nexpress/core";

interface DiscussionRow {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "archived" | "pending";
  // …
}

const result = await findDocuments<DiscussionRow>("discussions", {
  where: { slug, status: "published" },
  limit: 1,
});
```

You own the schema (`defineDiscussionsCollection`), so re-stating the
shape on the plugin side is the source of truth, not a copy.

---

## See also

- [`plugin-quickstart.md`](plugin-quickstart.md) — step-by-step from
  scaffold to running plugin.
- [`plugin-manifest.md`](plugin-manifest.md) — the manifest + non-
  manifest definition fields, including `pageRoutes`.
- [`plugin-render.md`](plugin-render.md) — `render:beforePage` hook
  for adding tags to operator-authored pages.
- [`docs/design/plugin-routes.md`](design/plugin-routes.md) —
  architectural decisions + locked contract behind this surface.
- [`packages/plugins/forum/`](../packages/plugins/forum/) — reference
  implementation: forum plugin owns `/discussions/*`.
