# Releasing

## Bootstrap (one-time, v0.1.0 first publish)

The first publish doesn't use the standard Changesets flow because
Trusted Publishing requires the package name to already exist on npm.
The v0.1.0 release was bootstrapped by:

1. **All pending `.changeset/*.md` deleted** on the bootstrap branch.
   The pre-v0.1.0 development cumulative changelog lives in the git
   log; the published 0.1.0 starts a fresh changelog from this point.
2. **`publish:` step removed from `release.yml`** so push-to-main
   doesn't try to publish before TP is configured.
3. **Operator runs `pnpm -r publish` locally** with 2FA-authenticated
   `npm login` to claim every `@nexpress/*` name + `create-nexpress`
   at version 0.1.0.
4. **Trusted Publisher configured per package** on npmjs.com
   (see "Trusted Publisher setup" below).
5. **`publish: pnpm run release` restored** in `release.yml`. From
   that PR onward, the normal Changesets flow takes over.

The rest of this doc describes the steady-state flow (post-bootstrap).

## Steady-state flow

NexPress uses Changesets for versioning + npm publishing. The release
workflow (`.github/workflows/release.yml`) runs on every push to
`main`:

1. **No queued changesets** → no-op. The workflow exits without
   opening a PR or publishing.
2. **Queued changesets, no Version PR yet** → opens / updates the
   "Version Packages" PR. The PR carries the cumulative diff
   (`CHANGELOG.md` per package + `package.json` version bumps).
3. **Version PR merged** → `pnpm release` (= `pnpm build && changeset
   publish`) pushes the new tarballs to npm with Sigstore provenance.

The root `release` script lives in `package.json`. Changesets reads
`.changeset/config.json`, where `access: "public"` makes scoped
packages publishable without per-package `publishConfig` blocks.

## Auth: Trusted Publishing (OIDC)

The workflow does **not** use `NPM_TOKEN`. npm 2024+ recommends
[**Trusted Publishing**][tp-docs] — a token-less auth model
backed by GitHub's OIDC. The same `id-token: write` workflow
permission that signs Sigstore provenance also lets npm verify
the workflow run's identity and grant publish access.

[tp-docs]: https://docs.npmjs.com/trusted-publishers

**Why TP over classic tokens:**
- No long-lived secret in repo settings to leak / rotate.
- Audit trail tied to specific workflow runs (every publish is
  attributable to a commit + workflow).
- npm UI warns when creating a classic Automation token that
  bypasses 2FA: "For automation or CI/CD uses, please use
  Trusted Publishing instead."

### Trusted Publisher setup (one-time)

For every package the workflow needs to publish, register the
workflow as a Trusted Publisher on npmjs.com. Per-package
clicking, ~25 entries for this monorepo:

1. **Package must already exist on npm.** TP can't be configured
   for a name that doesn't exist yet. For first-time publishes,
   either:
   - **Path A:** Publish each package once locally with
     `pnpm publish --access public` + 2FA. Then proceed to step
     2.
   - **Path B:** Use a one-shot classic Automation token for
     the first CI publish, then add TP configs, then revoke
     the token. ("Bypass 2FA" warning is acceptable for a
     token that lives only minutes.)
2. **Go to the package settings page on npmjs.com:**
   `https://www.npmjs.com/package/@nexpress/<name>/access`
3. **"Trusted Publishers" tab → Add a publisher.**
4. **Fill GitHub Actions config:**
   - Publisher type: GitHub Actions
   - Organization or user: `hahabsw`
   - Repository: `nexpress`
   - Workflow filename: `release.yml`
   - Environment name: leave blank (no GH environment used)
5. **Repeat for every published package.** Including `@nexpress/*`
   scoped + the unscoped `create-nexpress`. The post-publish
   verification step below lists what was published — use it
   as the worklist.

After the configs are in place, subsequent CI publishes work
silently — no token, no prompts, no rotation.

### Provenance attestation

`NPM_CONFIG_PROVENANCE: "true"` + `id-token: write` →
published tarballs carry a Sigstore signature pinning them to
the GHA workflow run that built them. Installers can verify
via `npm view <pkg> --json | jq '.dist.attestations'`. No
extra setup beyond the workflow flag.

## Pre-merge smoke for the Version PR

Before merging the Version Packages PR (which is what triggers the
actual publish), run the full local verification — CI already does
this on push, but a clean local run catches issues that depend on
the operator's working tree:

```bash
pnpm verify            # build + typecheck + test
pnpm ux-audit          # fresh-scaffold smoke (boots a generated app)
```

If both pass, the PR is safe to merge — the next push to `main` will
publish.

## Post-publish verification

After the publish workflow run finishes:

1. `npm view @nexpress/core version` — should match the merged
   Version PR's bump.
2. `npx create-nexpress test-site --yes --no-docker` — scaffolds and
   runs without errors (clean up after).
3. `npm view @nexpress/core --json | jq '.dist.attestations'` —
   should show a non-null attestation block (provenance).

## Package Checklist

Before a public release, every published package should have:

- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `package.json` metadata with repository, homepage, bugs, keywords, and files
- a dry-run tarball check via `pnpm pack --dry-run --json`

The reference app package `@nexpress/web` is private and ignored by Changesets.
