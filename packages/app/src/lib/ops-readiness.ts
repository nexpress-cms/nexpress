import type * as DeployPlanCore from "../scripts/deploy-plan-core";
import type { DeployPlanJson, EnvRequirementCheck } from "../scripts/deploy-plan-core";
import {
  deployTargetTitle,
  inferDeployTargetFromEnv,
  isDeployTarget,
  type DeployTarget,
} from "../scripts/deploy-targets";
import type { OpsBackupJson } from "../scripts/ops-backup-core";
import type * as OpsBackupCore from "../scripts/ops-backup-core";
import type * as OpsJobsCore from "../scripts/ops-jobs-core";
import type { OpsJobsJson } from "../scripts/ops-jobs-core";
import type * as OpsMigrateCore from "../scripts/ops-migrate-core";
import type { OpsMigrateJson } from "../scripts/ops-migrate-core";
import type { OpsPluginsJson } from "../scripts/ops-plugins-core";
import type * as OpsStorageCore from "../scripts/ops-storage-core";
import type { OpsStorageJson } from "../scripts/ops-storage-core";
import { collectRuntimeOpsPluginsStatus } from "./ops-plugins-runtime";
import {
  checkProductionStorage,
  checkTargetProductionStorage,
  type CheckResult,
} from "./production-readiness";

type OpsReadinessEnv = Record<string, string | undefined>;

export type OpsReadinessState = "ok" | "warn" | "error";
export type OpsReadinessStatus = "ready" | "attention" | "blocked";

export interface OpsReadinessMetric {
  label: string;
  value: string;
  tone: OpsReadinessState | "muted";
}

export interface OpsReadinessSection {
  id: "deploy" | "migrations" | "backup" | "storage" | "jobs" | "plugins";
  title: string;
  state: OpsReadinessState;
  summary: string;
  metrics: OpsReadinessMetric[];
  nextCommand: string | null;
  projectNextCommand: string | null;
  checks: CheckResult[];
}

export interface OpsReadinessReport {
  schemaVersion: "np.admin-ops-readiness.v1";
  generatedAt: string;
  target: DeployTarget;
  targetTitle: string;
  inferredTarget: boolean;
  status: OpsReadinessStatus;
  summary: {
    sections: number;
    ok: number;
    warnings: number;
    errors: number;
    checks: number;
    checkWarnings: number;
    checkErrors: number;
  };
  nextCommand: string | null;
  projectNextCommand: string | null;
  sections: OpsReadinessSection[];
}

export interface OpsReadinessTargetResolution {
  target: DeployTarget;
  inferred: boolean;
  invalidTarget: string | null;
}

export function resolveOpsReadinessTarget(
  rawTarget: string | null | undefined,
  env: OpsReadinessEnv = process.env,
): OpsReadinessTargetResolution {
  if (rawTarget && isDeployTarget(rawTarget)) {
    return { target: rawTarget, inferred: false, invalidTarget: null };
  }
  return {
    target: inferDeployTargetFromEnv(env) ?? "docker",
    inferred: true,
    invalidTarget: rawTarget ?? null,
  };
}

export function buildDeployReadinessSection(
  plan: DeployPlanJson,
  env: OpsReadinessEnv = process.env,
): OpsReadinessSection {
  const requiredChecks = plan.requiredEnv.map((check) => envRequirementToCheck(check, "error"));
  const recommendedChecks = plan.recommendedEnv.map((check) =>
    envRequirementToCheck(check, "warn"),
  );
  const productionChecks = [
    checkProductionStorage(true, plan.target, env),
    ...checkTargetProductionStorage(true, plan.target, env),
  ].filter((check): check is CheckResult => check !== null);
  const checks = [...requiredChecks, ...recommendedChecks, ...productionChecks];
  const requiredUnresolved = plan.summary.requiredEnv.unresolved;
  const recommendedUnresolved = plan.summary.recommendedEnv.unresolved;
  const productionErrors = productionChecks.filter((check) => check.state === "error").length;
  const productionWarnings = productionChecks.filter((check) => check.state === "warn").length;
  const state: OpsReadinessState =
    requiredUnresolved > 0 || productionErrors > 0
      ? "error"
      : recommendedUnresolved > 0 || productionWarnings > 0
        ? "warn"
        : "ok";
  const summary =
    requiredUnresolved > 0
      ? `${requiredUnresolved.toString()} required environment setting${
          requiredUnresolved === 1 ? "" : "s"
        } unresolved`
      : productionErrors > 0
        ? `${productionErrors.toString()} production safety check${
            productionErrors === 1 ? "" : "s"
          } blocking deploy`
        : recommendedUnresolved > 0
          ? `${recommendedUnresolved.toString()} recommended environment setting${
              recommendedUnresolved === 1 ? "" : "s"
            } unresolved`
          : productionWarnings > 0
            ? `${productionWarnings.toString()} production safety warning${
                productionWarnings === 1 ? "" : "s"
              } needs review`
            : "Required deploy environment is ready.";

  return {
    id: "deploy",
    title: `${plan.title} deploy gate`,
    state,
    summary,
    metrics: [
      ratioMetric(
        "Required env",
        plan.summary.requiredEnv.set,
        plan.summary.requiredEnv.total,
        requiredUnresolved > 0 ? "error" : "ok",
      ),
      ratioMetric(
        "Recommended env",
        plan.summary.recommendedEnv.set,
        plan.summary.recommendedEnv.total,
        recommendedUnresolved > 0 ? "warn" : "ok",
      ),
      ratioMetric(
        "Production checks",
        productionChecks.length - productionErrors - productionWarnings,
        productionChecks.length,
        productionErrors > 0 ? "error" : productionWarnings > 0 ? "warn" : "ok",
      ),
      {
        label: "Next steps",
        value: plan.nextCommands.length.toString(),
        tone: plan.nextCommands.length > 0 && state !== "ok" ? state : "muted",
      },
    ],
    nextCommand: plan.nextCommands[0] ?? null,
    projectNextCommand: plan.nextCommands[0] ?? null,
    checks,
  };
}

export function summarizeOpsReadinessSections(
  sections: OpsReadinessSection[],
): Pick<OpsReadinessReport, "status" | "summary" | "nextCommand" | "projectNextCommand"> {
  const sectionErrors = sections.filter((section) => section.state === "error").length;
  const sectionWarnings = sections.filter((section) => section.state === "warn").length;
  const checks = sections.flatMap((section) => section.checks);
  const checkErrors = checks.filter((check) => check.state === "error").length;
  const checkWarnings = checks.filter((check) => check.state === "warn").length;
  const status: OpsReadinessStatus =
    sectionErrors > 0 ? "blocked" : sectionWarnings > 0 ? "attention" : "ready";
  const actionSection =
    sections.find((section) => section.state === "error" && section.nextCommand) ??
    sections.find((section) => section.state === "warn" && section.nextCommand) ??
    sections.find((section) => section.nextCommand);

  return {
    status,
    summary: {
      sections: sections.length,
      ok: sections.length - sectionErrors - sectionWarnings,
      warnings: sectionWarnings,
      errors: sectionErrors,
      checks: checks.length,
      checkWarnings,
      checkErrors,
    },
    nextCommand: actionSection?.nextCommand ?? null,
    projectNextCommand: actionSection?.projectNextCommand ?? null,
  };
}

export async function gatherOpsReadiness(
  options: {
    env?: OpsReadinessEnv;
    target?: DeployTarget | null;
    inferredTarget?: boolean;
    now?: Date;
    cwd?: string;
  } = {},
): Promise<OpsReadinessReport> {
  const env = options.env ?? process.env;
  const resolvedTarget = options.target ?? resolveOpsReadinessTarget(null, env).target;
  const inferredTarget = options.inferredTarget ?? !options.target;
  const [deploy, migrations, backup, storage, jobs, plugins] = await Promise.all([
    captureSection("deploy", `${deployTargetTitle(resolvedTarget)} deploy gate`, async () => {
      const deployPlanCore = await loadDeployPlanCore();
      const deployPlan = deployPlanCore.buildDeployPlanJson(
        deployPlanCore.buildDeployPlan(resolvedTarget),
        inferredTarget,
        env,
      );
      return buildDeployReadinessSection(deployPlan, env);
    }),
    captureSection("migrations", "Migrations", async () => {
      const migrationsCore = await loadMigrateCore();
      return buildMigrationsSection(
        await migrationsCore.collectOpsMigrateReport({ mode: "plan", env }),
      );
    }),
    captureSection("backup", "Backup", async () => {
      const backupCore = await loadBackupCore();
      return buildBackupSection(
        await backupCore.collectOpsBackupReport({ mode: "status", required: true, env }),
      );
    }),
    captureSection("storage", "Storage", async () => {
      const storageCore = await loadStorageCore();
      return buildStorageSection(await storageCore.collectOpsStorageStatus(env, "verify"));
    }),
    captureSection("jobs", "Jobs", async () => {
      const jobsCore = await loadJobsCore();
      return buildJobsSection(await jobsCore.collectOpsJobsStatus(env, options.now ?? new Date()));
    }),
    captureSection("plugins", "Plugins", () =>
      buildPluginsSection(collectRuntimeOpsPluginsStatus()),
    ),
  ]);

  const sections = [deploy, migrations, backup, storage, jobs, plugins];
  const summary = summarizeOpsReadinessSections(sections);

  return {
    schemaVersion: "np.admin-ops-readiness.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    target: resolvedTarget,
    targetTitle: deployTargetTitle(resolvedTarget),
    inferredTarget,
    ...summary,
    sections,
  };
}

async function loadDeployPlanCore(): Promise<typeof DeployPlanCore> {
  return (await import("@nexpress/app/scripts/deploy-plan-core")) as unknown as typeof DeployPlanCore;
}

async function loadBackupCore(): Promise<typeof OpsBackupCore> {
  return (await import("@nexpress/app/scripts/ops-backup-core")) as unknown as typeof OpsBackupCore;
}

async function loadJobsCore(): Promise<typeof OpsJobsCore> {
  return (await import("@nexpress/app/scripts/ops-jobs-core")) as unknown as typeof OpsJobsCore;
}

async function loadMigrateCore(): Promise<typeof OpsMigrateCore> {
  return (await import("@nexpress/app/scripts/ops-migrate-core")) as unknown as typeof OpsMigrateCore;
}

async function loadStorageCore(): Promise<typeof OpsStorageCore> {
  return (await import("@nexpress/app/scripts/ops-storage-core")) as unknown as typeof OpsStorageCore;
}

function buildMigrationsSection(report: OpsMigrateJson): OpsReadinessSection {
  return {
    id: "migrations",
    title: "Migrations",
    state: stateFromStatus(report.status),
    summary: report.summary.inspectionBlocked
      ? "Migration state could not be inspected."
      : `${report.summary.pending.toString()} pending, ${report.summary.destructiveFindings.toString()} destructive finding${
          report.summary.destructiveFindings === 1 ? "" : "s"
        }.`,
    metrics: [
      numberMetric("Local", report.summary.local),
      numberMetric("Applied", report.summary.applied),
      numberMetric("Pending", report.summary.pending, report.summary.pending > 0 ? "error" : "ok"),
      numberMetric("Drift", report.summary.drifted, report.summary.drifted > 0 ? "error" : "ok"),
    ],
    nextCommand: report.nextCommand,
    projectNextCommand: report.projectNextCommand,
    checks: report.checks,
  };
}

function buildBackupSection(report: OpsBackupJson): OpsReadinessSection {
  const latest = report.manifests[0];
  return {
    id: "backup",
    title: "Backup",
    state: stateFromStatus(report.status),
    summary: latest
      ? `Latest backup ${latest.id} from ${latest.createdAt}.`
      : "No backup manifest is available.",
    metrics: [
      numberMetric("Manifests", report.summary.manifests),
      numberMetric("Verified", report.summary.verified),
      numberMetric("Restore verified", report.summary.restoreVerified),
      {
        label: "Freshness",
        value: report.summary.stale ? "stale" : "fresh",
        tone: report.summary.stale ? "error" : "ok",
      },
    ],
    nextCommand: report.nextCommand,
    projectNextCommand: report.projectNextCommand,
    checks: report.checks,
  };
}

function buildStorageSection(report: OpsStorageJson): OpsReadinessSection {
  const drift = report.summary.missingFiles + report.summary.orphanedFiles;
  return {
    id: "storage",
    title: "Storage",
    state: stateFromStatus(report.status),
    summary:
      drift > 0
        ? `${drift.toString()} media drift item${drift === 1 ? "" : "s"} detected.`
        : `${report.adapter} storage reports no media drift.`,
    metrics: [
      {
        label: "Adapter",
        value: report.adapter,
        tone: report.adapter === "unknown" ? "error" : "ok",
      },
      numberMetric("Media rows", report.summary.mediaRows),
      numberMetric("Indexed objects", report.summary.indexedObjects),
      numberMetric(
        "Missing",
        report.summary.missingFiles,
        report.summary.missingFiles > 0 ? "warn" : "ok",
      ),
      numberMetric(
        "Orphaned",
        report.summary.orphanedFiles,
        report.summary.orphanedFiles > 0 ? "warn" : "ok",
      ),
    ],
    nextCommand: report.nextCommand,
    projectNextCommand: report.projectNextCommand,
    checks: report.checks,
  };
}

function buildJobsSection(report: OpsJobsJson): OpsReadinessSection {
  const checks: CheckResult[] = [
    {
      id: "jobs.enabled",
      state: "ok",
      label: "Jobs mode",
      detail: report.enabled ? "enabled" : "disabled",
      hint: report.enabled
        ? undefined
        : "Enable jobs when scheduled publishing, email delivery, or background processing matters.",
    },
    {
      id: "jobs.pause",
      state: report.pause.paused ? "error" : "ok",
      label: "Jobs pause state",
      detail: report.pause.paused ? (report.pause.reason ?? "paused") : "running",
    },
    {
      id: "jobs.workers",
      state:
        report.enabled && report.summary.created > 0 && report.summary.workersAlive === 0
          ? "error"
          : report.enabled && report.summary.workersAlive === 0
            ? "warn"
            : "ok",
      label: "Worker heartbeat",
      detail: `${report.summary.workersAlive.toString()}/${report.summary.workersTotal.toString()} alive`,
      hint:
        report.enabled && report.summary.workersAlive === 0
          ? "Start a worker process before relying on scheduled or async jobs."
          : undefined,
    },
    {
      id: "jobs.failures",
      state: report.summary.failed > 0 ? "warn" : "ok",
      label: "Failed jobs",
      detail: report.summary.failed.toString(),
      hint: report.summary.failed > 0 ? "Review failed jobs before release." : undefined,
    },
  ];

  return {
    id: "jobs",
    title: "Jobs",
    state: stateFromStatus(report.status),
    summary: report.enabled
      ? `${report.summary.workersAlive.toString()} alive worker${
          report.summary.workersAlive === 1 ? "" : "s"
        }, ${report.summary.created.toString()} queued.`
      : "Jobs are disabled for this runtime.",
    metrics: [
      { label: "Mode", value: report.enabled ? "enabled" : "disabled", tone: "muted" },
      numberMetric(
        "Alive workers",
        report.summary.workersAlive,
        report.status === "blocked" ? "error" : "ok",
      ),
      numberMetric("Queued", report.summary.created, report.summary.created > 0 ? "warn" : "ok"),
      numberMetric("Failed", report.summary.failed, report.summary.failed > 0 ? "warn" : "ok"),
    ],
    nextCommand: report.nextCommand,
    projectNextCommand: report.projectNextCommand,
    checks,
  };
}

function buildPluginsSection(report: OpsPluginsJson): OpsReadinessSection {
  return {
    id: "plugins",
    title: "Plugins",
    state: stateFromStatus(report.status),
    summary: `${report.summary.plugins.toString()} plugin${
      report.summary.plugins === 1 ? "" : "s"
    }, ${report.summary.errors.toString()} error${report.summary.errors === 1 ? "" : "s"}.`,
    metrics: [
      numberMetric("Plugins", report.summary.plugins),
      numberMetric("Blocks", report.summary.blocks),
      numberMetric("Routes", report.summary.routes + report.summary.pageRoutes),
      numberMetric("Scheduled", report.summary.scheduled),
    ],
    nextCommand: report.nextCommand,
    projectNextCommand: report.projectNextCommand,
    checks: report.checks,
  };
}

async function captureSection(
  id: OpsReadinessSection["id"],
  title: string,
  collect: () => OpsReadinessSection | Promise<OpsReadinessSection>,
): Promise<OpsReadinessSection> {
  try {
    return await collect();
  } catch (error) {
    return {
      id,
      title,
      state: "error",
      summary: "Readiness probe failed before it could collect evidence.",
      metrics: [],
      nextCommand: null,
      projectNextCommand: null,
      checks: [
        {
          id: `${id}.probe`,
          state: "error",
          label: `${title} probe`,
          detail: safeErrorDetail(error),
        },
      ],
    };
  }
}

function envRequirementToCheck(
  check: EnvRequirementCheck,
  missingState: "warn" | "error",
): CheckResult {
  if (check.status === "set") {
    return {
      id: `deploy.env.${check.variable.toLowerCase()}`,
      state: "ok",
      label: check.name,
      detail: check.expectedValue ? `set to ${check.expectedValue}` : "set",
    };
  }
  return {
    id: `deploy.env.${check.variable.toLowerCase()}`,
    state: missingState,
    label: check.name,
    detail:
      check.status === "missing"
        ? "not set"
        : `expected ${check.expectedValue ?? check.name}, found ${redactEnvValue(
            check.variable,
            check.actualValue,
          )}`,
    hint: check.hint,
  };
}

function stateFromStatus(
  status: "ready" | "attention" | "blocked" | "disabled",
): OpsReadinessState {
  if (status === "blocked") return "error";
  if (status === "attention") return "warn";
  return "ok";
}

function ratioMetric(
  label: string,
  value: number,
  total: number,
  tone: OpsReadinessMetric["tone"] = "muted",
): OpsReadinessMetric {
  return { label, value: `${value.toString()}/${total.toString()}`, tone };
}

function numberMetric(
  label: string,
  value: number,
  tone: OpsReadinessMetric["tone"] = "muted",
): OpsReadinessMetric {
  return { label, value: value.toString(), tone };
}

function redactEnvValue(variable: string, value: string | undefined): string {
  if (!value) return "";
  if (/(SECRET|TOKEN|PASSWORD|KEY)/i.test(variable)) return "[redacted]";
  return value;
}

function safeErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const databaseUrl = process.env.DATABASE_URL;
  const redacted = databaseUrl ? raw.split(databaseUrl).join("[redacted DATABASE_URL]") : raw;
  return redacted.split(/\r?\n/)[0]?.slice(0, 240) ?? "Unknown error";
}
