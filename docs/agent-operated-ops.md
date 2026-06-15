# Agent-operated ops CLI plan

**Status:** implemented operating track with remaining backlog. This page
started as the planning backlog for the agent-operated CLI surface; it now
documents the shipped `nexpress ops`, `nexpress runbook`, and `nexpress release`
contracts plus the follow-up items that have not yet graduated into code.

NexPress already exposes agent-friendly content APIs through OpenAPI, auth,
plugin discovery, and stable error codes. The operating surface after a site is
live now has deterministic JSON contracts for status checks, deployment
planning, migration safety, backups, worker health, storage verification,
plugin inspection, release gates, and incident runbooks.

The goal is a low-token operating contract:

> An AI agent should be able to scaffold, configure, deploy, migrate, monitor,
> back up, and recover a NexPress site by calling deterministic CLI commands
> with stable JSON output, instead of re-reading long docs and reconstructing
> ad-hoc shell recipes.

---

## Product promise

The public positioning this unlocks:

- **Korean:** NexPress는 AI agent가 운영하기 쉬운 CMS입니다. 프로젝트 생성부터
  배포, 마이그레이션, 헬스체크, 백업, 복구까지 짧고 안정적인 CLI 명령으로
  처리합니다.
- **English:** NexPress is built for AI-operated publishing: scaffold,
  configure, deploy, migrate, monitor, back up, and recover a production CMS
  through deterministic low-token CLI contracts.

This is intentionally **not** an in-product AI engine. NexPress should expose
clear contracts that any agent, CI runner, or human operator can call.

---

## Current baseline

Today, operators can already piece together the lifecycle from existing
surfaces:

- `create-nexpress` scaffolds a project and installs template scripts.
- Template scripts include setup / doctor / worker / database commands.
- Deployment docs cover Docker, Vercel, Fly.io, health endpoints, multi-node
  caveats, storage, jobs, and rate limiting.
- Operations docs and backup / restore docs describe incident procedures and
  disaster-recovery order.
- Admin jobs and observability surfaces expose worker heartbeats, job logs,
  queue state, pause / resume, and archived jobs.
- The agent integration guide documents OpenAPI, auth, plugin discovery, and
  content read/write flows.

The original gap was that these were spread across scripts, docs, and app
endpoints. The shipped ops / runbook / release commands now provide the
low-token entry points for the common lifecycle; the remaining work is to keep
expanding typed plans and approval-gated mutations without turning the CLI into
an unsafe autopilot.

---

## Design principles

### 1. Stable machine contracts before clever automation

Every command that an agent may call must support:

```bash
--json
--brief
--no-color
--dry-run
```

JSON output should carry a schema version from day one:

```json
{
  "schemaVersion": "np.ops.v1",
  "ok": false,
  "summary": "2 blocking checks failed",
  "checks": []
}
```

### 2. Human output and agent output are different products

Human output can be explanatory. Agent output should be compact, structured,
and stable. A failing check needs an ID, severity, evidence, and suggested next
steps instead of only prose.

### 3. Plan before apply

Dangerous actions default to dry-run / plan mode. Applying production changes
requires explicit flags such as `--apply`, `--yes`, or a task-specific
confirmation like `--confirm-production`.

### 4. Idempotence is a feature

Agents retry. Commands should be safe to run twice when possible:

```bash
nexpress ops migrate apply --if-pending
nexpress ops backup create --if-needed
nexpress ops storage migrate --resume
```

### 5. Audit anything destructive

Migration, restore, storage migration, queue drain, plugin enable / disable,
and release commands should emit audit records that can be inspected from the
admin or logs. The audit record should include who / what ran it, the command,
input hash, resources touched, result, and rollback hints.

### 6. Local CLI first, remote ops API later

Start with a local CLI that runs beside the project and uses environment
variables / direct database access. Remote operations endpoints are useful, but
they are security-sensitive and should wait until the local contracts settle.

---

## Target command surface

### Project setup

```bash
create-nexpress my-site --yes --docker
nexpress setup
nexpress doctor --prod --json
```

### Deploy

```bash
nexpress deploy plan --target docker --json
nexpress deploy plan --target vercel --json
nexpress deploy plan --target fly --json
nexpress deploy apply --target fly
```

### Status and diagnostics

```bash
nexpress ops status --json
nexpress ops doctor --prod --json
nexpress ops doctor --prod --fix-plan --json
nexpress ops health
nexpress ops logs --since 10m --level error --json
nexpress ops config explain --json
nexpress ops env diff --target production --json
```

### Database migrations

```bash
nexpress ops migrate status --json
nexpress ops migrate plan --json
nexpress ops migrate apply --safe
nexpress ops migrate rollback-plan --json
```

### Backup and restore

```bash
nexpress ops backup create --json
nexpress ops backup list --json
nexpress ops backup verify latest --json
nexpress ops backup restore-plan latest --json
nexpress ops restore apply latest --confirm-production
nexpress ops restore smoke-test latest
```

### Jobs and workers

```bash
nexpress ops jobs status --json
nexpress ops jobs pause --reason "maintenance"
nexpress ops jobs resume
nexpress ops jobs queues --json
nexpress ops jobs retry <jobId>
nexpress ops jobs drain --timeout 120s
nexpress ops jobs heartbeat --json
```

### Storage

```bash
nexpress ops storage status --json
nexpress ops storage test --json
nexpress ops storage verify --json
nexpress ops storage migrate --from local --to s3 --dry-run --json
nexpress ops storage orphaned-files --json
nexpress ops storage missing-files --json
```

### Plugins

```bash
nexpress ops plugins list --json
nexpress ops plugins inspect <pluginId> --json
nexpress ops plugins doctor --json
nexpress ops plugins enable <pluginId>
nexpress ops plugins disable <pluginId>
nexpress ops plugins upgrade-plan --json
```

### Release

```bash
nexpress release check --json
nexpress release plan --json
nexpress release apply
nexpress release verify --json
```

### Runbooks

```bash
nexpress runbook migration-crashed --json
nexpress runbook storage-local-to-s3 --json
nexpress runbook backup-restore-drill --json
nexpress runbook worker-not-draining --json
```

---

## Shared JSON schema sketch

All command families should reuse the same envelope so agents can build one
parser:

```ts
interface NpOpsResult {
  schemaVersion: "np.ops.v1";
  command: string;
  ok: boolean;
  status: "ok" | "warning" | "error";
  summary: string;
  target?: string;
  generatedAt: string;
  checks?: NpOpsCheck[];
  actions?: NpOpsAction[];
  artifacts?: NpOpsArtifact[];
  audit?: NpOpsAuditRef;
}

interface NpOpsCheck {
  id: string;
  severity: "info" | "warning" | "error";
  status: "pass" | "fail" | "skip";
  summary: string;
  evidence?: string[];
  docs?: string[];
  fix?: NpOpsFix;
}

interface NpOpsAction {
  id: string;
  title: string;
  risk: "low" | "medium" | "high";
  automatic: boolean;
  command?: string;
  steps?: string[];
  requiresApproval?: boolean;
}
```

Example compact failure:

```json
{
  "schemaVersion": "np.ops.v1",
  "command": "nexpress ops doctor --prod",
  "ok": false,
  "status": "error",
  "summary": "1 blocking check failed, 1 warning",
  "generatedAt": "2026-05-07T00:00:00.000Z",
  "checks": [
    {
      "id": "storage.local.multinode",
      "severity": "error",
      "status": "fail",
      "summary": "Local storage is unsafe when more than one app instance can serve traffic.",
      "evidence": ["NP_STORAGE_ADAPTER=local", "NP_REPLICAS=2"],
      "fix": {
        "command": "nexpress ops storage migrate --from local --to s3 --dry-run --json",
        "requiresApproval": true
      }
    }
  ]
}
```

---

## Error and check IDs

Use stable IDs that can be documented and grepped. Suggested initial catalog:

| ID                                   | Severity | Meaning                                                                |
| ------------------------------------ | -------- | ---------------------------------------------------------------------- |
| `db.unreachable`                     | error    | `DATABASE_URL` cannot be reached.                                      |
| `db.pending_migrations`              | error    | Code has migrations that are not applied.                              |
| `db.destructive_migration`           | error    | Migration plan includes potentially destructive SQL.                   |
| `secret.missing`                     | error    | `NP_SECRET` is not set.                                                |
| `secret.weak`                        | error    | `NP_SECRET` is too short or known-placeholder value.                   |
| `site_url.invalid`                   | error    | `SITE_URL` is missing or not a valid URL.                              |
| `site_url.production_not_https`      | error    | Production `SITE_URL` is not HTTPS.                                    |
| `storage.unreachable`                | error    | Configured storage adapter cannot read/write/delete a probe object.    |
| `storage.local.multinode`            | error    | Local uploads are used in a multi-node or ephemeral filesystem target. |
| `storage.media_missing`              | warning  | Database media rows point to missing files / objects.                  |
| `storage.orphaned_files`             | warning  | Files / objects exist without media rows.                              |
| `jobs.worker_stale`                  | warning  | Worker heartbeat is older than the configured threshold.               |
| `jobs.queue_backlog`                 | warning  | Queue depth exceeds threshold.                                         |
| `jobs.failed_recent`                 | warning  | Recent failed jobs need inspection.                                    |
| `scheduler.token_missing`            | warning  | Internal scheduler endpoint token is unset.                            |
| `plugins.route_conflict`             | error    | Two plugins claim the same route / action.                             |
| `plugins.block_conflict`             | warning  | Later plugin registration overwrites an existing block type.           |
| `deploy.target_missing_env`          | error    | Target-specific required env var is missing.                           |
| `deploy.target_storage_incompatible` | error    | Target requires S3 or equivalent durable storage.                      |
| `backup.stale`                       | warning  | No verified backup exists within the configured window.                |
| `backup.restore_unverified`          | warning  | Latest backup has not passed restore verification.                     |

---

## Phased implementation plan

### Phase A — `ops status` and `ops doctor`

Ship the smallest useful contract first.

Implementation status:

- `pnpm run ops:status -- --json` emits the initial
  `schemaVersion: "np.ops.v1"` status contract from generated apps.
- `nexpress ops status --json` delegates to the project-side
  `ops:status` script so operators and agents can use the same entry.
- `nexpress ops doctor --prod --json --fix-plan` delegates to the
  project-side doctor while preserving its stable `np.doctor.v1` output.
- `nexpress ops preflight --target <host> --json` combines deploy-plan and
  production doctor evidence plus `ops migrate plan` evidence into
  `schemaVersion: "np.ops-preflight.v1"`.
- `pnpm run deploy:plan -- --target <host> --json` emits
  `schemaVersion: "np.deploy-plan.v1"` with a `bridge` section that orders the
  local setup -> host env -> migration -> preflight -> release check -> deploy
  -> post-deploy verify handoff.
- `nexpress ops health --url <origin> --json` probes `/api/health/ready`
  and emits `schemaVersion: "np.ops-health.v1"` for a running site.
- `nexpress ops jobs status --json` emits
  `schemaVersion: "np.ops-jobs.v1"` with worker heartbeat, pause state,
  and pg-boss queue counts.
- `nexpress ops storage status --json` emits
  `schemaVersion: "np.ops-storage.v1"` with adapter readiness, media row
  counts, and local missing/orphaned file drift when local storage is used.
- `nexpress ops plugins list --json` and
  `nexpress ops plugins doctor --json` emit
  `schemaVersion: "np.ops-plugins.v1"` with plugin inventory plus duplicate
  plugin ID, block type, API route, and page route warnings.
- `nexpress ops plugins inspect <pluginId> --json` emits the same
  `np.ops-plugins.v1` envelope narrowed to one configured plugin, including
  manifest metadata, declared capabilities, plugin-owned contracts, and related
  diagnostics.
- `nexpress ops plugins upgrade-plan [pluginId] --json` emits
  `schemaVersion: "np.ops-plugins-upgrade-plan.v1"` with package inference,
  inspect / outdated / upgrade / verify commands, and approval flags. It does
  not install packages or rewrite config.
- `nexpress release check --target <host> --json` emits
  `schemaVersion: "np.release.v1"` by composing preflight, migration plan,
  required backup readiness, jobs, storage, and plugin diagnostics into a
  single pre-release gate.
- `nexpress release plan --target <host> --json` emits
  `schemaVersion: "np.release-plan.v1"` and writes the same plan/audit artifact
  under `.nexpress/releases/` by default. Blocked and attention steps preserve
  nested `plan.nextCommands` from migration rollback, backup restore, storage
  migration, and plugin upgrade evidence as ordered remediation commands.
- `nexpress release apply --plan <artifact> --json` emits
  `schemaVersion: "np.release-apply.v1"` and writes an apply audit artifact.
  It dry-runs by default; execution requires `--execute --approve <planId>`.
  Dry-run and blocked artifacts include `execution.nextCommand` and
  `execution.projectNextCommand` so the next safe command is explicit. Before
  dry-run or execution, the plan commands must pass the release-apply
  allowlist; tampered commands, unsupported targets, malformed command entries,
  or mismatched project command metadata block even with approval. When an apply
  is blocked before execution, every plan command is marked `blocked` instead
  of `pending`.
- `nexpress release verify --url <origin> --json` emits the same
  `np.release.v1` envelope by composing health, jobs, storage, and plugin
  diagnostics into a post-release readiness gate.
- `nexpress runbook <name> --json` emits `schemaVersion: "np.runbook.v1"`
  for common read-only incident recipes with evidence, diagnosis, next
  commands, risk, rollback notes, and docs links. Captured evidence keeps the
  source report `schemaVersion` and nested `plan.nextCommands` when present.
  Use `--out <path>` to write a clean JSON artifact without pnpm lifecycle
  banner/footer text around stdout.
- In this monorepo, use `pnpm run ops:release -- ...` and
  `pnpm run ops:runbook -- ...` for the project-side ops commands. The root
  `pnpm run release` script is reserved for npm publishing.
- Release plans include both global `command` strings and generated-app
  `projectCommand` strings. Runbooks include `nextCommands` and
  `projectNextCommands` for the same reason.
- Ops reports and executable plans expose `projectNextCommand` beside
  `nextCommand`; restore, rollback, storage migration, and plugin upgrade plan
  steps also include `projectCommand` beside `command`.
- `nexpress ops migrate status|plan --json` emits
  `schemaVersion: "np.ops-migrate.v1"` with local/applied migration state,
  pending migrations, drift, unknown applied rows, destructive SQL findings,
  and backup/apply/verify handoff actions.
- `nexpress ops migrate rollback-plan --json` emits
  `schemaVersion: "np.ops-migrate-rollback-plan.v1"` with a read-only
  backup-restore rollback plan, ordered inspect / prepare / rollback / verify
  steps, and approval flags.
- `nexpress ops backup create|status|list|verify latest --json` emits
  `schemaVersion: "np.ops-backup.v1"` with backup manifest freshness,
  manifest creation, verification state, latest artifact checks,
  record/verify/restore handoff actions, and `plan.nextCommands` for release
  remediation.
- `nexpress ops backup restore-plan [latest|manifestId] --json` emits
  `schemaVersion: "np.ops-backup-restore-plan.v1"` with a read-only isolated
  restore drill plan, ordered restore / verify steps, approval flags, and
  `plan.nextCommands` / `projectNextCommands`.
- `nexpress ops jobs pause|resume --json` persists the same global
  `jobs.paused` state used by workers and returns `np.ops-jobs.v1` with a
  mutation audit block.
- v1 checks cover Node, `.env`, required env, database reachability,
  migration status, storage adapter sanity, jobs enablement, worker heartbeat
  when jobs are enabled, and `SITE_URL`.
- Deeper ordered remediation remains in `pnpm run doctor -- --fix-plan`,
  which is surfaced as `nextCommand` whenever status is blocked or needs
  attention.

Scope:

- Create the `nexpress` runtime CLI entrypoint or extend the current CLI
  package with subcommands that can run inside a generated app.
- Extract template `doctor` checks into reusable functions.
- Add `--json`, `--brief`, `--prod`, `--fix-plan`, and `--no-color`.
- Check app version, Node / pnpm versions, env presence, database reachability,
  migration state, storage adapter sanity, worker heartbeat freshness, `SITE_URL`,
  scheduler token, readiness endpoint, and backup recency when configured.
- Document the JSON schema and check IDs.

Exit-code rule:

- `0` when all checks pass.
- `1` when one or more error-severity checks fail.
- `2` for CLI usage / unexpected internal failures.

### Phase B — `deploy plan`

Turn deployment docs into machine-readable recipes.

Scope:

- Implement target recipes for `docker`, `vercel`, and `fly`.
- Output required env vars, blocking checks, generated files, and ordered
  commands.
- Refuse targets with incompatible storage defaults, such as local uploads on
  ephemeral platforms.
- Keep `deploy apply` out of scope until `plan` is stable.

### Phase C — safe migrations

Wrap `db:migrate` in a plan / backup / apply / verify flow.

Scope:

- Detect current migration version and pending files.
- Flag destructive SQL patterns for manual review.
- Acquire a migration lock before apply.
- Require or recommend a fresh backup before production apply.
- Run readiness verification after migration.
- Emit rollback-plan hints without promising automatic rollback for arbitrary
  schema changes.

### Phase D — backup and restore

Make disaster recovery runnable instead of only documented.

Current status: backup reports now bridge release and migration gates to the
operator-owned backup process. They expose record / verify / restore actions,
project-local commands, artifact verification, and restore drill plans without
performing destructive restores automatically.

Scope:

- `backup create`, `backup list`, `backup verify`.
- `restore plan`, `restore apply`, `restore smoke-test`.
- `pg_dump --format=custom` for DB.
- Local uploads archive or S3 manifest / sync plan for media.
- Manifest tying DB dump, media snapshot, migration version, app version, and
  verification status together.

### Phase E — jobs, storage, plugins, release, runbooks

Broaden operational coverage after the core loops are stable.

Scope:

- Job queue status, pause / resume, retry, drain, heartbeat checks.
- Storage verification, orphan / missing file scans, local-to-S3 migration.
- Plugin inventory, manifest inspection, route / block conflict checks,
  enable / disable plans that state when rebuild / restart is required.
- `release check` that composes typecheck, tests, build, migration status,
  env readiness, storage safety, worker readiness, and backup recency.
- Executable runbooks that diagnose incident states and return next commands.

---

## Security posture for a future remote ops API

A remote API is useful for hosted agents, but it must not be the first version.
When added, it should be scoped to read-only status first and require stricter
controls for actions:

- Admin capability gate.
- CSRF for browser-originated calls or a separate short-lived service token for
  machine clients.
- Rate limiting and audit logging.
- Two-step confirmation for destructive actions.
- Optional IP allowlist / signed command payload in production.
- No secrets in responses; return presence, hashes, or redacted values only.

Candidate read endpoints:

```text
GET /api/admin/ops/status
GET /api/admin/ops/doctor
GET /api/admin/ops/jobs
GET /api/admin/ops/storage
```

Candidate action endpoints, only after the CLI contract is proven:

```text
POST /api/admin/ops/cache/revalidate
POST /api/admin/ops/jobs/drain
POST /api/admin/ops/backup
POST /api/admin/ops/runbook/{id}
```

---

## Issue-ready backlog

The following issue bodies are intentionally copy-pasteable into GitHub. Keep
one user-visible outcome per issue and land them in order unless a later issue
is needed to unblock testing.

### Issue 1 — Add `nexpress ops status` / `doctor` JSON contract

**Title:** Add agent-friendly `nexpress ops status` and `doctor` commands

**Goal:** Give agents and operators one low-token command to understand whether
a NexPress deployment is healthy enough to read, write, and serve traffic.

**Scope:**

- Add a runtime CLI entrypoint for `nexpress ops status` and
  `nexpress ops doctor`.
- Support `--json`, `--brief`, `--prod`, `--fix-plan`, and `--no-color`.
- Emit `schemaVersion: "np.ops.v1"`.
- Implement initial checks for Node, pnpm, required env vars, DB reachability,
  pending migrations, storage adapter probe, `SITE_URL`, scheduler token, job
  heartbeat, and readiness endpoint.
- Define stable check IDs and exit-code behavior.
- Add unit tests for pass / fail output and JSON schema shape.
- Update docs with command examples.

**Acceptance criteria:**

- `nexpress ops doctor --prod --json` returns valid JSON with deterministic
  check IDs.
- A missing `DATABASE_URL` produces an error-severity check and exit code `1`.
- `--brief` emits one compact line per check.
- `--fix-plan --json` includes suggested next commands for fixable checks.

### Issue 2 — Add `nexpress deploy plan` recipes

**Title:** Add machine-readable deployment plans for Docker, Vercel, and Fly.io

**Goal:** Convert deployment documentation into target-specific plans that an
agent can inspect before applying changes.

**Scope:**

- Add `nexpress deploy plan --target docker|vercel|fly`.
- Output required environment variables, generated file expectations,
  pre-deploy checks, ordered commands, and blocking incompatibilities.
- Detect storage / target incompatibilities such as local uploads on ephemeral
  filesystems.
- Support `--json`, `--brief`, and `--no-color`.
- Keep provider API mutation out of scope; this issue is plan-only.

**Acceptance criteria:**

- `--target vercel --json` reports S3 as required durable media storage.
- `--target docker --json` includes build, migrate, health, and worker notes.
- Plans include docs links and stable blocking check IDs.

### Issue 3 — Add safe migration workflow

**Title:** Add `nexpress ops migrate plan/apply --safe`

**Goal:** Make production database migrations agent-operable without allowing
blind destructive changes.

**Scope:**

- Add `migrate status`, `migrate plan`, and `migrate rollback-plan`; keep
  `migrate apply --safe` as future approval-gated work.
- Detect pending migrations and current database migration version.
- Flag destructive SQL patterns for manual approval.
- For future apply, acquire an advisory migration lock before touching the DB.
- Require a fresh backup or an explicit override for any future production apply.
- Verify readiness after apply.

**Acceptance criteria:**

- No-op when there are no pending migrations and `--if-pending` is used.
- Destructive SQL causes a blocking check in `plan`.
- `apply --safe` refuses production without a verified backup or explicit
  documented override.

### Issue 4 — Add backup / restore CLI

**Title:** Add `nexpress ops backup` and `restore` commands with manifests

**Goal:** Make the documented DB + media disaster-recovery workflow executable
and verifiable.

**Scope:**

- Add `backup create`, `backup list`, `backup verify latest`.
- Add `backup restore-plan latest`; keep destructive `restore apply latest`
  and `restore smoke-test` as future approval-gated work.
- Generate a manifest containing backup ID, DB dump path, media snapshot,
  migration version, app version, created-at timestamp, and verification state.
- Support local uploads archives and S3 snapshot / sync manifests.
- Require `--confirm-production` for future destructive production restore.

**Acceptance criteria:**

- Backups tie DB and media artifacts to one manifest.
- `verify latest --json` reports whether DB dump and media artifacts are
  present and restorable enough for a smoke test.
- Restore plan prints exact ordered steps before any future apply command.

### Issue 5 — Add jobs / storage / plugin ops checks

**Title:** Add operational subcommands for jobs, storage, and plugins

**Goal:** Cover the high-frequency post-deploy incidents agents need to triage:
stale workers, media drift, and plugin conflicts.

**Scope:**

- Add `ops jobs status|queues|pause|resume|retry|drain|heartbeat`.
- Add `ops storage status|test|verify|orphaned-files|missing-files|migrate`.
- Add `ops plugins list|inspect|doctor|enable|disable|upgrade-plan`.
- Use shared `np.ops.v1` result envelope and check IDs.
- Document which plugin actions require rebuild / restart in v1.

Implementation status:

- `nexpress ops jobs status --json` now reports worker heartbeat, pause
  state, and queue counts as `np.ops-jobs.v1`.
- `nexpress ops jobs pause|resume --json` now writes the global pause state in
  `np_settings("_system", "jobs.paused")` and returns the updated status with a
  mutation audit block.
- `nexpress ops jobs retry-all --json` now dry-runs retryable archived jobs by
  default, and `--execute --approve retry-all` re-enqueues failed / cancelled /
  expired jobs with a mutation audit block.
- `nexpress ops jobs drain --json` now reports drain readiness by default, and
  `--execute --approve drain` starts a safe drain by pausing new job claims and
  returning the remaining active / created / retry counts.
- `nexpress ops backup create --json` now records an operator-provided backup
  manifest in `NP_BACKUP_DIR` / `.nexpress/backups`; it does not perform a DB
  dump.
- `nexpress ops storage status --json` now reports local/S3 adapter
  readiness, media index counts, and local missing/orphaned media drift as
  `np.ops-storage.v1`.
- `nexpress ops storage verify --json` now re-runs the same integrity gate
  explicitly, and `nexpress ops storage test --execute --approve storage-test`
  runs an upload / exists / delete probe through the configured adapter.
- `nexpress ops storage missing-files|orphaned-files --json` now returns
  concrete local drift lists, and
  `nexpress ops storage migrate plan --target s3 --json` returns a read-only
  local-to-S3 migration plan with inspect, prepare, and approval-gated future
  apply commands.
- `nexpress ops plugins list|inspect|doctor --json` now reports configured
  plugin inventory, single-plugin manifest details, and static conflicts as
  `np.ops-plugins.v1`; `nexpress ops plugins upgrade-plan --json` now emits a
  read-only `np.ops-plugins-upgrade-plan.v1` plan for package review, rebuild,
  and post-upgrade verification.
- `nexpress ops status`, release plans, and executable runbooks now promote
  actionable `nextCommand` guidance from the underlying jobs / storage evidence,
  including dry-run retry, drain, storage verify, and storage probe commands.
- Queue destructive commands beyond bounded retry and drain start remain future
  work and should keep requiring explicit operator approval.
- Storage migration apply commands and plugin mutation commands (`enable`,
  `disable`) remain future work and should keep requiring explicit operator
  approval.

**Acceptance criteria:**

- Stale worker heartbeat is reported with a stable warning check ID.
- Storage verify can detect a missing media object and an orphaned object.
- Plugin doctor can identify route conflicts and block type overwrites.

### Issue 6 — Add `release check/plan/verify`

**Title:** Add release orchestration commands for agent-safe deploys

**Goal:** Give agents one preflight / postflight contract around tests, builds,
migrations, backups, and readiness.

**Scope:**

- Add `nexpress release check`, `release plan`, `release apply`, and
  `release verify`.
- Compose existing test, typecheck, build, migration, backup, env, storage,
  worker, and readiness checks.
- `release apply` should only run commands included in the previous plan or a
  freshly generated equivalent plan.
- Persist an audit artifact for each release attempt.

Implementation status:

- `nexpress release check --target <host> --json` now composes
  `ops:preflight`, `ops:migrate plan`, `ops:backup status --required`,
  `ops:jobs`, `ops:storage`, and `ops:plugins doctor` as `np.release.v1`.
- `nexpress release plan --target <host> --json` now persists a
  `np.release-plan.v1` artifact with the release check snapshot, ordered
  remediation / release / verify commands, approval flags, and apply
  preconditions.
- `nexpress release apply --plan <artifact> --json` now validates that artifact
  and persists `np.release-apply.v1`; it only runs plan commands when both
  `--execute` and `--approve <planId>` are present and every command passes the
  release-apply allowlist.
- `nexpress release verify --url <origin> --json` now composes
  `ops:health`, `ops:jobs`, `ops:storage`, and `ops:plugins doctor` as
  `np.release.v1`.
- `nexpress ops release check|verify` delegates to the same project-side
  script for agents that stay inside the ops namespace.
- `release apply` remains intentionally approval-gated because it can run
  deploy, migration, or publishing actions.

**Acceptance criteria:**

- `release check --json` returns a compact pass / fail summary with links to
  failing command output artifacts.
- Pending migrations and stale / missing / unverified backups block production
  release checks through dedicated migration and backup evidence steps.
- `release plan --json` persists a replayable plan artifact, and
  `release apply --plan <artifact> --json` records a dry-run or execution audit
  artifact.
- `release apply` dry-run artifacts include the exact approval-gated execution
  command in both global and project-local forms.
- `release apply` blocks tampered artifacts before execution when commands,
  targets, command metadata, or project command translations do not match the
  generated release plan contract.
- Ops/runbook/release artifacts preserve project-local next commands so a
  generated app can execute the same remediation sequence without translating
  `nexpress ...` global CLI calls by hand.
- A blocked `release plan` only lists remediation and verify commands; release
  phase commands are regenerated once the check is ready.
- `release verify --json` can run after deployment and report readiness.

### Issue 7 — Add executable runbook commands

**Title:** Add `nexpress runbook` diagnostics for common incidents

**Goal:** Turn operations docs into command-driven incident recipes that return
diagnosis, evidence, next commands, risk, and rollback notes.

**Scope:**

- Add runbooks for `migration-crashed`, `storage-local-to-s3`,
  `backup-restore-drill`, and `worker-not-draining`.
- Each runbook should collect evidence using existing ops checks and return a
  short diagnosis.
- Support `--json`, `--brief`, and docs links.
- Do not auto-apply destructive steps in the first version.

**Acceptance criteria:**

- `nexpress runbook worker-not-draining --json` reports heartbeat age, queue
  backlog, likely cause, and next commands.
- Runbooks share the same `np.runbook.v1` envelope.

Implementation status:

- `nexpress runbook worker-not-draining --json` now composes jobs evidence into
  `np.runbook.v1`.
- `nexpress runbook storage-local-to-s3 --json` now composes storage and Vercel
  preflight evidence into `np.runbook.v1`.
- `nexpress runbook backup-restore-drill --json` now composes
  `ops:backup verify latest` and release check evidence into `np.runbook.v1`.
- `nexpress runbook migration-crashed --json` now composes
  `ops:migrate status`, `ops:migrate plan`, and `ops:migrate rollback-plan`
  evidence into `np.runbook.v1`.
- `nexpress ops runbook <name> --json` delegates to the same project-side
  script for agents staying inside the ops namespace.
- Runbooks are intentionally read-only in this pass. Automated pause/resume,
  retry, restore, migration apply, or local-to-S3 mutation remains future
  approval-gated work.
