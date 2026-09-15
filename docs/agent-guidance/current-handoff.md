# Current work handoff

Observed after Next.js security PR #1422 merged on 2026-09-15 10:54 UTC
(2026-09-15 19:54 KST). Verify Git state and current checks before continuing.

## Objective and authorization

- Repository: `/Users/baesw/development/nexpress`.
- The user requested the proposed Next.js security task, allowing dependency
  manifests and lockfile updates while keeping own package versions and
  changesets unchanged. [PR #1422](https://github.com/nexpress-cms/nexpress/pull/1422)
  was merged through the repository's Dependabot workflow.
- No other dependency PR, Version PR, package publication or R5 implementation
  is authorized by this handoff. No automatic Runtime/provider/worker activation,
  new credentials or provider calls. Schema and migrations remain unchanged.

## Observed checkout

- Merged implementation baseline on `main`:
  `56431bcdf4ba600a793328666536f4ed3a367d0c`.
- Verified two parents: prior main `48a056ba` and reviewed PR head `7473e739`.
  Local main was fast-forwarded to the merge and dependencies installed with
  `pnpm install --frozen-lockfile`; reference app resolves Next.js 16.3.4.
- This handoff is a subsequent documentation-only change. Verify current
  branch/HEAD, remote synchronization and ownership of pending changes.
- Live main protection requires a PR and status checks, including for docs.
  Do not rely on older guidance claiming main protection is absent.

## Implementation and evidence

- Fourteen manifests update Next.js from ^16.3.1 to ^16.3.4. The lockfile also
  updates Next/SWC and compatible Rollup/browser-data transitive dependencies.
  `baseline-browser-mapping` resolves to 2.11.22. Own package versions and
  changesets did not change.
- `.github/workflows/release.yml` now allows 35 minutes for the Version PR CI
  bridge and 45 minutes for the overall Release job. The previous 15-minute
  bridge timed out while its downstream CI later passed. Required checks,
  draft Version PR behavior and release authorization remain unchanged.
- Local verification: frozen install, 56 repository tests, `pnpm verify
--concurrency=1` (113 tasks, all uncached), `pnpm lint` (41 tasks, all uncached),
  formatting and diff checks passed. Web ESLint used the existing command-local
  8 GiB Node wrapper; no global Node setting or package script was changed.
- [PR CI 34958552229](https://github.com/nexpress-cms/nexpress/actions/runs/34958552229)
  passed all four checks on exact head `7473e7392d9fe6a97713f59bee305f1997be8c0d`.
  This includes PostgreSQL, explicit Redis/native preview, production E2E
  (69 passed) and packed scaffold/extension/first-run checks.
- Post-merge [CI 34960479358](https://github.com/nexpress-cms/nexpress/actions/runs/34960479358)
  and [Release 34960479510](https://github.com/nexpress-cms/nexpress/actions/runs/34960479510)
  target the exact merge SHA. At this observation CI was running; Release was
  retried after a GitHub 502 response during Version PR creation/update.
  Inspect final conclusions before claiming the post-merge gate passed.
- Documentation-only updates need preservation/link/format checks and
  `git diff --check`, not another application build.

## Next boundary

- Recheck GitHub dependency alerts after scanner refresh. Next.js 16.3.4 is
  above the 16.3.3 fix listed by Critical alerts #64/#66; do not confuse a
  patched lockfile with a confirmed closed GitHub alert.
- Remaining candidates include sharp, nodemailer and browserslist security
  updates. Recheck each current diff/head/base and all four required checks;
  use `pnpm merge:dependabot -- <pr>`, the exact-head approval token and
  post-merge CI/Release verification when the user authorizes the next bundle.
- R5 remains open: audit source release lacks an owner, and Action attribution
  requires the Run reference and fingerprint to be null together. Define the
  verified evidence/reference lifecycle and agree on necessary migration scope
  before implementing it. Preserve active work, unresolved usage/outcomes,
  approvals and rollback evidence. See the
  [retention matrix](../design/agentic-platform/r5-runtime-retention-flow.md).
- Structured manual-input recipes still need executor-owned storage/consumption;
  existing schema-null recipe/goal admission remains supported. Prior R5
  implementation evidence is in the
  [Runtime Studio flow](../design/agentic-platform/r5-runtime-studio-flow.md).
- Start the next requested bundle in a fresh task; reuse relevant current
  contracts and guidance instead of reloading the full implementation history.
