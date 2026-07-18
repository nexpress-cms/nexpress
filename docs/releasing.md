# Releasing

**Current published baseline:** NexPress `0.4.1` and `create-nexpress 0.1.36`
(tag `v0.4.1`). The Version Packages PR remains the only supported path for
normal package version bumps; merge it only after its generated changelogs,
package versions, local verification, and required CI have been reviewed.

## Bootstrap (one-time, v0.1.0 first publish) — completed

> **Status:** Completed for v0.1.0 (published 2026-05-12). This
> section is kept as a historical reference; the steady-state flow
> below is what every subsequent release follows.

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
3. **Version PR merged** → `pnpm release` runs repository invariants, builds
   publishable packages, publishes through Changesets, and creates the release
   tag. The workflow uploads the new tarballs with Sigstore provenance.

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
clicking once for every package in the fixed Changesets group:

1. **Package must already exist on npm.** TP can't be configured
   for a name that doesn't exist yet. For first-time publishes,
   either:
   - **Path A:** Publish each package once locally with
     `pnpm publish --access public` + 2FA. Then proceed to step 2.
   - **Path B:** Use a one-shot classic Automation token for
     the first CI publish, then add TP configs, then revoke
     the token. ("Bypass 2FA" warning is acceptable for a
     token that lives only minutes.)

   > **Do not substitute `npm publish` for `pnpm publish`.** Source
   > manifests intentionally use pnpm's `workspace:*` protocol. A direct
   > npm publish from a package directory uploads those literals instead of
   > replacing them with the current fixed-group version, leaving the package
   > impossible to install outside this monorepo. Before a first publish,
   > `pnpm pack --dry-run --json` must show the expected package contents; the
   > actual publish must still run through `pnpm publish`.

2. **Go to the package settings page on npmjs.com:**
   `https://www.npmjs.com/package/@nexpress/<name>/access`
3. **"Trusted Publishers" tab → Add a publisher.**
4. **Fill GitHub Actions config:**
   - Publisher type: GitHub Actions
   - Organization or user: `nexpress-cms`
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

`pnpm ux-audit` requires Docker. It generates a local-mode app under the real
`apps/*` workspace, links it without changing `pnpm-lock.yaml`, creates an
isolated database in the repository Postgres service, generates and pushes the
fresh schema, completes non-interactive first boot (site, theme, and admin),
and probes both `next dev` and `next start`. The scaffold and database are
removed afterward, and a database service started by the audit is stopped
again. Use `--quick` to skip only the production probe or `--keep` to preserve
both artifacts for diagnosis.

The repository-level `pnpm test:repo` gate also verifies that every publishable
`@nexpress/*` workspace package belongs to the single Changesets fixed group.
It runs automatically from `pnpm test`, `pnpm verify`, `pnpm run version`, and
`pnpm run release` so a newly added package cannot silently publish at a
different family version.

If both pre-merge commands pass, the PR is safe to merge — the next push to
`main` will publish.

### Version PR merge gate

Version PRs still need explicit maintainer approval before merge. Do not merge
or auto-merge them just because the Changesets PR exists; first confirm that
the queued release is the batch you intended to publish.

The default branch is guarded by a repository ruleset, not the legacy branch
protection endpoint. If `gh api repos/nexpress-cms/nexpress/branches/main/protection`
returns `Branch not protected`, inspect rulesets instead:

```bash
gh api repos/nexpress-cms/nexpress/rulesets \
  --jq '.[] | select(.target == "branch") | {name,enforcement,conditions,rules}'
```

The active `main branch protection` ruleset requires these PR checks:

- `typecheck + build + test`
- `integration tests (Postgres)`
- `E2E (Playwright)`

Before merging the Version PR, verify GitHub has attached those checks to the
current `changeset-release/main` head:

```bash
gh pr view <version-pr> \
  --json mergeStateStatus,mergeable,statusCheckRollup,reviewDecision,headRefName
gh pr checks <version-pr> --watch
```

Version PRs are generated by `changesets/action` with `GITHUB_TOKEN`. GitHub
does not automatically fire `pull_request` workflows for commits created by
that token, so the Release workflow runs a bridge step after opening/updating
the Version PR:

1. Dispatch `ci.yml` on `changeset-release/main`.
2. Wait for the CI run to complete.
3. Mirror the required job conclusions onto the Version PR head commit as
   commit statuses named exactly like the ruleset contexts.

If `statusCheckRollup` is empty or the PR remains `BLOCKED`, inspect the
Release workflow's `Bridge Version PR CI into required checks` step first:

```bash
gh run list --workflow Release --branch main --limit 5
gh run view <release-run-id> --log-failed
```

Only use an admin merge after the bridge has visibly posted green required
statuses and the maintainer has approved publishing this batch.

```bash
gh pr merge <version-pr> --squash --delete-branch
# Fallback only after the checks above are green and approval is explicit:
gh pr merge <version-pr> --squash --delete-branch --admin
```

Avoid `--auto` for Version PRs. In practice it can stay queued behind a stale
ruleset state while the publish decision looks complete to the operator.

## Post-publish verification

After the publish workflow run finishes:

1. `npm view @nexpress/core version` — should match the merged
   Version PR's bump.
2. `npx create-nexpress test-site --yes --no-docker` — scaffolds and
   runs without errors (clean up after).
3. `npm view @nexpress/core --json | jq '.dist.attestations'` —
   should show a non-null attestation block (provenance).

If npm did not change after a merged Version PR, check the push-to-`main`
Release run first:

```bash
gh run list --workflow Release --branch main --limit 5
gh run view <run-id> --log-failed
```

Then confirm no orphan changesets are left on `main`:

```bash
ls .changeset | grep -vE '^(README\.md|config\.json)$' || true
```

Any orphan file means the Version PR was merged from a stale head. Let the
freshly updated Version PR absorb it, or merge a follow-up PR that clears the
orphan before trying to publish again.

## Hosted demo update

After npm publishes, update the public demo repo before starting the next large
feature batch:

```bash
cd ../nexpress-hosted-demo
pnpm up '@nexpress/*@<version>' '@nexpress/cli@<version>' --save-exact
pnpm install
pnpm typecheck
pnpm build
pnpm db:check
```

If `pnpm db:check` reports schema drift, run `pnpm db:generate`, review and
commit the generated migration, then apply it to the managed demo database
before merging the demo PR. Once the demo PR merges, verify production:

```bash
curl -I -L https://nexpress-hosted-demo.vercel.app/api/health/ready
curl -I -L https://nexpress-hosted-demo.vercel.app
```

## Package Checklist

Before a public release, every published package should have:

- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `package.json` metadata with repository, homepage, bugs, keywords, and files
- a dry-run tarball check via `pnpm pack --dry-run --json`

The reference app package `@nexpress/web` is private and ignored by Changesets.
