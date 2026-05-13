---
"create-nexpress": patch
---

CI now runs an end-to-end scaffold smoke job: it builds the CLI, packs every `@nexpress/*` package as a `.tgz`, scaffolds a fresh project under `$RUNNER_TEMP` with deps rewritten to `file:` tarball paths (via `.github/scripts/link-scaffold-tarballs.mjs`), then runs `pnpm install --ignore-workspace` + `tsc --noEmit` in isolation from the monorepo workspace. The job also verifies `pnpm-lock.yaml` is untouched at the end so an accidental coupling regression fails CI loudly.

Catches regressions the unit tests on `getProjectFiles` can't reach — missing deps in the emitted `package.json`, broken stubs, snapshot drift, transitive resolution failures that only surface at install time.
