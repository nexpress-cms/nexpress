---
"@nexpress/admin": major
"@nexpress/blocks": major
"@nexpress/core": major
"@nexpress/editor": major
"@nexpress/next": major
"@nexpress/plugin-forum": major
"@nexpress/plugin-oauth-github": major
"@nexpress/plugin-oauth-google": major
"@nexpress/plugin-reading-time": major
"@nexpress/plugin-sdk": major
"@nexpress/plugin-seo-audit": major
"@nexpress/rate-limiter-redis": major
"@nexpress/theme": major
"@nexpress/theme-default": major
"@nexpress/theme-magazine": major
"@nexpress/theme-portfolio": major
"@nexpress/wp-import": major
"@nexpress/xliff": major
"create-nexpress": major
---

**BREAKING — `nx` prefix migrated to `np` everywhere.**

The `nx`/`Nx`/`NX_`/`nx_`/`nx-`/`--nx-` prefix that NexPress used in
TypeScript identifiers, CSS tokens, environment variables, database
tables, cookies, HTTP headers, localStorage keys, and HTML data
attributes is now `np`/`Np`/`NP_`/`np_`/`np-`/`--np-`. The `@nexpress/*`
package namespace is unchanged — the brand "NexPress" is independent of
the `nx` abbreviation. There is no compat shim.

Shipped in five sequential PRs to keep each layer independently
revertable; this changeset is the rollup migration guide.

| Phase | What renamed |
|-------|--------------|
| 1 (#454) | TypeScript symbols (`Nx*` types/classes/interfaces, `nx*` Drizzle vars + helper functions) |
| 2 (#455) | CSS layer (`--nx-*` custom properties, `.nx-*` classes, `@layer nx-*`) |
| 3 (#456) | ENV vars (`NX_*`) + DB tables (`nx_*` framework + collection tables) |
| 4 (#457) | Cookies (`nx-session`/`-refresh`/`-csrf`/`-admin-site`/`-mb-*`/`-oauth-state`) + HTTP headers (`x-nx-*`) + localStorage (`nx-theme`/`nx-color-scheme`) + HTML attributes (`data-nx-theme`) |
| 5 (this) | Documentation + this rollup |

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
