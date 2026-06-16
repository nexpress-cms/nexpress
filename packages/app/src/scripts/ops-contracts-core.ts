export type OpsContractStatus = "shipped" | "deferred";
export type OpsContractRisk = "read-only" | "bounded-mutation" | "destructive";

export interface OpsContract {
  id: string;
  family: "deploy" | "ops" | "release" | "runbook" | "doctor" | "worker" | "remote";
  title: string;
  status: OpsContractStatus;
  risk: OpsContractRisk;
  command: string;
  projectCommand: string | null;
  schemaVersions: string[];
  supports: {
    json: boolean;
    brief: boolean;
    noColor: boolean;
    out: boolean;
  };
  artifact: {
    writes: boolean;
    defaultPath: string | null;
  };
  approval: {
    required: boolean;
    token: string | null;
  };
  notes: string[];
}

export interface OpsContractsJson {
  schemaVersion: "np.ops-contracts.v1";
  ok: true;
  status: "ready";
  summary: {
    contracts: number;
    shipped: number;
    deferred: number;
    boundedMutations: number;
    destructiveDeferred: number;
  };
  contracts: OpsContract[];
}

interface RenderOptions {
  color: boolean;
}

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const EMPTY_ANSI = {
  green: "",
  yellow: "",
  dim: "",
  reset: "",
};

const OPS_CONTRACTS: OpsContract[] = [
  {
    id: "deploy.plan",
    family: "deploy",
    title: "Deployment plan",
    status: "shipped",
    risk: "read-only",
    command: "nexpress deploy plan --target <host> --json",
    projectCommand: "pnpm --silent run deploy:plan -- --target <host> --json",
    schemaVersions: ["np.deploy-plan.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: false, token: null },
    notes: ["Plan-only bridge from local setup to host deploy and post-deploy verify."],
  },
  {
    id: "ops.status",
    family: "ops",
    title: "Local runtime status",
    status: "shipped",
    risk: "read-only",
    command: "nexpress ops status --json",
    projectCommand: "pnpm --silent run ops:status -- --json",
    schemaVersions: ["np.ops.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: false, token: null },
    notes: ["Compact handoff for local env, DB, storage, jobs, and next-command guidance."],
  },
  {
    id: "ops.contracts",
    family: "ops",
    title: "Local ops contract registry",
    status: "shipped",
    risk: "read-only",
    command: "nexpress ops contracts --json",
    projectCommand: "pnpm --silent run ops:contracts -- --json",
    schemaVersions: ["np.ops-contracts.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: false, token: null },
    notes: [
      "Indexes shipped local ops, release, runbook, artifact, approval, and deferred contracts.",
    ],
  },
  {
    id: "ops.preflight",
    family: "ops",
    title: "Pre-deploy gate",
    status: "shipped",
    risk: "read-only",
    command: "nexpress ops preflight --target <host> --json",
    projectCommand: "pnpm --silent run ops:preflight -- --target <host> --json",
    schemaVersions: ["np.ops-preflight.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: false, token: null },
    notes: ["Composes deploy plan, production doctor, and migration plan evidence."],
  },
  {
    id: "ops.health",
    family: "ops",
    title: "Readiness endpoint probe",
    status: "shipped",
    risk: "read-only",
    command: "nexpress ops health --url <origin> --json",
    projectCommand: "pnpm --silent run ops:health -- --url <origin> --json",
    schemaVersions: ["np.ops-health.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: false, token: null },
    notes: ["Post-deploy probe for /api/health/ready."],
  },
  {
    id: "ops.migrate",
    family: "ops",
    title: "Migration status, plan, and rollback plan",
    status: "shipped",
    risk: "read-only",
    command: "nexpress ops migrate status|plan|rollback-plan --json",
    projectCommand: "pnpm --silent run ops:migrate -- status|plan|rollback-plan --json",
    schemaVersions: ["np.ops-migrate.v1", "np.ops-migrate-rollback-plan.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: false, token: null },
    notes: ["Detects pending, unknown, drift, destructive SQL, backup handoff, and rollback plan."],
  },
  {
    id: "ops.backup",
    family: "ops",
    title: "Backup manifest and restore drill plans",
    status: "shipped",
    risk: "bounded-mutation",
    command: "nexpress ops backup status|create|list|verify|restore-plan --json",
    projectCommand: "pnpm --silent run ops:backup -- status|create|list|verify|restore-plan --json",
    schemaVersions: ["np.ops-backup.v1", "np.ops-backup-restore-plan.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: true, defaultPath: ".nexpress/backups/<manifest>.json" },
    approval: { required: false, token: null },
    notes: ["create records operator-provided artifact paths; restore-plan remains read-only."],
  },
  {
    id: "ops.jobs",
    family: "ops",
    title: "Job queue status and bounded incident actions",
    status: "shipped",
    risk: "bounded-mutation",
    command: "nexpress ops jobs status|pause|resume|retry-all|drain --json",
    projectCommand: "pnpm --silent run ops:jobs -- status|pause|resume|retry-all|drain --json",
    schemaVersions: ["np.ops-jobs.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: true, token: "retry-all|drain for execute mode" },
    notes: ["pause/resume are explicit mutations; retry-all and drain execute only with approval."],
  },
  {
    id: "ops.storage",
    family: "ops",
    title: "Storage status, drift, migration plan, and probe",
    status: "shipped",
    risk: "bounded-mutation",
    command:
      "nexpress ops storage status|verify|missing-files|orphaned-files|migrate plan|test --json",
    projectCommand:
      "pnpm --silent run ops:storage -- status|verify|missing-files|orphaned-files|migrate plan|test --json",
    schemaVersions: [
      "np.ops-storage.v1",
      "np.ops-storage-list.v1",
      "np.ops-storage-migration-plan.v1",
    ],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: true, token: "storage-test for execute mode" },
    notes: ["Local-to-S3 migration is plan-only; storage test execute is approval-gated."],
  },
  {
    id: "ops.plugins",
    family: "ops",
    title: "Plugin inventory, diagnostics, and upgrade plan",
    status: "shipped",
    risk: "read-only",
    command: "nexpress ops plugins list|inspect|doctor|upgrade-plan --json",
    projectCommand: "pnpm --silent run ops:plugins -- list|inspect|doctor|upgrade-plan --json",
    schemaVersions: ["np.ops-plugins.v1", "np.ops-plugins-upgrade-plan.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: false, token: null },
    notes: ["Reports manifest metadata, route/block conflicts, and rebuild/restart upgrade steps."],
  },
  {
    id: "release",
    family: "release",
    title: "Release check, plan, apply, and verify",
    status: "shipped",
    risk: "bounded-mutation",
    command: "nexpress release check|plan|apply|verify --json",
    projectCommand: "pnpm --silent run ops:release -- check|plan|apply|verify --json",
    schemaVersions: ["np.release.v1", "np.release-plan.v1", "np.release-apply.v1"],
    supports: { json: true, brief: true, noColor: true, out: true },
    artifact: { writes: true, defaultPath: ".nexpress/releases/<plan-or-apply>.json" },
    approval: { required: true, token: "<planId> for apply execute mode" },
    notes: ["apply executes only allowlisted structured argv specs after explicit approval."],
  },
  {
    id: "runbook",
    family: "runbook",
    title: "Incident runbooks",
    status: "shipped",
    risk: "read-only",
    command: "nexpress runbook <incident> --json",
    projectCommand: "pnpm --silent run ops:runbook -- <incident> --json",
    schemaVersions: ["np.runbook.v1"],
    supports: { json: true, brief: true, noColor: true, out: true },
    artifact: { writes: true, defaultPath: "operator-provided via --out" },
    approval: { required: false, token: null },
    notes: [
      "Covers worker-not-draining, storage-local-to-s3, backup-restore-drill, and migration-crashed.",
    ],
  },
  {
    id: "doctor.prod",
    family: "doctor",
    title: "Production doctor and fix plan",
    status: "shipped",
    risk: "read-only",
    command: "nexpress ops doctor --prod --fix-plan --json",
    projectCommand: "pnpm --silent run doctor:prod -- --fix-plan --json",
    schemaVersions: ["np.doctor.v1"],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: false, token: null },
    notes: ["The generated app exposes this through doctor:prod rather than a separate wrapper."],
  },
  {
    id: "worker",
    family: "worker",
    title: "Long-running job worker",
    status: "shipped",
    risk: "bounded-mutation",
    command: "NP_ENABLE_JOBS=1 pnpm run worker",
    projectCommand: "NP_ENABLE_JOBS=1 pnpm run worker",
    schemaVersions: [],
    supports: { json: false, brief: false, noColor: false, out: false },
    artifact: { writes: false, defaultPath: null },
    approval: { required: false, token: null },
    notes: ["Worker lifecycle is process-based; status is reported by ops.jobs."],
  },
  {
    id: "ops.migrate.apply-safe",
    family: "ops",
    title: "Approval-gated migration apply",
    status: "deferred",
    risk: "destructive",
    command: "nexpress ops migrate apply --safe",
    projectCommand: "pnpm run ops:migrate -- apply --safe",
    schemaVersions: [],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: true, defaultPath: ".nexpress/migrations/<apply>.json" },
    approval: { required: true, token: "future migration apply token" },
    notes: [
      "Deferred until backup freshness, advisory lock, and post-apply verify semantics are final.",
    ],
  },
  {
    id: "ops.storage.migrate-apply",
    family: "ops",
    title: "Approval-gated local-to-S3 migration apply",
    status: "deferred",
    risk: "destructive",
    command: "nexpress ops storage migrate apply --target s3",
    projectCommand: "pnpm run ops:storage -- migrate apply --target s3",
    schemaVersions: [],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: true, defaultPath: ".nexpress/storage/<migration>.json" },
    approval: { required: true, token: "storage-migrate" },
    notes: ["Read-only migrate plan is shipped; object-copy mutation remains deferred."],
  },
  {
    id: "ops.backup.restore-apply",
    family: "ops",
    title: "Approval-gated restore apply and smoke test",
    status: "deferred",
    risk: "destructive",
    command: "nexpress ops backup restore apply <manifestId>",
    projectCommand: "pnpm run ops:backup -- restore apply <manifestId>",
    schemaVersions: [],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: true, defaultPath: ".nexpress/restores/<restore>.json" },
    approval: { required: true, token: "future restore token" },
    notes: ["Restore-plan is shipped; production restore mutation stays out of v0.x local ops."],
  },
  {
    id: "ops.plugins.mutate",
    family: "ops",
    title: "Plugin enable/disable mutation",
    status: "deferred",
    risk: "destructive",
    command: "nexpress ops plugins enable|disable <pluginId>",
    projectCommand: "pnpm run ops:plugins -- enable|disable <pluginId>",
    schemaVersions: [],
    supports: { json: true, brief: true, noColor: true, out: false },
    artifact: { writes: true, defaultPath: ".nexpress/plugins/<mutation>.json" },
    approval: { required: true, token: "future plugin mutation token" },
    notes: ["Inventory, inspect, doctor, and upgrade-plan are shipped; config mutation waits."],
  },
  {
    id: "remote.ops-api",
    family: "remote",
    title: "Remote admin ops API",
    status: "deferred",
    risk: "destructive",
    command: "POST /api/admin/ops/*",
    projectCommand: null,
    schemaVersions: [],
    supports: { json: true, brief: false, noColor: false, out: false },
    artifact: { writes: true, defaultPath: "admin audit log" },
    approval: { required: true, token: "future scoped service token" },
    notes: [
      "Deferred until local CLI contracts prove stable; must add auth, rate limits, and audit.",
    ],
  },
];

export function buildOpsContractsJson(): OpsContractsJson {
  const contracts = [...OPS_CONTRACTS].sort((a, b) => a.id.localeCompare(b.id));
  const shipped = contracts.filter((contract) => contract.status === "shipped").length;
  const deferred = contracts.length - shipped;
  return {
    schemaVersion: "np.ops-contracts.v1",
    ok: true,
    status: "ready",
    summary: {
      contracts: contracts.length,
      shipped,
      deferred,
      boundedMutations: contracts.filter((contract) => contract.risk === "bounded-mutation").length,
      destructiveDeferred: contracts.filter(
        (contract) => contract.status === "deferred" && contract.risk === "destructive",
      ).length,
    },
    contracts,
  };
}

function formatStatus(status: OpsContractStatus, color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  if (status === "shipped") return `${c.green}shipped${c.reset}`;
  return `${c.yellow}deferred${c.reset}`;
}

export function renderBriefOpsContracts(
  report: OpsContractsJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const lines = [
    `${c.dim}NexPress ops contracts${c.reset}`,
    `ready: ${report.summary.shipped.toString()} shipped, ${report.summary.deferred.toString()} deferred`,
  ];

  for (const contract of report.contracts) {
    lines.push(
      `  - [${formatStatus(contract.status, options.color)}] ${contract.id} ${contract.risk}`,
    );
  }

  return lines.join("\n");
}
