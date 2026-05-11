---
"@nexpress/web": patch
---

**Enable npm publish + restore push-time CI triggers.**

Activates the dormant publish pipeline that's been sitting in
`.github/workflows/release.yml` since #393. Three workflow
changes:

1. **`release.yml`** — `push: main` trigger uncommented;
   `publish: pnpm release` re-added to the changesets/action
   step; `NPM_TOKEN` + `NPM_CONFIG_PROVENANCE: "true"` env
   passed through.

2. **`ci.yml`** — `push: main` + `pull_request` triggers
   uncommented. Without push-time CI, a broken `main` could
   propagate to npm before anyone caught it.

3. **`docs/releasing.md`** — rewrite from "deferred / how to
   activate" into "active / how to operate". Adds pre-merge
   smoke (`pnpm verify` + `pnpm ux-audit`) and post-publish
   verification (`npm view`, smoke `npx create-nexpress`,
   attestation check).

## Operational flow after merge

The changesets/action's design is safe-by-default:

- Push to `main` with queued changesets (137 entries today)
  → opens / updates the "Version Packages" PR. No publish.
- Version Packages PR merged → next push has zero changesets
  → publish step fires with `pnpm release`.

So merging this PR does NOT immediately publish. It opens a
Version PR. The publish only triggers when THAT PR merges.

## What the operator must do before merging this PR

Provision `NPM_TOKEN` as a GitHub repository secret. Scope it
to:

- the `@nexpress` npm scope (every `@nexpress/*` package), and
- the unscoped `create-nexpress` package.

Without the token, the publish step would `ENEEDAUTH` —
catastrophic for a release run. Adding the secret first
removes that risk.
