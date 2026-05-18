---
"create-nexpress": patch
---

Release workflow now finds `tsx` when invoking the post-publish tag script. Today's v0.3.3 release went through npm publish cleanly but the workflow exited 1 at the trailing `tsx scripts/tag-release.mts` step with `sh: 1: tsx: not found` — `tsx` was only declared in `apps/web` devDeps and pnpm's `shamefully-hoist=false` keeps transitive workspace deps off the root `node_modules/.bin`. Locally the `tsx` symlink was a leftover from a prior install with different hoist behavior, masking the issue.

Also tightens `scripts/tag-release.mts`'s release-kind detection. The previous logic ("if `v<core>` doesn't exist on origin → family release, else cli-only") misfired when a `v<core>` tag had been manually created out of band (e.g. recovery after a failed CI run). The new logic compares the current `@nexpress/core` + `create-nexpress` versions to the previous `chore(release): version packages` commit's versions — unambiguous about what actually changed in this Version PR.

Two side effects from today's recovery:

- `v0.3.3` was created manually since the release workflow had already published to npm but exited 1 before tagging. The tag points at the correct merge commit.
- A spurious `create-nexpress@0.1.20` tag from a local dry-run was pushed out of band and immediately deleted. Origin's tag set is back to the 20-tag whitelist + `v0.3.3`.
