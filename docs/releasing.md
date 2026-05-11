# Releasing

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

## Required secrets

The workflow needs `NPM_TOKEN` as a GitHub repository secret with
publish rights on:

- the `@nexpress` npm scope (for every `@nexpress/*` package), and
- the unscoped `create-nexpress` package.

A classic Automation token works. The npm UI lets you scope a token
to specific packages — preferred over an all-access token for the
bot.

`permissions.id-token: write` (already set in the workflow) is what
npm uses to sign provenance via Sigstore; combined with
`NPM_CONFIG_PROVENANCE: "true"` the published tarballs carry an
attestation pointing at the workflow run that produced them.

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
