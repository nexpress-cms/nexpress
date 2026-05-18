---
"create-nexpress": patch
---

Scaffolded projects now pin every `@nexpress/*` dep to the exact patch version of the family `create-nexpress` was built against, instead of a `^0.X.0` range. A fresh `npx create-nexpress my-site` writes literals like `"@nexpress/core": "0.3.2"` into `package.json` — so a teammate running `npx create-nexpress` later against the same `create-nexpress` tarball gets the exact same runtime versions, and a new `@nexpress/*` patch released between the two `npx` calls doesn't silently flow in. Operators pick up later patches on their own schedule via `pnpm update`.

This closes the silent-drift bug that surfaced today: `create-nexpress@0.1.19` carried `SCAFFOLDED_NEXPRESS_RANGE = "^0.2.0"` even though `@nexpress/*` had moved on to the 0.3.x family — so freshly-scaffolded sites were installing 0.2.x and missing the redesigned setup wizard + admin reseed UI that landed in 0.3.x. With exact pinning the literal can't be stale: it's injected at build time from `packages/core/package.json` via tsup's `define`, and a test (`templates.test.ts`) asserts the rendered scaffold pin matches the current core version exactly.

The corollary: `create-nexpress` must republish whenever operators should scaffold against a newer `@nexpress/*` patch. Add a `create-nexpress: patch` changeset alongside any `@nexpress/*` change you want fresh scaffolds to pick up.

Also slims the publish pipeline's surface noise:

- **GitHub Releases disabled.** Every release was creating ~30 GitHub Release entries (one per package in the `fixed` group), drowning the repo's Releases page in synchronized fixed-group bumps. `createGithubReleases: false` on the changesets action stops creation; per-package `CHANGELOG.md` + Version PR body continue to carry the same information.
- **Per-package git tag fanout collapsed.** `changeset publish` was emitting one git tag per package per release (`@nexpress/admin@0.3.2`, `@nexpress/app@0.3.2`, …) — `git tag -l` had 557 entries by today, all recoverable from one tag per release event. Pass `--no-git-tag` and let `scripts/tag-release.mts` write a single annotated tag per release: `v<core-version>` for family bumps, `create-nexpress@<version>` for the rare cli-only release. Historical 25 release events were collapsed to 20 single tags out of band (5 ancient Version PR merges that never produced an npm publish were left untagged).
