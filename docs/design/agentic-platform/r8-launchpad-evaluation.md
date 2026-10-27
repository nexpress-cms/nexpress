# R8 Launchpad evaluation

Decision recorded 2026-10-23 for AP-806: **defer a hosted/ephemeral Launchpad
service; continue the ordinary local repository workflow.** No hosted provider,
service, paid test or deployment was evaluated or activated. This is an
architecture decision. The [recorded local R8 acceptance](build-agent-and-site-blueprint.md#current-local-implementation)
was subsequently completed on 2026-10-27; that scoped result does not establish
hosted service readiness.

The coordinator's final local acceptance gate must precede hosted adoption:
[all ten product criteria](build-agent-and-site-blueprint.md#13-acceptance-criteria),
the [Build test matrix](testing-and-evaluation.md#11-build-plane-generation-tests)
and the [R8 completion sequence](build-agent-and-site-blueprint.md#15-r8-completion-sequence)
remain the authority for evidence and unresolved blockers. The
[roadmap](implementation-roadmap.md#r8--build-plane-prompt-to-site) requires an
owned normal project, reviewed migration evidence and packed-scaffold
acceptance; hosting is not needed to obtain that outcome.

## Foundation and remaining service boundaries

| Area                        | Current local implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Required before hosted adoption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy and credentials     | [Docker transport](../../../packages/cli-nexpress/src/site-build/docker-host.ts) selects a local Unix socket and then uses a private empty configuration. It is a local OS-principal boundary, with no tenant identity, job authorization or hosted credential broker.                                                                                                                                                                                                                                                           | A job must own an isolated execution environment, repository snapshot, storage namespace and artifact access policy. Keep Docker control, Git/deploy credentials and coding-agent/provider credentials outside project execution. Never mount a developer home, production database or shared live worktree.                                                                                                                                                                                                                |
| Dependency preparation      | [Linux provisioning](../../../packages/cli-nexpress/src/site-build/linux-project.ts) copies reviewed inputs/local tarballs, preserves source manifest/lock bytes, installs with pinned pnpm, frozen lockfile and disabled lifecycle/pnpmfile hooks, then observes Linux packages. Registry installation uses bridge networking; later probes use no network.                                                                                                                                                                     | Restrict provisioning egress at the host/proxy layer, including DNS, redirects, byte/rate limits and private-address denial. Add disk/inode quotas to dependency/store directories and aggregate job limits. The fixed registry argument and install timeout alone are not an egress or storage sandbox.                                                                                                                                                                                                                    |
| Schema, migration and build | [Linux build](../../../packages/cli-nexpress/src/site-build/linux-build.ts) invokes existing schema/migration owners and the installed Next CLI in a private copy, checks source deltas and exports bounded outputs after removing the builder. Its preparation profile limits tmpfs to 4 GiB/131,072 inodes, memory to 4 GiB and processes to 512, with no network.                                                                                                                                                             | Preserve exact command/source/package bindings and separate logs from reproducible results. Generate/review SQL; apply it only to disposable synthetic preview PostgreSQL. Never accept a production connection. A successful Next build does not replace format/typecheck/lint/tests/Doctor/verify or the complete packed-scaffold journey.                                                                                                                                                                                |
| Preview and capsule         | [Render capsules](../../../packages/cli-nexpress/src/site-build/render-capsule.ts) inventory bounded copied inputs and omit credentials. The [fixed driver](../../../packages/cli-nexpress/src/site-build/render-driver.ts) uses ordinary Next, synthetic PostgreSQL and Chromium. The [Linux sandbox](../../../packages/cli-nexpress/src/site-build/linux-sandbox.ts) requests read-only source, no container network, finite CPU/memory/process/time limits and native descendant/attempt auditing before accepting artifacts. | Retain independently verified normal-route/member/anonymous and fresh-rerender gates for every adopted supplier graph. The native supervisor already limits each job to 1 GiB of nonrefundable writes, 256 MiB per file and 16,384 creation operations. Add aggregate hosted filesystem, retained-volume and multi-job quotas; artifact retrieval limits alone do not provide those service-wide bounds. A future browser UI must expose authenticated immutable artifacts, not an unrestricted long-lived app/server port. |
| Repository continuation     | [Private file-plan preparation](../../../packages/cli-nexpress/src/site-build/repository-edit-plan.ts) separates candidate edits from the original. [Publication](../../../packages/cli-nexpress/src/site-build/repository-publication.ts) checks hashes, modes, dirty overlaps and FD leases, but explicitly allows partial writes on failure and is not atomic against an uncooperative process with the same principal.                                                                                                       | Export a reviewable patch/project and evidence first. Hosted Git continuation needs a separately authorized exact repository/branch, fresh baseline/commit checks and expected-ref compare-and-swap. Do not treat filesystem leases as a Git transaction or perform rollback over concurrent edits.                                                                                                                                                                                                                         |
| Handoff and deployment      | [Local handoff](../../../packages/cli-nexpress/src/site-build/build-handoff.ts) binds artifacts and observed results, reports missing evidence and supplies ordinary Git/deploy-plan/preflight/release commands. It grants no commit, push, PR, migration-apply, deployment or Runtime authority.                                                                                                                                                                                                                                | Keep publication/deployment as separate authorized continuations through existing owners. Deliver source, schema/SQL, fixtures, previews and hash-linked observations so the developer can continue without Launchpad. No hosted dependency or secret may be required by the generated application.                                                                                                                                                                                                                         |

## Cleanup and operational ownership

Local helpers provide `close()`/`finally` cleanup and fail on failed Docker
cleanup. They do not provide a durable multi-job inventory, crash reconciler,
tenant retention policy or service operator. Some failed publications
intentionally retain partial artifacts/files instead of deleting concurrent
operator changes; see [artifact publication](../../../packages/cli-nexpress/src/site-build/render-artifacts.ts).

A hosted pilot therefore needs a named platform operations owner for admission,
aggregate capacity, cancellation, orphan reaping and deletion verification.
Every container, volume, temporary copy and retained artifact must be recorded
under one job/tenant with a finite expiry. Preserve referenced review evidence
until its declared retention expires, isolate failed-job evidence, revoke
preview access on expiry, and never clean another job by a broad path/name
match. Security ownership must cover tenant separation and secret/log exposure;
framework owners retain command, schema, migration and render semantics.
There is no such hosted operational contract established by these local helpers.

## Re-evaluation conditions

Reopen hosted adoption only after the final local R8 gate passes the required
local acceptance matrix with exact packed package/source/image/environment
evidence and explicit coverage limits. Any unresolved blocking item keeps
adoption deferred. Then require:

1. A measured need for remote ephemeral execution that ordinary repository
   export and local Docker cannot satisfy, without making generated sites
   depend on the service.
2. An owned pilot design implementing tenant/credential separation and finite
   storage, process, time, egress and concurrency budgets across **all** stages.
3. Executed cross-tenant, hostile-install/config, cancellation/crash, quota,
   orphan-cleanup, expiry and stale Git-ref tests, alongside normal community
   and editorial/docs end-to-end fixtures.
4. An operational runbook, retention/deletion evidence and separately scoped
   Git/deploy continuation review before any service is exposed.

Until those conditions hold, keep implementation and acceptance work local.
This decision adds no provider choice, infrastructure resource or deployment
task to R8. Documentation validation follows the existing
[documentation-only checks](../../testing.md#documentation-only-pr-checks).
