# Current work handoff

Observed after Nodemailer PR #1433 merged on 2026-09-15 12:49 UTC
(21:49 KST). Verify Git state and final workflow conclusions before continuing.

## Objective and authorization

- Repository: `/Users/baesw/development/nexpress`.
- The user authorized the recommended Nodemailer security update, its merge
  and post-merge verification. [PR #1433](https://github.com/nexpress-cms/nexpress/pull/1433)
  was merged through the repository's Dependabot workflow.
- Own package versions, changesets, schema and migrations remain unchanged.
  Dependency manifests and lockfile changes were authorized for this bundle.
- No other dependency PR, Version PR, package publication or R5 implementation
  is authorized by this handoff. No automatic Runtime/provider/worker activation,
  new credentials, provider calls or external email delivery.

## Observed checkout

- Implementation baseline: `main` at
  `85bb8b35c330a64f2b9adf950132f770c4e7b068`.
- The merge contains prior main `d344b3c6` and reviewed PR head `2fde9d60`.
  Local main was fast-forwarded before this subsequent documentation update.
- Verify current HEAD, remote synchronization and ownership of pending changes.
  Main protection requires a PR and checks, including documentation changes;
  never rely on bypass privileges or obsolete direct-push guidance.

## Implementation and evidence

- `apps/web/package.json` selects Nodemailer ^9.1.1. The lockfile resolves both
  the app and Core's optional peer to 9.1.1, with no older Nodemailer entries.
  Core's public peer range remains unchanged. Compatible Rollup patch entries
  update from 4.63.1 to 4.63.3 with their platform packages.
- Self-review found the original app-only update left Core's optional peer at
  9.0.1. The final lockfile removes it. Frozen installation and explicit runtime
  resolution checks passed for both app and Core.
- Local verification: verify 113 tasks and lint 41 tasks passed uncached before
  the peer correction, then passed from cache on the final lockfile. Core's full
  1,920 unit tests were rerun without Turbo caching on 9.1.1; all passed.
  All 25 email tests and a direct app SMTP envelope/text/HTML smoke passed using
  loopback capture only. Formatting, manifest preservation and diff checks passed.
- [PR CI 34968856260](https://github.com/nexpress-cms/nexpress/actions/runs/34968856260)
  passed all four checks on exact head `2fde9d6017e51f2b6190e5d3632427341b25b8e2`:
  build/typecheck/unit tests, PostgreSQL and explicit Redis, production E2E
  with isolated native preview, and packed scaffold/extension/first-run checks.
- Exact-merge [CI 34971192693](https://github.com/nexpress-cms/nexpress/actions/runs/34971192693)
  and [Release 34971192724](https://github.com/nexpress-cms/nexpress/actions/runs/34971192724)
  were running at this checkpoint. Inspect their final conclusions and the
  linked PR's final evidence before claiming the post-merge gate passed.
- GitHub's refreshed open-alert inventory contains only sharp #67 and
  browserslist #62 (both High); the four Nodemailer alerts are no longer open.

## Next boundary

- Next candidate: sharp security PR #1409, then browserslist. Recheck current
  alerts, diff/head/base and all four required checks; do not merge automatically.
  Dependabot work uses `pnpm merge:dependabot -- <pr>`, its exact-head token and
  post-merge CI/Release verification when the user authorizes the next bundle.
- R5 remains open: audit source release lacks an owner, and Action attribution
  requires the Run reference and fingerprint to be null together. Define the
  evidence/reference lifecycle and agree on necessary migration scope first.
  Preserve active work, unresolved usage/outcomes, approvals and rollback
  evidence. See the [retention matrix](../design/agentic-platform/r5-runtime-retention-flow.md).
- Structured manual-input recipes still need executor-owned storage/consumption;
  existing schema-null recipe/goal admission remains supported. Prior R5 evidence
  is in the [Runtime Studio flow](../design/agentic-platform/r5-runtime-studio-flow.md).
- Start the next requested bundle in a fresh task. Reuse current contracts and
  relevant guidance instead of reloading the full implementation history.
