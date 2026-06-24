# Agent-operated ops contracts

**Status:** local CLI and read-only admin operating tracks are complete for
v0.x. This page started as the planning backlog for the agent-operated CLI
surface; it now documents the shipped `nexpress ops`, `nexpress runbook`,
`nexpress release`, and `/api/admin/ops/*` contracts plus the explicitly
deferred destructive / remote follow-up items.

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
low-token entry points for the common lifecycle. The v0.x local track is
intentionally closed around read-only plans, bounded approval-gated probes, and
release / runbook artifacts; broader destructive apply flows stay deferred
rather than turning the CLI into an unsafe autopilot.

---

## Design principles

### Command context

Project-side `pnpm run ...` examples run from a generated NexPress app. In this
monorepo, run the same command with `pnpm --dir apps/web ...` from the
repository root.

### 1. Stable machine contracts before clever automation

Every operator / agent report command should support stable JSON:

```bash
--json
```

Human-readable reports should also support:

```bash
--brief
--no-color
```

Commands that can mutate state add an explicit dry-run / execute split. The
shipped convention is `--execute --approve <token>` for bounded mutations;
destructive production apply flows remain deferred unless the confirmation,
audit, rollback, and multi-instance semantics are pinned down.

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
requires a persisted plan artifact plus a task-specific approval token, for
example `nexpress release apply --plan <artifact> --execute --approve <planId>`.

### 4. Idempotence is a feature

Agents retry. Commands should be safe to run twice when possible:

```bash
nexpress ops migrate status --json
nexpress ops backup verify latest --json
nexpress ops storage migrate plan --target s3 --json
```

### 5. Audit anything destructive

Future migration apply, restore apply, storage migration apply, and plugin
enable / disable commands should emit audit records that can be inspected from
the admin or logs. Shipped bounded mutations such as queue drain start, backup
manifest registration, and release apply already return mutation / execution
audit data in their JSON contracts.

### 6. Local CLI first, remote mutations later

Start with a local CLI that runs beside the project and uses environment
variables / direct database access. Remote operations endpoints are useful, but
mutating ones are security-sensitive and should wait until the local contracts
settle. The admin now exposes a read-only evidence subset for already-authenticated
operators; destructive remote actions remain deferred.

---

## Shipped command surface

These examples use the project-side `nexpress` command. Generated projects also
emit `projectCommand` fields such as `pnpm --silent run ops:plugins -- doctor
--json` in JSON reports and release artifacts.

### Project setup

```bash
pnpm create nexpress my-site
pnpm run setup
nexpress ops doctor --prod --json
nexpress ops doctor --prod --fix-plan --json
```

### Deploy

```bash
nexpress deploy plan --target docker --json
nexpress deploy plan --target vercel --json
nexpress deploy plan --target fly --json
nexpress ops preflight --target vercel --json
```

### Status and diagnostics

```bash
nexpress ops status --json
nexpress ops contracts --json
nexpress ops doctor --prod --json
nexpress ops doctor --prod --fix-plan --json
nexpress ops preflight --target vercel --json
nexpress ops health --url https://example.com --json
```

### Database migrations

```bash
nexpress ops migrate status --json
nexpress ops migrate plan --json
nexpress ops migrate rollback-plan --json
```

### Backup and restore

```bash
nexpress ops backup status --json
nexpress ops backup create --json
nexpress ops backup list --json
nexpress ops backup verify latest --json
nexpress ops backup restore-plan latest --json
```

### Jobs and workers

```bash
nexpress ops jobs status --json
nexpress ops jobs pause --reason "maintenance" --json
nexpress ops jobs resume --json
nexpress ops jobs retry-all --state failed --json
nexpress ops jobs retry-all --state failed --execute --approve retry-all --json
nexpress ops jobs drain --json
nexpress ops jobs drain --execute --approve drain --json
```

### Storage

```bash
nexpress ops storage status --json
nexpress ops storage verify --json
nexpress ops storage missing-files --json
nexpress ops storage orphaned-files --json
nexpress ops storage migrate plan --target s3 --json
nexpress ops storage test --json
nexpress ops storage test --execute --approve storage-test --json
```

### Plugins

```bash
nexpress ops plugins list --json
nexpress ops plugins inspect <pluginId> --json
nexpress ops plugins doctor --json
nexpress ops plugins upgrade-plan [pluginId] --json
```

### Admin read-only ops API

These endpoints use the same authenticated admin session as `/admin/ops` and
require `admin.manage`:

```text
GET /api/admin/ops/health
GET /api/admin/ops/readiness?target=vercel
GET /api/admin/ops/status
GET /api/admin/ops/doctor?prod=1&target=vercel&fixPlan=1
GET /api/admin/ops/jobs
GET /api/admin/ops/storage
GET /api/admin/ops/plugins
```

The `status` and `doctor` endpoints mirror the local `np.ops.v1` and
`np.doctor.v1` contracts. The `plugins` endpoint reports the runtime registry
that is already loaded in the process. The local `nexpress ops plugins ...` CLI
remains the static config and package-inspection surface.

### Release

```bash
nexpress release check --target vercel --json
nexpress release plan --target vercel --json
nexpress release apply --plan .nexpress/releases/<plan>.json --json
nexpress release apply --plan .nexpress/releases/<plan>.json --execute --approve <planId> --json
nexpress release verify --json
```

### Runbooks

```bash
nexpress runbook migration-crashed --json
nexpress runbook worker-not-draining --json
nexpress runbook storage-local-to-s3 --json --out .nexpress/runbooks/storage-local-to-s3.json
nexpress runbook backup-restore-drill --json --out .nexpress/runbooks/backup-restore-drill.json
```

## Deferred destructive / remote surfaces

These remain out of the v0.x local CLI closure:

```text
nexpress ops migrate apply --safe
nexpress ops storage migrate apply --target s3
nexpress ops backup restore apply <manifestId>
nexpress ops plugins enable <pluginId>
nexpress ops plugins disable <pluginId>
POST /api/admin/ops/*
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
        "command": "nexpress ops storage migrate plan --target s3 --json",
        "requiresApproval": false
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
| `plugins.route_conflict`             | warning  | Two plugins claim the same route / action.                             |
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

- `pnpm --silent run ops:status -- --json` emits the initial
  `schemaVersion: "np.ops.v1"` status contract from generated apps.
- `nexpress ops status --json` delegates to the project-side
  `ops:status` script so operators and agents can use the same entry.
- `nexpress ops doctor --prod --json --fix-plan` delegates to the
  project-side doctor while preserving its stable `np.doctor.v1` output.
- `nexpress ops preflight --target <host> --json` combines deploy-plan and
  production doctor evidence plus `ops migrate plan` evidence into
  `schemaVersion: "np.ops-preflight.v1"`. Brief reports print a per-step
  `next:` command for every blocked step, then the overall next command.
- `pnpm --silent run deploy:plan -- --target <host> --json` emits
  `schemaVersion: "np.deploy-plan.v1"` with a `bridge` section that orders the
  local setup -> host env -> migration -> preflight -> release check -> deploy
  -> post-deploy verify handoff. With required env ready, `nextCommands`
  includes migration status, migration apply, and `ops:preflight`; `deploy:plan`
  remains advisory and `ops:preflight` is the blocking readiness gate.
- `pnpm --silent run ops:contracts -- --json` emits
  `schemaVersion: "np.ops-contracts.v1"` as a local registry of the shipped
  ops / release / runbook contracts, including artifact behavior, approval
  requirements, and destructive surfaces that are deliberately deferred.
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
  plugin ID, block type, API route, and page route warnings. Non-ready reports
  include `plan.nextCommands` / `plan.projectNextCommands`; duplicate-contract
  warnings point first at `nexpress ops plugins inspect <pluginId> --json`
  for the conflicting plugins, then back to doctor for verification.
- `nexpress ops plugins inspect <pluginId> --json` emits the same
  `np.ops-plugins.v1` envelope narrowed to one configured plugin, including
  manifest metadata, declared capabilities, plugin-owned contracts, and related
  diagnostics.
- `nexpress ops plugins upgrade-plan [pluginId] --json` emits
  `schemaVersion: "np.ops-plugins-upgrade-plan.v1"` with package inference,
  inspect / outdated / upgrade / verify commands, and approval flags. It does
  not install packages or rewrite config.
- Admin plugin discovery (`/api/admin/plugins/discover`) returns the matching
  install bridge for registry plugins: `pnpm exec nexpress plugin add <package>`
  as the primary project-root command, a manual `pnpm add` + config snippet
  fallback, and `pnpm --silent run ops:plugins -- doctor --json` as the
  post-restart verification command.
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
  or mismatched project command metadata block even with approval. Approved
  execution uses structured argv specs rather than a shell. When an apply is
  blocked before execution, every plan command is marked `blocked` instead of
  `pending`.
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
  remediation. Brief output includes each action note so operator-provided
  backup artifacts are not mistaken for files NexPress creates automatically.
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
- `restore plan`; keep destructive restore apply / smoke-test execution as
  future approval-gated work.
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
  config diagnostics, and read-only upgrade plans that state when rebuild /
  restart is required.
- `release check` that composes typecheck, tests, build, migration status,
  env readiness, storage safety, worker readiness, and backup recency.
- Executable runbooks that diagnose incident states and return next commands.

---

## v0.x local ops closure

The local agent-operated operations track is complete when evaluated against
the original product promise: a generated project can expose deterministic
commands for setup handoff, deploy planning, preflight checks, migrations,
backups, jobs, storage, plugin diagnostics, release gates, and incident
runbooks without requiring an agent to re-read long-form prose first.

The contract registry is the source of truth for the closing boundary:

```bash
pnpm --silent run ops:contracts -- --json
```

Key shipped contracts:

| Area              | Command                                                                                                          | Schema / artifact                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Deploy bridge     | `pnpm --silent run deploy:plan -- --target <host> --json`                                                        | `np.deploy-plan.v1`                                                                                         |
| Local status      | `pnpm --silent run ops:status -- --json`                                                                         | `np.ops.v1`                                                                                                 |
| Production doctor | `pnpm --silent run doctor:prod -- --target <host> --fix-plan --json`                                             | `np.doctor.v1`                                                                                              |
| Contract registry | `pnpm --silent run ops:contracts -- --json`                                                                      | `np.ops-contracts.v1`                                                                                       |
| Preflight         | `pnpm --silent run ops:preflight -- --target <host> --json`                                                      | `np.ops-preflight.v1`                                                                                       |
| Health            | `pnpm --silent run ops:health -- --url <origin> --json`                                                          | `np.ops-health.v1`                                                                                          |
| Migrations        | `pnpm --silent run ops:migrate -- status / plan / rollback-plan --json`                                          | `np.ops-migrate.v1`, `np.ops-migrate-rollback-plan.v1`                                                      |
| Backups           | `pnpm --silent run ops:backup -- status / create / verify / restore-plan --json`                                 | `np.ops-backup.v1`, `np.ops-backup-restore-plan.v1`                                                         |
| Jobs              | `pnpm --silent run ops:jobs -- status / pause / resume / retry-all / drain --json`                               | `np.ops-jobs.v1`                                                                                            |
| Storage           | `pnpm --silent run ops:storage -- status / verify / missing-files / orphaned-files / migrate plan / test --json` | `np.ops-storage.v1`, `np.ops-storage-list.v1`, `np.ops-storage-migration-plan.v1`                           |
| Plugins           | `pnpm --silent run ops:plugins -- list / inspect / doctor / upgrade-plan --json`                                 | `np.ops-plugins.v1`, `np.ops-plugins-upgrade-plan.v1`                                                       |
| Release           | `pnpm --silent run ops:release -- check / plan / apply / verify --json`                                          | `np.release.v1`, `np.release-plan.v1`, `np.release-apply.v1`; release artifacts under `.nexpress/releases/` |
| Runbooks          | `pnpm --silent run ops:runbook -- <incident> --json --out <path>`                                                | `np.runbook.v1`; operator-provided artifact path                                                            |

Deferred on purpose:

- `ops migrate apply --safe`
- `ops storage migrate apply --target s3`
- `ops backup restore apply`
- `ops plugins enable|disable`
- remote mutating `/api/admin/ops/*` actions

Those surfaces are destructive or security-sensitive. They should only reopen
after a real operator need pins the confirmation, audit, rollback, and
multi-instance semantics tightly enough to implement safely.

---

## Security posture for remote ops API

The shipped remote API subset is read-only and admin-session gated:

```text
GET /api/admin/ops/health
GET /api/admin/ops/readiness?target=<host>
GET /api/admin/ops/status
GET /api/admin/ops/doctor?prod=1&target=<host>&fixPlan=1
GET /api/admin/ops/jobs
GET /api/admin/ops/storage
GET /api/admin/ops/plugins
```

Future action endpoints require stricter controls:

- Admin capability gate.
- CSRF for browser-originated calls or a separate short-lived service token for
  machine clients.
- Rate limiting and audit logging.
- Two-step confirmation for destructive actions.
- Optional IP allowlist / signed command payload in production.
- No secrets in responses; return presence, hashes, or redacted values only.

Candidate action endpoints, only after the CLI contract is proven:

```text
POST /api/admin/ops/cache/revalidate
POST /api/admin/ops/jobs/drain
POST /api/admin/ops/backup
POST /api/admin/ops/runbook/{id}
```

---

## Implementation ledger

The original issue-ready backlog has been retired. Keep this section as the
current-state map between the shipped code contracts and the few intentionally
deferred decisions that still need real operator pressure before implementation.

The machine-readable registry remains the canonical source:

```bash
# Generated app / apps/web:
pnpm --silent run ops:contracts -- --json

# Monorepo root:
pnpm --dir apps/web --silent run ops:contracts -- --json
```

| Track                | Status                                       | Shipped contract                                                                                                                              | Remaining decision                                                                                                  |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Status / doctor      | Shipped                                      | `nexpress ops status`, `nexpress ops doctor`, `pnpm run ops:status`, `pnpm run doctor:prod`, `/api/admin/ops/status`, `/api/admin/ops/doctor` | None in the read-only scope.                                                                                        |
| Deploy plan          | Shipped                                      | `nexpress deploy plan --target docker\|vercel\|fly`, `pnpm run deploy:plan` as `np.deploy-plan.v1`                                            | Provider API mutation remains out of scope; the contract is plan-only.                                              |
| Migration safety     | Partially shipped                            | `ops:migrate status`, `ops:migrate plan`, `ops:migrate rollback-plan`, release/preflight migration evidence                                   | `apply --safe` needs final backup freshness, advisory lock, audit, rollback, and post-apply readiness semantics.    |
| Backup / restore     | Partially shipped                            | `ops:backup status`, `create`, `list`, `verify`, `restore-plan`, manifests under `.nexpress/backups`                                          | `restore apply` and restore smoke-test stay deferred until the destructive confirmation and recovery contract gels. |
| Jobs                 | Shipped with bounded mutations               | `ops:jobs status`, `pause`, `resume`, `retry-all`, `drain`; `retry-all` / `drain` execute mode requires `--execute --approve <token>`         | Broader destructive queue rewrites remain future work.                                                              |
| Storage              | Partially shipped                            | `ops:storage status`, `verify`, `test`, `missing-files`, `orphaned-files`, `migrate plan`                                                     | `migrate apply --target s3` stays deferred until object-copy auditing, retry, and rollback semantics are settled.   |
| Plugins              | Partially shipped                            | `ops:plugins list`, `inspect`, `doctor`, `upgrade-plan`                                                                                       | `enable` / `disable` config mutation waits for rebuild, restart, audit, and rollback semantics.                     |
| Release              | Shipped with explicit approval gate          | `release check`, `plan`, `apply`, `verify`; `ops:release check\|verify`; artifacts under `.nexpress/releases`                                 | No new local read-only scope; execution stays approval-gated and allowlisted.                                       |
| Runbooks             | Shipped as read-only incident recipes        | `runbook worker-not-draining`, `storage-local-to-s3`, `backup-restore-drill`, `migration-crashed`; `ops:runbook <name>`                       | Automated incident mutations remain deferred.                                                                       |
| Remote admin ops API | Read-only shipped; mutation surface deferred | `GET /api/admin/ops/health`, `readiness`, `status`, `doctor`, `jobs`, `storage`, `plugins`                                                    | `POST /api/admin/ops/*` needs scoped auth, rate limits, audit logging, and two-step confirmation.                   |

## Future decision backlog

Only these deferred surfaces should be reopened from this track. Each one is
dangerous enough that the implementation should start from a concrete operator
need, not from the old planning issue text.

### Approval-gated migration apply

- Contract: `nexpress ops migrate apply --safe`
- Project command: `pnpm run ops:migrate -- apply --safe`
- Artifact: `.nexpress/migrations/<apply>.json`
- Decision needed: backup freshness window, advisory lock behavior,
  destructive-SQL approval format, post-apply readiness checks, and rollback
  evidence.

### Approval-gated local-to-S3 storage migration apply

- Contract: `nexpress ops storage migrate apply --target s3`
- Project command: `pnpm run ops:storage -- migrate apply --target s3`
- Artifact: `.nexpress/storage/<migration>.json`
- Decision needed: copy retry behavior, resumability, object verification,
  orphan handling, and rollback / cutover notes.

### Approval-gated restore apply and smoke test

- Contract: `nexpress ops backup restore apply <manifestId>`
- Project command: `pnpm run ops:backup -- restore apply <manifestId>`
- Artifact: `.nexpress/restores/<restore>.json`
- Decision needed: production restore confirmation, DB/media restore ordering,
  smoke-test scope, audit trail, and rollback path after a failed restore.

### Plugin enable / disable mutation

- Contract: `nexpress ops plugins enable|disable <pluginId>`
- Project command: `pnpm run ops:plugins -- enable|disable <pluginId>`
- Artifact: `.nexpress/plugins/<mutation>.json`
- Decision needed: package-manager behavior, config-file ownership, rebuild /
  restart requirements, route/block conflict gates, and rollback notes.

### Remote admin ops mutation API

- Contract: `POST /api/admin/ops/*`
- Artifact: admin audit log plus task-specific JSON artifact
- Decision needed: scoped service-token model, CSRF boundary for browser
  actions, rate limiting, IP / signature policy, audit retention, and
  destructive two-step confirmation.

Candidate routes remain examples, not committed scope:

```text
POST /api/admin/ops/cache/revalidate
POST /api/admin/ops/jobs/drain
POST /api/admin/ops/backup
POST /api/admin/ops/runbook/{id}
```
