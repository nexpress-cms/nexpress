---
"@nexpress/plugin-forum": minor
"@nexpress/next": patch
---

**PRT.3b — forum plugin owns its public routes (#623).**

The forum plugin now registers all four `/discussions/*`
routes via the `pageRoutes` field added in PRT.1, served by
the dispatcher landed in PRT.2. The host app no longer has
file-based routes for `/discussions`.

**Routes the plugin now owns:**

- `/discussions` — list page (paginated, "All / My threads"
  toggle for logged-in members)
- `/discussions/new` — create form, `surface: "member"`
- `/discussions/:slug` — detail page (with comments + JSON-LD)
- `/discussions/:slug/edit` — author-only edit form,
  `surface: "member"`

Order matters in the registration array: more-specific
patterns (`/discussions/new`, `/discussions/:slug/edit`)
precede the parametric `/discussions/:slug`. The dispatcher
is first-match-wins.

**Plugin layout:**

```
packages/plugins/forum/
  src/
    index.ts           # plugin definition + pageRoutes
    client.ts          # ./client subpath aggregator
    next-shim.d.ts     # minimal Next.js type stubs (matches @nexpress/admin)
    client/
      discussion-form.tsx              (moved from apps/web/src/components/)
      discussion-author-actions.tsx    (moved from apps/web/src/components/)
    components/
      pagination-nav.tsx               (duplicated from apps/web — only
                                        ~50 lines, plugin-local)
    routes/
      list.tsx, new.tsx, detail.tsx, edit.tsx
```

**Build pipeline.** Two-entry array config (matches
`@nexpress/admin`'s pattern) so source-side `"use client"`
directives in `src/client/*.tsx` get preserved when tsup emits
chunks. **`clean: true` lives in the npm `build` script as
`rm -rf dist && tsup`, NOT inside the tsup config**: an
in-config clean races with the parallel dts builds — when index
DTS happens to finish after client DTS, the cleanup wipes
`client.d.ts` that was already written. Same fix applied to
`@nexpress/next` (also a dual-entry package).

**Server / client boundary.** Route components (server-side)
import client widgets via the package's own subpath:

```ts
import { DiscussionForm } from "@nexpress/plugin-forum/client";
```

`@nexpress/plugin-forum/client` is in tsup's `external` list, so
the index bundle leaves the import alone. At runtime, Node
resolves the import via the package's `exports` map → loads
`dist/client.js` (which carries the `"use client"` banner) →
React's RSC compiler treats `DiscussionForm` as a client
component. Importing the same file via a relative path
(`"../client/discussion-form.js"`) would have bundled it INTO
`dist/index.js` without the directive, breaking the boundary.

**Adapter shape.** Plugin route components take
`NpRouteRenderProps` (from `@nexpress/next` — re-exported
from `@nexpress/theme` for plugin-author convenience): `params`
and `searchParams` arrive already resolved (the dispatcher
unwraps the Next.js `Promise<...>` form). This differs from
file-based Next.js routes, where `params` is a Promise.

**Untyped reads.** The plugin can't import the host's generated
`findDiscussions` (codegen lives per-app). Routes call
`findDocuments<DiscussionsDocument>("discussions", ...)` with a
locally-defined shape. The plugin owns the schema
(`defineDiscussionsCollection`), so the type definition is the
source of truth, not a copy.

**Removed from `apps/web`:**

- `src/app/(site)/discussions/` (4 files)
- `src/components/discussion-form.tsx` (moved)
- `src/components/discussion-author-actions.tsx` (moved)

The catch-all (`apps/web/src/app/(site)/[[...slug]]/page.tsx`)
needs no change — its `dispatchPluginRoute` call from PRT.2
already serves these routes.

**Deferred from PRT.2 still applies:** `surface: "member"`
plugin routes render inside the site shell (not a member
shell). Wrap awaits PRT.4 (the parallel `(member)` catch-all
for `impl.members.shell`).
