# @nexpress/plugin-forum

## 1.0.0

### Major Changes

- 5103c65: **BREAKING — `nx` prefix migrated to `np` everywhere.**

  The `nx`/`Nx`/`NX_`/`nx_`/`nx-`/`--nx-` prefix that NexPress used in
  TypeScript identifiers, CSS tokens, environment variables, database
  tables, cookies, HTTP headers, localStorage keys, and HTML data
  attributes is now `np`/`Np`/`NP_`/`np_`/`np-`/`--np-`. The `@nexpress/*`
  package namespace is unchanged — the brand "NexPress" is independent of
  the `nx` abbreviation. There is no compat shim.

  Shipped in five sequential PRs to keep each layer independently
  revertable; this changeset is the rollup migration guide.

  | Phase    | What renamed                                                                                                                                                                               |
  | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | 1 (#454) | TypeScript symbols (`Nx*` types/classes/interfaces, `nx*` Drizzle vars + helper functions)                                                                                                 |
  | 2 (#455) | CSS layer (`--nx-*` custom properties, `.nx-*` classes, `@layer nx-*`)                                                                                                                     |
  | 3 (#456) | ENV vars (`NX_*`) + DB tables (`nx_*` framework + collection tables)                                                                                                                       |
  | 4 (#457) | Cookies (`nx-session`/`-refresh`/`-csrf`/`-admin-site`/`-mb-*`/`-oauth-state`) + HTTP headers (`x-nx-*`) + localStorage (`nx-theme`/`nx-color-scheme`) + HTML attributes (`data-nx-theme`) |
  | 5 (this) | Documentation + this rollup                                                                                                                                                                |

  ## Migration steps for plugin / theme / site authors

  ```diff
  # 1. TypeScript imports
  -import type { NxAuthUser, NxCollectionConfig, NxBlockDefinition } from "@nexpress/core";
  +import type { NpAuthUser, NpCollectionConfig, NpBlockDefinition } from "@nexpress/core";

  -import { nxUsers, nxMedia, NxForbiddenError } from "@nexpress/core";
  +import { npUsers, npMedia, NpForbiddenError } from "@nexpress/core";

  -import { nxFetch } from "@nexpress/admin/client";
  +import { npFetch } from "@nexpress/admin/client";

  # 2. CSS overrides
  :root {
  -  --nx-color-primary: oklch(0.4 0.15 250);
  +  --np-color-primary: oklch(0.4 0.15 250);
  }
  -.nx-form-input { … }
  +.np-form-input { … }
  -@layer nx-theme { … }
  +@layer np-theme { … }

  # 3. data attribute selectors
  -:root[data-nx-theme="default"] { … }
  +:root[data-np-theme="default"] { … }
  ```

  A find/replace across the consumer's repo with these patterns covers
  the bulk:

  ```sh
  # TS symbols (compile-time only)
  perl -pi -e 's/\bNx([A-Z])/Np$1/g; s/\bnx([A-Z])/np$1/g;' \
    $(rg -l '\bNx[A-Z]|\bnx[A-Z]' --type ts --type tsx)

  # CSS tokens + classes
  perl -pi -e 's/--nx-/--np-/g; s/\bnx-/np-/g;' \
    $(rg -l -- '--nx-|\bnx-' --type css --type ts --type tsx)

  # ENV vars + DB tables
  perl -pi -e 's/\bNX_([A-Z])/NP_$1/g; s/\bnx_([a-z])/np_$1/g;' \
    $(rg -l '\bNX_|\bnx_')
  ```

  ## Migration steps for operators
  1. **Pull main + rebuild.** Every package's `dist/` regenerates with the
     new symbol names.
  2. **Update `.env`.** Rename every `NX_*` to `NP_*` in every environment
     (.env / .env.local / secrets manager / k8s / fly / etc.). The shipped
     `.env.example` lists every name; the boot zod error now points at
     `NP_*`.
  3. **Generate + apply the table-rename migration.**
     ```sh
     pnpm db:generate     # produces apps/web/drizzle/0031_*.sql
     # Review the SQL — every line should be ALTER TABLE nx_X RENAME TO np_X.
     pnpm db:migrate      # runs the rename in a transaction
     ```
     Indexes and FK constraints stay functional after the rename
     (Postgres tracks them by oid). Their NAMES still contain `nx_` until
     a subsequent `db:generate` cleans them up — purely cosmetic.
  4. **Restart the process.** `defineConfig` reads env vars at boot.
  5. **Active sessions invalidate once.** Every staff + member user with
     a browser holding `nx-session`/`nx-mb-session` reauths on next
     request — the new code reads `np-session`/`np-mb-session` only. No
     compat shim. Plan a maintenance window if logged-out alerts to every
     operator on deploy is unwelcome.
  6. **External tooling** that set or read `nx-*` cookies, the
     `x-nx-admin-site` header, or `data-nx-theme` attribute must update.

  For multi-node operators: stage the migration. Old-code nodes will 500
  on every query against the renamed tables; reading the new cookies
  fails on old binaries.

  ## What is NOT renamed
  - **Package names.** `@nexpress/*` stays — the brand "NexPress" is the
    product identity, not the `nx` abbreviation.
  - **Display strings.** "NexPress" in UI copy / documentation prose is
    unchanged.
  - **Existing migration SQL.** The `0000–0030_*.sql` history files in
    `apps/web/drizzle/` are frozen — they record what the old schema
    looked like. The new rename migration sits on top.

### Minor Changes

- 9f3a81b: **PRT.3b — forum plugin owns its public routes (#623).**

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

### Patch Changes

- afefb19: **`/u/<handle>/discussions` moves to the forum plugin.**

  The member-profile sub-page that lists a member's published
  discussion threads is now part of `@nexpress/plugin-forum`'s
  `pageRoutes`. It used to live as a Next.js file route in
  `apps/web/src/app/(site)/u/[handle]/discussions/page.tsx`.

  Same content, different owner. The route is registered as
  `/u/:handle/discussions` (segment count 3, mixed literal +
  param) so it doesn't collide with the existing `/discussions/*`
  patterns the plugin already owns.

  The plugin route uses `cache(getMemberProfile)` from React so
  `generateMetadata` and the page render dedupe the member
  lookup — same per-request memoization the host's deleted
  `getCachedMemberProfile` helper provided.

  Removed from `apps/web`:
  - `src/app/(site)/u/[handle]/discussions/page.tsx`
  - `src/lib/cached-content.ts` (its only consumer was the page
    above; no remaining call sites)

  Implication: disabling the forum plugin removes both
  `/discussions/*` AND `/u/<handle>/discussions`. The profile
  root `/u/<handle>` remains a host concern (general profile
  chrome) and works regardless of forum's enabled state.

- 7bd7732: **Fresh-build DTS race for self-import packages — fixes CI
  Release / CI workflows failing on first push.**

  When push-time CI triggers were restored in #640, both
  workflows failed at the build step on
  `@nexpress/plugin-block-newsletter`. Root cause: the package
  imports its own `./client` subpath (so tsup keeps the
  `"use client"` boundary visible to Next), and on a fresh build
  (no cached dist), the dts step for the `index` entry tries to
  resolve `@nexpress/plugin-block-newsletter/client` while the
  **other entry's dts is still emitting** — `dist/subscribe-form.d.ts`
  doesn't exist yet, the `exports` map can't resolve, build
  fails with "Could not find a declaration file".

  Locally this didn't surface because incremental builds had a
  stale dist sitting in place from previous runs; the resolution
  walk hit pre-existing files.

  The same shape exists in `@nexpress/plugin-forum` (its
  `routes/*.tsx` files self-import from
  `@nexpress/plugin-forum/client`). Forum's build doesn't
  currently fail because its two-entry array config happens to
  finish the smaller `client` dts first by timing, but the
  behavior is timing-dependent and would break under different
  machine load.

  Fix: ambient `*.d.ts` shim in each affected package that
  pre-declares the self-import:
  - `packages/plugins/block-newsletter/src/self-shim.d.ts`
  - `packages/plugins/forum/src/self-shim.d.ts`

  ```ts
  declare module "@nexpress/plugin-block-newsletter/client" {
    export { SubscribeForm } from "./subscribe-form.js";
  }
  ```

  The shim lets the dts resolver see the module's types without
  crossing into the `exports` map → filesystem path. Runtime
  imports still go through `exports` at consumer load time, so
  the `"use client"` RSC boundary stays intact.

  Verified: `pnpm build` (fresh, all dist removed) — 30/30 tasks
  pass.

- Updated dependencies [5103c65]
- Updated dependencies [c40cded]
- Updated dependencies [c40cded]
- Updated dependencies [ab9c759]
- Updated dependencies [2eb505d]
- Updated dependencies [b9a4e08]
- Updated dependencies [8bed938]
- Updated dependencies [131be43]
- Updated dependencies [4ebf2b4]
- Updated dependencies [5203fd7]
- Updated dependencies [9f3a81b]
- Updated dependencies [65da716]
- Updated dependencies [0c59b98]
- Updated dependencies [f778e80]
- Updated dependencies [89c32db]
- Updated dependencies [53627e1]
- Updated dependencies [98d3a4e]
- Updated dependencies [6657059]
- Updated dependencies [ae0c053]
- Updated dependencies [a107c8a]
- Updated dependencies [f98fe9c]
- Updated dependencies [9f3a81b]
- Updated dependencies [d3ea817]
- Updated dependencies [cf5db32]
- Updated dependencies [580f0f2]
- Updated dependencies [225d6a1]
- Updated dependencies [f239ce0]
- Updated dependencies [bb55974]
- Updated dependencies [758092a]
- Updated dependencies [ad7ea4e]
- Updated dependencies [ca1722e]
- Updated dependencies [4d5aeba]
- Updated dependencies [006be38]
- Updated dependencies [b78dbbc]
- Updated dependencies [7357e44]
- Updated dependencies [9c3cd89]
- Updated dependencies [930d0d4]
- Updated dependencies [2c31d26]
- Updated dependencies [1f8fbdf]
- Updated dependencies [7b61ba8]
- Updated dependencies [463fe5f]
- Updated dependencies [09a7b75]
- Updated dependencies [ea608af]
- Updated dependencies [5efa580]
- Updated dependencies [8790088]
- Updated dependencies [fe45743]
- Updated dependencies [ddbb536]
- Updated dependencies [ab55980]
- Updated dependencies [41ac5d2]
- Updated dependencies [6772bf2]
- Updated dependencies [f5df65e]
- Updated dependencies [b42d8ff]
- Updated dependencies [e66e922]
- Updated dependencies [3eeac73]
- Updated dependencies [7c0eb2e]
- Updated dependencies [f590247]
- Updated dependencies [15aa1d4]
- Updated dependencies [89c7180]
- Updated dependencies [6483de7]
  - @nexpress/blocks@1.0.0
  - @nexpress/core@1.0.0
  - @nexpress/editor@1.0.0
  - @nexpress/next@1.0.0
  - @nexpress/plugin-sdk@1.0.0

## 0.1.0

### Minor Changes

- de22826: Publish-readiness sweep — package metadata, license, and publishability.

  Every `@nexpress/*` library and `create-nexpress` becomes publishable
  to npm: `"private": true` removed, full metadata added (description,
  license, repository with `directory`, author, bugs, homepage, keywords,
  engines.node), and a `prepublishOnly: "pnpm build"` safety net so a
  one-off `pnpm publish` from inside a package directory still rebuilds
  before tarball.

  A repo-root `LICENSE` (MIT) is added and copied into every published
  package's directory so each tarball ships its own license file (npm
  auto-includes LICENSE at the package root, but only if the file
  actually lives there — repo-root licenses don't propagate).

  `apps/web` (the reference app) stays `"private": true` — it's not a
  distributable package.

  No code change; this is publish-bookkeeping only. Versions move from
  `0.0.0` (or `0.1.0` for the existing plugin packages) to a coherent
  `0.1.0` floor when `pnpm changeset version` runs against all currently
  queued changesets.

### Patch Changes

- Updated dependencies [952483c]
- Updated dependencies [4c01668]
- Updated dependencies [75f65a2]
- Updated dependencies [de22826]
  - @nexpress/core@0.1.0
  - @nexpress/plugin-sdk@0.1.0
