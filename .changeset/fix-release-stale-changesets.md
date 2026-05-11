---
"@nexpress/web": patch
---

**Fix release workflow — stale `@nexpress/theme-minimal` refs +
`@nexpress/web` ignore-list conflict.**

After #642 unblocked the `pnpm run version` invocation, the
Release workflow surfaced two latent issues in pending
changesets:

1. **`theme-minimal` retired but still referenced.** `theme-minimal`
   was removed from the workspace in #590, but two pending
   changesets still listed it in their frontmatter
   (`breaking-np-prefix-rename`, `feat-v0.2-phase-closure`).
   `changeset version` errors hard on "package not in workspace"
   instead of silently dropping the line.

2. **`@nexpress/web` ignore-list mixed-changeset error.** With
   `apps/web` in `.changeset/config.json` `ignore`, any changeset
   that bumped `@nexpress/web` alongside library packages tripped
   "Mixed changesets that contain both ignored and not ignored
   packages are not allowed". Many existing changesets bundle the
   reference app with the libraries they exercise — the ignore was
   the friction, not the changesets.

Fix:

- Strip `theme-minimal` lines from the two affected changesets'
  frontmatter.
- Drop `@nexpress/web` from `ignore`. The package is `private:
  true` so changesets still won't publish it; only its version
  number gets bumped, which is harmless (the reference app is
  never installed from npm).

Verified: `pnpm run version` runs cleanly end-to-end locally.
