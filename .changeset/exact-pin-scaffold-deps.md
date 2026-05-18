---
"create-nexpress": patch
---

Scaffolded projects now pin every `@nexpress/*` dep to the exact patch version of the family `create-nexpress` was built against, instead of a `^0.X.0` range. A fresh `npx create-nexpress my-site` writes literals like `"@nexpress/core": "0.3.2"` into `package.json` — so a teammate running `npx create-nexpress` later against the same `create-nexpress` tarball gets the exact same runtime versions, and a new `@nexpress/*` patch released between the two `npx` calls doesn't silently flow in. Operators pick up later patches on their own schedule via `pnpm update`.

This closes the silent-drift bug that surfaced today: `create-nexpress@0.1.19` carried `SCAFFOLDED_NEXPRESS_RANGE = "^0.2.0"` even though `@nexpress/*` had moved on to the 0.3.x family — so freshly-scaffolded sites were installing 0.2.x and missing the redesigned setup wizard + admin reseed UI that landed in 0.3.x. With exact pinning the literal can't be stale: it's injected at build time from `packages/core/package.json` via tsup's `define`, and a test (`templates.test.ts`) asserts the rendered scaffold pin matches the current core version exactly.

The corollary: `create-nexpress` must republish whenever operators should scaffold against a newer `@nexpress/*` patch. Add a `create-nexpress: patch` changeset alongside any `@nexpress/*` change you want fresh scaffolds to pick up.

Also disables `createGithubReleases` in the changesets action — every release was creating ~30 GitHub Releases (one per package in the `fixed` group), drowning the repo's Releases page in synchronized fixed-group bumps. Git tags + per-package `CHANGELOG.md` + the Version PR body continue to carry the same information without the page-level noise.
