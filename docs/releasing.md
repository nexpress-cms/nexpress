# Releasing

**Current published baseline:** NexPress `0.4.6` and `create-nexpress 0.1.41`
(tag `v0.4.6`). The Version Packages PR remains the only supported path for
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
2. **`publish-script:` input removed from `release.yml`** so push-to-main
   doesn't try to publish before TP is configured.
3. **Operator runs `pnpm -r publish` locally** with 2FA-authenticated
   `npm login` to claim every `@nexpress/*` name + `create-nexpress`
   at version 0.1.0.
4. **Trusted Publisher configured per package** on npmjs.com
   (see "Trusted Publisher setup" below).
5. **`publish-script: pnpm run release` restored** in `release.yml`. From
   that PR onward, the normal Changesets flow takes over.

The rest of this doc describes the steady-state flow (post-bootstrap).

## Steady-state flow

NexPress uses Changesets for versioning + npm publishing. The release
workflow (`.github/workflows/release.yml`) runs on every push to
`main`:

1. **No queued changesets** → no-op. The workflow exits without
   opening a PR or publishing.
2. **Queued changesets, no Version PR yet** → opens / updates the
   "Version Packages" PR as a draft accumulator. The PR carries the cumulative
   diff (`CHANGELOG.md` per package + `package.json` version bumps) and derives
   the matching README, security-policy, and release-baseline markers from those
   generated versions. Each new main-branch changeset returns it to draft until
   the maintainer deliberately marks the final batch ready.
3. **Version PR merged** → `pnpm release` runs repository invariants, builds
   and typechecks publishable packages, publishes through Changesets, verifies
   every exact npm manifest and provenance attestation, and only then creates
   the release tag. A fixed-family version advance then dispatches the hosted
   demo updater with the exact version and release commit SHA. A main push whose
   workspace versions are already published exits before those expensive gates.

The root `release` script lives in `package.json`. Changesets reads
`.changeset/config.json`, where `access: "public"` makes scoped
packages publishable without per-package `publishConfig` blocks.
The workflow and repository use `changesets/action` v2 with Changesets CLI v3.
The action receives its GitHub authority through the explicit `github-token`
input, keeps Version PRs draft, and does not create GitHub Releases or git
tags. The verified `pnpm run release` wrapper owns tagging instead: it disables
Changesets' per-package tag fanout, verifies npm registry metadata and
provenance, and only then pushes one repository-level release tag.
`pnpm run version` runs the repository contract tests before versioning,
executes `scripts/sync-release-docs.mts`, and reruns those cheap tests against
the generated release state. Do not hand-edit release-line markers on `main`;
the generated Version PR owns the transition so public docs do not advertise
an unpublished line early.

## Auth: Trusted Publishing (OIDC)

The workflow does **not** use a standing npm token. npm 2024+ recommends
[**Trusted Publishing**][tp-docs] — a token-less auth model
backed by GitHub's OIDC. The same `id-token: write` workflow
permission that signs Sigstore provenance also lets npm verify
the workflow run's identity and grant publish access.

The optional `NPM_BOOTSTRAP_TOKEN` repository secret and exact
`NPM_BOOTSTRAP_PACKAGES` repository variable are reserved for the first publish
of brand-new package names. The variable is a comma- or newline-separated
allowlist of at most 50 exact workspace package names. Both settings must be
short-lived, narrowly scoped, and deleted immediately after the publish
succeeds.

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
   create a granular npm access token with read/write package permission and
   2FA bypass, scoped as narrowly as npm allows. Add it to the GitHub
   repository as `NPM_BOOTSTRAP_TOKEN`, set the repository Actions variable
   `NPM_BOOTSTRAP_PACKAGES` to every exact new package name (comma- or
   newline-separated), then rerun the Release workflow once. The release job
   publishes those names sequentially, tolerates a safe rerun when an exact
   version already exists, and waits for both the exact version manifest and
   the npm package metadata to converge before Changesets continues.
   Keeping the first publish in GitHub Actions preserves the provenance
   attestation required by the post-publish gate. Do not publish locally:
   local publishes cannot carry this workflow's provenance.

   > **Do not substitute `npm publish` for `pnpm publish`.** Source
   > manifests intentionally use pnpm's `workspace:*` protocol. A direct
   > npm publish from a package directory uploads those literals instead of
   > replacing them with the current fixed-group version, leaving the package
   > impossible to install outside this monorepo. Before a first publish,
   > `pnpm pack --dry-run --json` must show the expected package contents; the
   > actual publish must still run through the repository's pnpm/Changesets
   > release path.

2. **Delete the `NPM_BOOTSTRAP_TOKEN` repository secret and
   `NPM_BOOTSTRAP_PACKAGES` repository variable, then revoke the npm token** as
   soon as the first CI publish succeeds.
3. **Go to the package settings page on npmjs.com:**
   `https://www.npmjs.com/package/@nexpress/<name>/access`
4. **"Trusted Publishers" tab → Add a publisher.**
5. **Fill GitHub Actions config:**
   - Publisher type: GitHub Actions
   - Organization or user: `nexpress-cms`
   - Repository: `nexpress`
   - Workflow filename: `release.yml`
   - Environment name: leave blank (no GH environment used)
6. **Repeat for every published package.** Including `@nexpress/*`
   scoped + the unscoped `create-nexpress`. The release log prints one exact
   npm access URL per bootstrapped package; use that closed list as the
   Trusted Publisher worklist.

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

CI also packs the actual `create-nexpress` tarball and invokes its published
`bin` entry through `pnpm dlx`; it does not substitute the workspace
`dist/index.js` path. The generated project then installs every framework
tarball, typechecks its own source graph, builds, and runs the existing runtime
and extension journeys inside the single scaffold-smoke job.

The repository-level `pnpm test:repo` gate also verifies that every publishable
`@nexpress/*` workspace package belongs to the single Changesets fixed group.
It runs automatically from `pnpm test`, `pnpm verify`, `pnpm run version`, and
`pnpm run release` so a newly added package cannot silently publish at a
different family version.

If both pre-merge commands pass, the PR is safe to merge — the next push to
`main` will publish.

## Dependabot merge gate

Dependabot PRs are the exception to this repository's normal squash-merge
convention. A squash commit remains authored by `dependabot[bot]`; GitHub then
treats workflows for that default-branch commit as Dependabot-triggered, with
restricted token and secret access. That is incompatible with the Release
workflow's repository writes, npm Trusted Publishing identity, and hosted-demo
handoff. GitHub's own troubleshooting guidance recommends a merge commit for
this case: <https://docs.github.com/en/code-security/code-scanning/troubleshooting-code-scanning/resource-not-accessible>.

The repository therefore keeps merge commits enabled in both repository
settings and the active `main branch protection` ruleset specifically for this
operator path. Ordinary feature PRs and Version Packages PRs still use squash.
Never use `gh pr merge --squash` or `@dependabot squash and merge` for a
Dependabot-authored PR.

Use the approval-gated helper from a clean checkout instead:

```bash
# Read-only plan. This verifies the author, main base, exact head SHA,
# mergeability, freshness, and all four CI jobs.
pnpm merge:dependabot -- <pr-number> --json

# Copy the exact approvalToken returned by the plan.
pnpm merge:dependabot -- <pr-number> \
  --execute --approve 'dependabot-merge:<pr-number>:<40-char-head-sha>'
```

Execution uses `gh pr merge --merge --match-head-commit`, verifies that GitHub
created a two-parent merge commit, finds the exact merge SHA's `push` runs, and
waits for both CI and Release to succeed. It refuses non-Dependabot authors,
draft/stale/conflicted PRs, missing or failed checks, disabled repository merge
commits, and stale approval tokens.

If GitHub does not register both push runs within the bounded lookup window,
the command fails after the merge instead of claiming success. First confirm
that `main` still points to the reported merge SHA, then use the existing
manual escape hatches and inspect their results:

```bash
gh workflow run ci.yml --ref main
gh workflow run release.yml --ref main
gh run list --branch main --limit 10
```

Do not use a manual dispatch as the normal path. The two-parent merge commit is
the normal authority boundary; dispatch exists only to recover a missing GitHub
event after the exact merged state has already passed PR CI.

### Version PR merge gate

Version PRs still need explicit maintainer approval before merge. Do not merge
or auto-merge them just because the Changesets PR exists; first confirm that
the queued release is the batch you intended to publish.

A fixed-family minor bump requires a separate, explicit approval naming the
exact target version (for example, “publish 0.5.0”). Generic instructions to
publish, release, or update the demo authorize no minor bump. If the Version
PR crosses a minor boundary without that exact approval, stop and report both
the proposed versions and every `minor` changeset that caused the bump.

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

The Version PR bridge additionally requires `scaffold smoke (fresh scaffold
journey)` and the overall dispatched CI run to succeed before it mirrors any
of the three ruleset contexts as green. A scaffold failure therefore fails the
existing required statuses without adding another workflow job or ruleset
context.

Before merging the Version PR, verify GitHub has attached those checks to the
current `changeset-release/main` head:

```bash
gh pr view <version-pr> \
  --json mergeStateStatus,mergeable,statusCheckRollup,reviewDecision,headRefName
gh pr checks <version-pr> --watch
```

Version PRs are generated by `changesets/action` using its explicit
`github-token` input backed by `secrets.GITHUB_TOKEN`. GitHub does not
automatically fire `pull_request` workflows for commits created by that token,
so the Release workflow runs a bridge step after opening/updating the Version
PR:

1. Return the accumulator PR to draft.
2. Dispatch `ci.yml` on `changeset-release/main` and wait for it to complete.
3. Require scaffold smoke and the entire workflow to be green.
4. Mirror the three ruleset job conclusions onto the Version PR head commit as
   commit statuses named exactly like the existing contexts.

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

The publish workflow now polls npm before tagging and verifies every public
workspace package at its exact local version. It requires matching package
identity, no published `workspace:` dependency ranges, tarball integrity, and
a provenance attestation. A partial publish or stale registry response fails
the workflow before the release tag is created.

After that automated gate finishes, run the external acceptance journey:

1. `npm view @nexpress/core version` — should match the merged
   Version PR's bump.
2. `npx create-nexpress@<cli-version> test-site --yes --no-docker`, followed
   by `pnpm install`, `pnpm typecheck`, and `pnpm build` inside the generated
   project. This confirms registry resolution rather than the pre-publish local
   tarball path; clean up afterward.
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

After a fixed-family npm publish and provenance verification, the Release
workflow obtains a short-lived GitHub App installation token and dispatches the
public demo repository's **Update NexPress** workflow with the exact version and
release commit SHA. `create-nexpress`-only releases, ordinary main pushes, and
manual Release runs do not dispatch it. The exact downstream Actions run URL is
written to the Release summary.

The demo workflow verifies every installed package manifest and provenance
record, synchronizes the exact package family, generates migrations, runs the
demo gates, and opens an automation-owned draft PR. Review generated SQL and
the Vercel preview before marking that PR ready; neither workflow merges its own
update. A duplicate release dispatch is safe because an already synchronized
exact version exits without changing the lockfile or opening a PR.

The Vercel `Production` deployment status triggers the demo repository's
**Production smoke** workflow, which verifies the live readiness endpoint and
homepage against that deployment. A failed deployment remains failed rather
than accidentally probing an older production alias.

### Hosted demo GitHub App setup (one-time)

The main repository's `GITHUB_TOKEN` cannot dispatch a workflow in another
repository. Create a private GitHub App for this bridge instead of a standing
personal access token:

1. Give the App only **Actions: read and write** repository permission; leave
   webhooks disabled.
2. Install it only on `nexpress-cms/nexpress-hosted-demo`.
3. Store its Client ID as the `HOSTED_DEMO_UPDATE_APP_CLIENT_ID` Actions
   repository variable on `nexpress-cms/nexpress`.
4. Generate one App private key and store the PEM as the
   `HOSTED_DEMO_UPDATE_APP_PRIVATE_KEY` Actions repository secret on
   `nexpress-cms/nexpress`.

`actions/create-github-app-token@v3` exchanges that key for a repository-scoped
installation token and revokes the token after the Release job. The App does
not need Contents or Pull Requests permission: the dispatched demo workflow
uses its own repository `GITHUB_TOKEN` for its draft branch and PR. Rotate the
App private key through the normal repository-secret process.

If App authentication or dispatch fails after npm publish, the packages remain
published and verified. Correct the App installation/credential, rerun the
failed Release job on the same Version Packages commit, or manually run the
demo **Update NexPress** workflow with the exact version. The updater's
idempotency makes each recovery path safe.

For a local fallback from a clean demo checkout:

```bash
cd ../nexpress-hosted-demo
pnpm run update:nexpress -- <version>
pnpm run typecheck
pnpm test
pnpm build
pnpm db:check
```

`update:nexpress` generates schema migrations before the validation pass and
refuses unrelated file changes. Review and commit those migrations with the
demo PR. The production Vercel build applies them before promoting the new app.
The following probes remain the manual fallback for the automated smoke:

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
