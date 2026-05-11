# @nexpress/plugin-seo-audit

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

- f0687ac: feat(seo-audit): G.2.3 — declare configSchema, wire operator-tunable thresholds into the audit logic (also fixes a latent decorative-form bug)

  Pre-G.2.3 the plugin shipped both:
  - hardcoded module-level threshold constants (`TITLE_MIN`, `TITLE_MAX`, `DESCRIPTION_MIN`, `DESCRIPTION_MAX`, `MIN_BODY_WORDS`)
  - a hand-rolled `admin.settings.fields` form for those same thresholds

  …with no glue between them. Operators could fill the form, save, and absolutely nothing would change in the audit results — the form was decorative. This release ships the G.1 auto-form path as the replacement AND wires `ctx.config` into the audit logic so the saved values actually take effect.

  Schema:

  ```ts
  z.object({
    titleMin: z.number().int().min(0).max(200).default(30),
    titleMax: z.number().int().min(10).max(300).default(60),
    descriptionMin: z.number().int().min(0).max(500).default(70),
    descriptionMax: z.number().int().min(50).max(500).default(160),
    minBodyWords: z.number().int().min(0).max(10000).default(250),
    includeDescription: z.boolean().default(true),
  });
  ```

  Wired through:
  - `auditSeo(input, config)` — pure function, exported for unit tests; takes the operator's thresholds as a second arg.
  - Hooks (`content:afterCreate`, `content:afterUpdate`) — destructure `{ data, ctx }` and pass `ctx.config` down.
  - Plugin actions (`rescanLatest`, `auditDocument`) — read `ctx.config` from setup-time closure.
  - Route handlers (`GET /analyze`, `POST /analyze`) — accept `(req, ctx)` and pass through.
  - `includeDescription: false` skips ALL description-related issue codes (was effectively a no-op flag in the dead form).

  Manifest version 0.2.0; `admin.settings` block removed (auto-form replaces it). Other admin extensions (widgets, actions, tables, dashboardWidgets, collectionTabs) untouched.

  Exports `SeoAuditConfig` (no `Np` prefix per the convention from G.2.1) and `auditSeo` (newly exported for tests / sites doing custom audits).

  Adds `zod` runtime dep + `vitest` dev dep.

  12 unit tests cover schema defaults / range validation / non-integer rejection, plugin metadata invariants (version, capabilities, no `admin.settings`, kept widgets/actions/etc.), and the operator-tuned audit logic (custom titleMin flags shorter titles, default config doesn't flag a 50-char title, includeDescription=false skips description checks, raised minBodyWords flags more docs as thin, perfect doc scores 100).

  ## block-newsletter — not in this PR

  The G.2 design doc § 5.2 originally listed `block-newsletter` alongside seo-audit, but the actual plugin is block-only with per-instance `propsSchema` (each block instance carries its own listId/buttonText/etc.). There's no plugin-global config to migrate — the "provider config" entry in the design doc was aspirational. The plugin stays unchanged in G.2.3.

### Patch Changes

- 7357e44: feat(seo-audit, core): re-enable seo-audit `.refine()` cross-field validation, pin introspector regression tests

  Closes the second G-track follow-up tracked in `docs/design/plugin-config-auto-form.md` § 10. The earlier diagnosis was wrong: Zod 4 implements `.refine()` as a `checks` array on the same `z.object`, **not** as an effects/pipe wrapper, so `_def.type` stays `"object"` and the introspector walks the shape unchanged. Verified by direct probe — a refined schema introspects identically to its unrefined twin.

  **`@nexpress/plugin-seo-audit`**:
  - Re-added the cross-field refines that G.2.3's self-review had punted on: `titleMin <= titleMax` and `descriptionMin <= descriptionMax`. A misconfigured min/max pair where min > max is unrecoverable in the audit logic (the "short-X" branch always wins for any value < min, so "long-X" is unreachable). The refine rejects at save time, so the operator notices the misconfiguration immediately rather than wondering why long-title warnings never fire.
  - Inline comment in `configSchema` records the corrected diagnosis so the next person doesn't re-derive the wrong "wrapper breaks introspection" theory.

  **`@nexpress/core`**:
  - 2 new regression tests in `themes/settings-schema.test.ts` covering single `.refine()` and chained `.refine().refine()` schemas. Pin the no-op-for-introspection contract so future Zod upgrades don't regress quietly.

  `docs/design/plugin-config-auto-form.md` § 10 entry struck through with the corrected diagnosis pointing at this PR.

  Verified
  - `pnpm --filter @nexpress/core test` — 366 tests
  - `pnpm --filter @nexpress/plugin-seo-audit test` — 12 tests
  - `pnpm typecheck` (58/58) ✓
  - `pnpm build` (31/31) ✓

- Updated dependencies [5103c65]
- Updated dependencies [b9a4e08]
- Updated dependencies [65da716]
- Updated dependencies [758092a]
- Updated dependencies [f590247]
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

- Updated dependencies [de22826]
  - @nexpress/plugin-sdk@0.1.0
