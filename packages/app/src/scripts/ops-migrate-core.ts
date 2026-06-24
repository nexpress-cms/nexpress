import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import type { CheckResult } from "./doctor-readiness.js";
import { collectOpsBackupReport, type OpsBackupJson } from "./ops-backup-core.js";
import { toProjectCommand } from "./ops-command-format.js";
import {
  buildOpsMutationAudit,
  defaultOpsArtifactPath,
  type OpsMutationAudit,
  writeOpsJsonArtifact,
} from "./ops-mutation.js";
import {
  buildMigrationStatus,
  MIGRATIONS_TABLE_NAME,
  readAppliedMigrations,
  readLocalMigrationEntries,
  type MigrationStatus,
} from "./migration-status.js";

type OpsMigrateEnv = Record<string, string | undefined>;

interface PgClientLike {
  connect(): Promise<void>;
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface PgModuleLike {
  default: {
    Client: new (config: {
      connectionString: string;
      connectionTimeoutMillis?: number;
    }) => PgClientLike;
  };
}

interface CollectedOpsMigrateState {
  migrationsFolder: string;
  status: MigrationStatus;
  destructiveFindings: DestructiveSqlFinding[];
  checks: CheckResult[];
}

export type OpsMigrateMode = "status" | "plan";

export interface DestructiveSqlFinding {
  migration: string;
  pattern: string;
  line: number;
  sql: string;
}

export interface OpsMigrateSummary {
  local: number;
  applied: number;
  pending: number;
  drifted: number;
  unknownApplied: number;
  destructiveFindings: number;
  inspectionBlocked: boolean;
  backupRequired: boolean;
  manualReviewRequired: boolean;
  canApplyAfterBackup: boolean;
}

export interface OpsMigrateAction {
  id:
    | "backup.required"
    | "migrate.review_drift"
    | "migrate.review_unknown_applied"
    | "migrate.review_destructive_sql"
    | "migrate.apply_pending"
    | "release.verify";
  phase: "prepare" | "review" | "apply" | "verify";
  command: string;
  projectCommand: string;
  required: boolean;
  requiresApproval: boolean;
  blockedBy: string[];
  note: string;
}

export interface OpsMigrateJson {
  schemaVersion: "np.ops-migrate.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  mode: OpsMigrateMode;
  migrationsFolder: string;
  migrationTable: string;
  summary: OpsMigrateSummary;
  nextCommand: string | null;
  projectNextCommand: string | null;
  pending: Array<{ tag: string; createdAt: number; hash: string }>;
  destructiveFindings: DestructiveSqlFinding[];
  actions: OpsMigrateAction[];
  checks: CheckResult[];
}

export interface OpsMigrateRollbackPlanStep {
  id: string;
  phase: "inspect" | "prepare" | "rollback" | "verify";
  command: string;
  projectCommand: string;
  required: boolean;
  requiresApproval: boolean;
  note: string;
}

export interface OpsMigrateRollbackPlanJson {
  schemaVersion: "np.ops-migrate-rollback-plan.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  migrationsFolder: string;
  migrationTable: string;
  summary: OpsMigrateSummary & {
    commands: number;
    safeToPlan: boolean;
  };
  nextCommand: string | null;
  projectNextCommand: string | null;
  pending: OpsMigrateJson["pending"];
  destructiveFindings: DestructiveSqlFinding[];
  checks: CheckResult[];
  steps: OpsMigrateRollbackPlanStep[];
}

export interface OpsMigrateApplyJson {
  schemaVersion: "np.ops-migrate-apply.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  mode: "apply";
  migrationsFolder: string;
  migrationTable: string;
  summary: OpsMigrateSummary & {
    backupReady: boolean;
    applied: number;
    remainingPending: number;
  };
  mutation: OpsMutationAudit;
  nextCommand: string | null;
  projectNextCommand: string | null;
  pending: OpsMigrateJson["pending"];
  destructiveFindings: DestructiveSqlFinding[];
  checks: CheckResult[];
}

interface RenderOptions {
  color: boolean;
}

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const EMPTY_ANSI = {
  green: "",
  yellow: "",
  red: "",
  dim: "",
  reset: "",
};

const DESTRUCTIVE_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "drop-schema", pattern: /\bdrop\s+schema\b/i },
  { id: "drop-table", pattern: /\bdrop\s+table\b/i },
  { id: "drop-index", pattern: /\bdrop\s+index\b/i },
  { id: "drop-column", pattern: /\bdrop\s+column\b/i },
  { id: "drop-constraint", pattern: /\bdrop\s+constraint\b/i },
  { id: "truncate", pattern: /\btruncate\b/i },
  { id: "delete-without-where", pattern: /^\s*delete\s+from\b(?![\s\S]*\bwhere\b)/i },
  { id: "alter-type", pattern: /\balter\s+table\b[\s\S]*\balter\s+column\b[\s\S]*\btype\b/i },
  {
    id: "set-not-null",
    pattern: /\balter\s+table\b[\s\S]*\balter\s+column\b[\s\S]*\bset\s+not\s+null\b/i,
  },
  { id: "rename-table", pattern: /\balter\s+table\b[\s\S]*\brename\s+to\b/i },
  { id: "rename-column", pattern: /\balter\s+table\b[\s\S]*\brename\s+column\b/i },
];

function loadPg(): PgModuleLike {
  return { default: pg as unknown as PgModuleLike["default"] };
}

function countChecks(checks: CheckResult[]): { errors: number; warnings: number } {
  return {
    errors: checks.filter((check) => check.state === "error").length,
    warnings: checks.filter((check) => check.state === "warn").length,
  };
}

function migrationSqlFileName(tag: string): string {
  return `${tag}.sql`;
}

function withProjectCommand<T extends { command: string }>(
  action: T,
): T & { projectCommand: string } {
  return { ...action, projectCommand: toProjectCommand(action.command) };
}

function buildOpsMigrateActions(args: {
  status: MigrationStatus;
  destructiveFindings: DestructiveSqlFinding[];
  inspectionBlocked: boolean;
}): OpsMigrateAction[] {
  if (args.inspectionBlocked) return [];

  const actions: OpsMigrateAction[] = [];
  const hasPending = args.status.pending.length > 0;

  if (args.status.drifted.length > 0) {
    actions.push(
      withProjectCommand({
        id: "migrate.review_drift",
        phase: "review",
        command: "restore the matching migration files from git before applying more migrations",
        required: true,
        requiresApproval: true,
        blockedBy: [],
        note: "Applied migration hashes differ from local files; applying more migrations can compound drift.",
      }),
    );
  }

  if (args.status.unknownApplied.length > 0) {
    actions.push(
      withProjectCommand({
        id: "migrate.review_unknown_applied",
        phase: "review",
        command: "confirm DATABASE_URL points at the intended NexPress database and codebase",
        required: true,
        requiresApproval: true,
        blockedBy: [],
        note: "The database has applied migrations that are not present in this checkout.",
      }),
    );
  }

  if (args.destructiveFindings.length > 0) {
    actions.push(
      withProjectCommand({
        id: "migrate.review_destructive_sql",
        phase: "review",
        command: "review pending SQL manually and confirm the rollback decision",
        required: true,
        requiresApproval: true,
        blockedBy: [],
        note: "Potentially destructive SQL requires human review before migration apply.",
      }),
    );
  }

  if (hasPending) {
    actions.push(
      withProjectCommand({
        id: "backup.required",
        phase: "prepare",
        command: "nexpress ops backup status --required --json",
        required: true,
        requiresApproval: false,
        blockedBy: [],
        note: "Confirm a fresh verified backup before applying pending migrations.",
      }),
      withProjectCommand({
        id: "migrate.apply_pending",
        phase: "apply",
        command: "pnpm db:migrate",
        required: true,
        requiresApproval: true,
        blockedBy: [
          "backup.required",
          ...(args.status.drifted.length > 0 ? ["migrate.review_drift"] : []),
          ...(args.status.unknownApplied.length > 0 ? ["migrate.review_unknown_applied"] : []),
          ...(args.destructiveFindings.length > 0 ? ["migrate.review_destructive_sql"] : []),
        ],
        note: "Apply pending migrations only after backup and required reviews are complete.",
      }),
      withProjectCommand({
        id: "release.verify",
        phase: "verify",
        command: "nexpress release verify --json",
        required: true,
        requiresApproval: false,
        blockedBy: ["migrate.apply_pending"],
        note: "Verify the live site after migrations and deploy promotion.",
      }),
    );
  }

  return actions;
}

export async function scanDestructiveSql(
  folder: string,
  status: MigrationStatus,
): Promise<DestructiveSqlFinding[]> {
  const findings: DestructiveSqlFinding[] = [];
  for (const migration of status.pending) {
    const migrationFile = migrationSqlFileName(migration.tag);
    const file = join(folder, migrationFile);
    const sql = await readFile(file, "utf8");
    const statements = sql.split(/;\s*(?:\r?\n|$)/);
    let lineOffset = 1;
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (!trimmed) {
        lineOffset += statement.split(/\r?\n/).length - 1;
        continue;
      }
      for (const destructive of DESTRUCTIVE_PATTERNS) {
        if (destructive.pattern.test(trimmed)) {
          findings.push({
            migration: migration.tag,
            pattern: destructive.id,
            line: lineOffset,
            sql: trimmed.replace(/\s+/g, " ").slice(0, 220),
          });
        }
      }
      lineOffset += statement.split(/\r?\n/).length - 1;
    }
  }
  return findings;
}

export function buildOpsMigrateJson(args: {
  mode: OpsMigrateMode;
  migrationsFolder: string;
  status: MigrationStatus;
  destructiveFindings: DestructiveSqlFinding[];
  checks?: CheckResult[];
}): OpsMigrateJson {
  const checks = [...(args.checks ?? [])];
  const hasLocalMigrationCheck = checks.some((check) => check.id === "migrate.local_migrations");
  if (!hasLocalMigrationCheck && args.status.local.length === 0) {
    checks.push({
      id: "migrate.local_migrations",
      state: "error",
      label: "Local migrations",
      detail: "none found",
      hint: "Run `pnpm db:generate`, review the SQL, then re-run this plan.",
    });
  } else {
    checks.push({
      id: "migrate.local_migrations",
      state: "ok",
      label: "Local migrations",
      detail: `${args.status.local.length.toString()} files`,
    });
  }

  if (args.status.drifted.length > 0) {
    checks.push({
      id: "migrate.drift",
      state: "error",
      label: "Migration drift",
      detail: `${args.status.drifted.length.toString()} applied hash mismatch`,
      hint: "Restore the matching migration files from git before applying more migrations.",
    });
  } else {
    checks.push({ id: "migrate.drift", state: "ok", label: "Migration drift" });
  }

  if (args.status.unknownApplied.length > 0) {
    checks.push({
      id: "migrate.unknown_applied",
      state: "error",
      label: "Unknown applied migrations",
      detail: `${args.status.unknownApplied.length.toString()} rows not present locally`,
      hint: "Confirm DATABASE_URL points at the intended NexPress database and codebase.",
    });
  } else {
    checks.push({
      id: "migrate.unknown_applied",
      state: "ok",
      label: "Unknown applied migrations",
    });
  }

  if (args.destructiveFindings.length > 0) {
    checks.push({
      id: "migrate.destructive_sql",
      state: "error",
      label: "Destructive SQL",
      detail: `${args.destructiveFindings.length.toString()} pending destructive pattern`,
      hint: "Review the SQL manually and confirm a fresh backup before applying.",
    });
  } else {
    checks.push({ id: "migrate.destructive_sql", state: "ok", label: "Destructive SQL" });
  }

  if (args.status.pending.length > 0) {
    checks.push({
      id: "migrate.pending",
      state: args.mode === "plan" ? "error" : "warn",
      label: "Pending migrations",
      detail: `${args.status.pending.length.toString()} pending`,
      hint: "Run `nexpress ops migrate plan --json`, review backup readiness, then apply manually with `pnpm db:migrate`.",
    });
  } else {
    checks.push({ id: "migrate.pending", state: "ok", label: "Pending migrations" });
  }

  const counts = countChecks(checks);
  const status = counts.errors > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const inspectionBlocked = checks.some(
    (check) =>
      check.state === "error" &&
      (check.id === "migrate.database" || check.id === "migrate.local_migrations"),
  );
  const localInspectionBlocked = checks.some(
    (check) => check.state === "error" && check.id === "migrate.local_migrations",
  );
  const databaseInspectionBlocked = checks.some(
    (check) => check.state === "error" && check.id === "migrate.database",
  );
  const actions = buildOpsMigrateActions({
    status: args.status,
    destructiveFindings: args.destructiveFindings,
    inspectionBlocked,
  });
  const backupRequired = !inspectionBlocked && args.status.pending.length > 0;
  const manualReviewRequired =
    args.status.drifted.length > 0 ||
    args.status.unknownApplied.length > 0 ||
    args.destructiveFindings.length > 0;
  const blockingErrorsBeyondPending = checks.filter(
    (check) => check.state === "error" && check.id !== "migrate.pending",
  ).length;
  const nextPlanCommand =
    args.status.pending.length > 0
      ? "nexpress ops backup status --required --json"
      : manualReviewRequired
        ? "nexpress ops migrate rollback-plan --json"
        : "nexpress ops backup status --required --json";
  const nextCommand =
    status === "ready"
      ? null
      : localInspectionBlocked
        ? "pnpm db:generate"
        : databaseInspectionBlocked
          ? "nexpress ops migrate status --json"
          : args.mode === "plan"
            ? nextPlanCommand
            : "nexpress ops migrate plan --json";
  return {
    schemaVersion: "np.ops-migrate.v1",
    ok: counts.errors === 0,
    status,
    mode: args.mode,
    migrationsFolder: args.migrationsFolder,
    migrationTable: MIGRATIONS_TABLE_NAME,
    summary: {
      local: args.status.local.length,
      applied: args.status.applied.length,
      pending: args.status.pending.length,
      drifted: args.status.drifted.length,
      unknownApplied: args.status.unknownApplied.length,
      destructiveFindings: args.destructiveFindings.length,
      inspectionBlocked,
      backupRequired,
      manualReviewRequired,
      canApplyAfterBackup:
        backupRequired && !manualReviewRequired && blockingErrorsBeyondPending === 0,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    pending: args.status.pending.map((migration) => ({
      tag: migration.tag,
      createdAt: migration.createdAt,
      hash: migration.hash,
    })),
    destructiveFindings: args.destructiveFindings,
    actions,
    checks,
  };
}

function rollbackPlanSteps(args: {
  status: MigrationStatus;
  destructiveFindings: DestructiveSqlFinding[];
}): OpsMigrateRollbackPlanStep[] {
  const steps: Array<Omit<OpsMigrateRollbackPlanStep, "projectCommand">> = [
    {
      id: "migrate.status",
      phase: "inspect",
      command: "nexpress ops migrate status --json",
      required: true,
      requiresApproval: false,
      note: "Capture local/applied migration state before planning rollback.",
    },
    {
      id: "backup.required",
      phase: "prepare",
      command: "nexpress ops backup status --required --json",
      required: true,
      requiresApproval: false,
      note: "Confirm a fresh verified backup exists before any migration apply or rollback.",
    },
    {
      id: "backup.restore-plan",
      phase: "prepare",
      command: "nexpress ops backup restore-plan latest --json",
      required: true,
      requiresApproval: false,
      note: "Confirm the backup can be restored into an isolated environment.",
    },
  ];

  if (args.status.pending.length > 0) {
    steps.push({
      id: "migrate.pending-review",
      phase: "inspect",
      command: "nexpress ops migrate plan --json",
      required: true,
      requiresApproval: false,
      note: "Review pending migration hashes and destructive SQL findings before applying.",
    });
  }

  if (args.destructiveFindings.length > 0) {
    steps.push({
      id: "migrate.destructive-review",
      phase: "inspect",
      command: "review pending SQL manually and document the rollback decision",
      required: true,
      requiresApproval: true,
      note: "Destructive SQL requires a human rollback decision before apply.",
    });
  }

  steps.push(
    {
      id: "rollback.database",
      phase: "rollback",
      command: "restore the selected backup into the production database",
      required: true,
      requiresApproval: true,
      note: "NexPress does not auto-generate down migrations; rollback is backup restore.",
    },
    {
      id: "rollback.media",
      phase: "rollback",
      command: "restore the matching media snapshot for the selected backup",
      required: true,
      requiresApproval: true,
      note: "Database rows and media files must come from the same backup window.",
    },
    {
      id: "rollback.verify",
      phase: "verify",
      command: "nexpress release verify --json",
      required: true,
      requiresApproval: false,
      note: "Verify the site after rollback before resuming normal writes.",
    },
  );

  return steps.map((step) => ({ ...step, projectCommand: toProjectCommand(step.command) }));
}

export function buildOpsMigrateRollbackPlanJson(args: {
  migrationsFolder: string;
  status: MigrationStatus;
  destructiveFindings: DestructiveSqlFinding[];
  checks?: CheckResult[];
}): OpsMigrateRollbackPlanJson {
  const plan = buildOpsMigrateJson({
    mode: "plan",
    migrationsFolder: args.migrationsFolder,
    status: args.status,
    destructiveFindings: args.destructiveFindings,
    checks: args.checks,
  });
  const checks = [...plan.checks];
  if (args.status.pending.length === 0 && args.destructiveFindings.length === 0) {
    checks.push({
      id: "migrate.rollback_plan.noop",
      state: "warn",
      label: "Rollback plan",
      detail: "no pending migration risk detected",
      hint: "Keep the plan for incident prep, but no migration rollback action is currently needed.",
    });
  } else {
    checks.push({
      id: "migrate.rollback_plan",
      state: "ok",
      label: "Rollback plan",
      detail: "backup-restore rollback path documented",
    });
  }
  const counts = countChecks(checks);
  const status = counts.errors > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const steps = rollbackPlanSteps({
    status: args.status,
    destructiveFindings: args.destructiveFindings,
  });
  const hasMigrationRisk =
    args.status.pending.length > 0 ||
    args.status.drifted.length > 0 ||
    args.status.unknownApplied.length > 0 ||
    args.destructiveFindings.length > 0;
  const nextCommand = !hasMigrationRisk
    ? null
    : status === "blocked"
      ? "nexpress ops backup status --required --json"
      : (steps.find((step) => step.requiresApproval)?.command ?? null);
  return {
    schemaVersion: "np.ops-migrate-rollback-plan.v1",
    ok: counts.errors === 0,
    status,
    migrationsFolder: args.migrationsFolder,
    migrationTable: MIGRATIONS_TABLE_NAME,
    summary: {
      ...plan.summary,
      commands: steps.length,
      safeToPlan: counts.errors === 0,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    pending: plan.pending,
    destructiveFindings: args.destructiveFindings,
    checks,
    steps,
  };
}

async function collectOpsMigrateState(args: {
  env?: OpsMigrateEnv;
  migrationsFolder?: string;
}): Promise<CollectedOpsMigrateState> {
  const env = args.env ?? process.env;
  const migrationsFolder = args.migrationsFolder ?? "./drizzle";
  let local: ReturnType<typeof readLocalMigrationEntries>;
  try {
    local = readLocalMigrationEntries(migrationsFolder);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : String(error);
    return {
      migrationsFolder,
      status: buildMigrationStatus([], []),
      destructiveFindings: [],
      checks: [
        {
          id: "migrate.local_migrations",
          state: "error",
          label: "Local migrations",
          detail: detail && detail !== "[object Object]" ? detail : "metadata unavailable",
          hint: "Run `pnpm db:generate`, review the SQL, then re-run this plan.",
        },
      ],
    };
  }
  const checks: CheckResult[] = [];

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      migrationsFolder,
      status: buildMigrationStatus(local, []),
      destructiveFindings: [],
      checks: [
        {
          id: "migrate.database",
          state: "error",
          label: "Database connection",
          detail: "DATABASE_URL not set",
          hint: "Set DATABASE_URL before inspecting applied migrations.",
        },
      ],
    };
  }

  let pg: PgModuleLike;
  try {
    pg = loadPg();
  } catch {
    return {
      migrationsFolder,
      status: buildMigrationStatus(local, []),
      destructiveFindings: [],
      checks: [
        {
          id: "migrate.database",
          state: "error",
          label: "Database connection",
          detail: "pg package is not available",
          hint: "Install project dependencies before inspecting applied migrations.",
        },
      ],
    };
  }

  const client = new pg.default.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    const applied = await readAppliedMigrations(client);
    await client.end();
    checks.push({ id: "migrate.database", state: "ok", label: "Database connection" });
    const status = buildMigrationStatus(local, applied);
    const destructiveFindings = await scanDestructiveSql(migrationsFolder, status);
    return {
      migrationsFolder,
      status,
      destructiveFindings,
      checks,
    };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    const detail = error instanceof Error && error.message ? error.message : String(error);
    return {
      migrationsFolder,
      status: buildMigrationStatus(local, []),
      destructiveFindings: [],
      checks: [
        {
          id: "migrate.database",
          state: "error",
          label: "Database connection",
          detail: detail && detail !== "[object Object]" ? detail : "query failed",
          hint: "Check DATABASE_URL and database reachability.",
        },
      ],
    };
  }
}

export async function collectOpsMigrateReport(args: {
  mode: OpsMigrateMode;
  env?: OpsMigrateEnv;
  migrationsFolder?: string;
}): Promise<OpsMigrateJson> {
  const collected = await collectOpsMigrateState(args);
  return buildOpsMigrateJson({
    mode: args.mode,
    migrationsFolder: collected.migrationsFolder,
    status: collected.status,
    destructiveFindings: collected.destructiveFindings,
    checks: collected.checks,
  });
}

export async function collectOpsMigrateRollbackPlan(args: {
  env?: OpsMigrateEnv;
  migrationsFolder?: string;
}): Promise<OpsMigrateRollbackPlanJson> {
  const collected = await collectOpsMigrateState({
    env: args.env,
    migrationsFolder: args.migrationsFolder,
  });
  return buildOpsMigrateRollbackPlanJson({
    migrationsFolder: collected.migrationsFolder,
    status: collected.status,
    destructiveFindings: collected.destructiveFindings,
    checks: collected.checks,
  });
}

function applyNextCommand(): string {
  return "nexpress ops migrate apply --safe --execute --approve migrate-apply --json";
}

function applySafeChecks(plan: OpsMigrateJson, backup: OpsBackupJson): CheckResult[] {
  const checks = plan.checks.map((check) =>
    check.id === "migrate.pending" && plan.summary.pending > 0
      ? {
          ...check,
          state: "ok" as const,
          hint: undefined,
          detail: `${plan.summary.pending.toString()} pending and ready for apply gate`,
        }
      : check,
  );
  if (plan.summary.pending === 0) {
    checks.push({
      id: "migrate.apply.backup",
      state: "ok",
      label: "Migration apply backup gate",
      detail: "no pending migrations; backup not required",
    });
    return checks;
  }
  checks.push(
    ...backup.checks.map((check) => ({
      ...check,
      id: `backup.${check.id.replace(/^backup\./, "")}`,
    })),
  );
  if (!backup.ok) {
    checks.push({
      id: "migrate.apply.backup",
      state: "error",
      label: "Migration apply backup gate",
      detail: "fresh verified backup is required before apply",
      hint: "Run `nexpress ops backup status --required --json` and record a verified backup.",
    });
  } else {
    checks.push({
      id: "migrate.apply.backup",
      state: "ok",
      label: "Migration apply backup gate",
      detail: backup.summary.latestId ?? "backup ready",
    });
  }
  return checks;
}

function buildOpsMigrateApplyJson(args: {
  plan: OpsMigrateJson;
  backup: OpsBackupJson;
  checks: CheckResult[];
  execute?: boolean;
  approve?: string | null;
  artifactPath: string | null;
  startedAt: Date;
  applied: number;
  remainingPending: number;
  error?: string | null;
  nextCommand?: string | null;
}): OpsMigrateApplyJson {
  const counts = countChecks(args.checks);
  const status = counts.errors > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const nextCommand =
    args.nextCommand ??
    (args.execute && counts.errors === 0 ? "nexpress release verify --json" : applyNextCommand());
  return {
    schemaVersion: "np.ops-migrate-apply.v1",
    ok: counts.errors === 0,
    status,
    mode: "apply",
    migrationsFolder: args.plan.migrationsFolder,
    migrationTable: args.plan.migrationTable,
    summary: {
      ...args.plan.summary,
      backupReady: args.backup.ok,
      applied: args.applied,
      remainingPending: args.remainingPending,
    },
    mutation: buildOpsMutationAudit({
      action: "migrate.apply-safe",
      execute: args.execute,
      approve: args.approve,
      requiredApproval: "migrate-apply",
      artifactPath: args.artifactPath,
      applied: Boolean(args.execute && args.applied > 0 && counts.errors === 0),
      error: args.error ?? null,
      rollbackHint:
        "NexPress does not generate down migrations. Roll back by restoring the verified backup captured before apply.",
      nextCommand,
      startedAt: args.startedAt,
      completedAt: new Date(),
    }),
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    pending: args.plan.pending,
    destructiveFindings: args.plan.destructiveFindings,
    checks: args.checks,
  };
}

async function applyMigrationsWithLock(args: {
  env: OpsMigrateEnv;
  migrationsFolder: string;
}): Promise<void> {
  const url = args.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const pg = loadPg();
  const client = new pg.default.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  let locked = false;
  try {
    await client.connect();
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      ["nexpress.ops.migrate.apply"],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) throw new Error("Another migration apply appears to be running.");
    const db = drizzle(client as never);
    await migrate(db, { migrationsFolder: args.migrationsFolder });
  } finally {
    if (locked) {
      try {
        await client.query("select pg_advisory_unlock(hashtext($1))", [
          "nexpress.ops.migrate.apply",
        ]);
      } catch {
        /* swallow */
      }
    }
    await client.end().catch(() => {});
  }
}

export async function runOpsMigrateApply(args: {
  safe?: boolean;
  execute?: boolean;
  approve?: string | null;
  out?: string | null;
  env?: OpsMigrateEnv;
  migrationsFolder?: string;
}): Promise<OpsMigrateApplyJson> {
  const env = args.env ?? process.env;
  const startedAt = new Date();
  const artifactPath =
    args.out ??
    (args.execute ? defaultOpsArtifactPath("migrations", "migrate-apply", startedAt) : null);
  const plan = await collectOpsMigrateReport({
    mode: "plan",
    env,
    migrationsFolder: args.migrationsFolder,
  });
  const backup = await collectOpsBackupReport({ mode: "status", required: true, env });
  const checks = applySafeChecks(plan, backup);

  if (!args.safe) {
    checks.push({
      id: "migrate.apply.safe_flag",
      state: "error",
      label: "Migration apply mode",
      detail: "missing --safe",
    });
  }
  if (plan.summary.inspectionBlocked) {
    checks.push({
      id: "migrate.apply.inspection",
      state: "error",
      label: "Migration apply inspection",
      detail: "migration state inspection is blocked",
    });
  }
  if (plan.summary.manualReviewRequired) {
    checks.push({
      id: "migrate.apply.manual_review",
      state: "error",
      label: "Migration apply manual review",
      detail: "drift, unknown applied migrations, or destructive SQL require manual handling",
    });
  }

  if (!args.execute) {
    const report = buildOpsMigrateApplyJson({
      plan,
      backup,
      checks,
      execute: false,
      approve: args.approve,
      artifactPath,
      startedAt,
      applied: 0,
      remainingPending: plan.summary.pending,
      nextCommand: plan.summary.pending > 0 ? applyNextCommand() : null,
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  }

  if (args.approve !== "migrate-apply") {
    checks.push({
      id: "migrate.apply.approval",
      state: "error",
      label: "Migration apply approval",
      detail: "missing --approve migrate-apply",
    });
    const report = buildOpsMigrateApplyJson({
      plan,
      backup,
      checks,
      execute: true,
      approve: args.approve,
      artifactPath,
      startedAt,
      applied: 0,
      remainingPending: plan.summary.pending,
      error: "Missing --approve migrate-apply",
      nextCommand: applyNextCommand(),
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  }

  if (countChecks(checks).errors > 0 || plan.summary.pending === 0) {
    const report = buildOpsMigrateApplyJson({
      plan,
      backup,
      checks,
      execute: true,
      approve: args.approve,
      artifactPath,
      startedAt,
      applied: 0,
      remainingPending: plan.summary.pending,
      error: plan.summary.pending === 0 ? null : "Migration apply gate is blocked",
      nextCommand: plan.summary.pending === 0 ? "nexpress release verify --json" : plan.nextCommand,
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  }

  try {
    await applyMigrationsWithLock({ env, migrationsFolder: plan.migrationsFolder });
    const after = await collectOpsMigrateReport({
      mode: "status",
      env,
      migrationsFolder: plan.migrationsFolder,
    });
    const report = buildOpsMigrateApplyJson({
      plan,
      backup,
      checks: [
        ...checks,
        {
          id: "migrate.apply.result",
          state: after.summary.pending === 0 ? "ok" : "warn",
          label: "Migration apply result",
          detail: `${after.summary.pending.toString()} pending after apply`,
        },
      ],
      execute: true,
      approve: args.approve,
      artifactPath,
      startedAt,
      applied: Math.max(0, plan.summary.pending - after.summary.pending),
      remainingPending: after.summary.pending,
      error: after.summary.pending === 0 ? null : "Some migrations remain pending after apply",
      nextCommand: "nexpress release verify --json",
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  } catch (error) {
    const report = buildOpsMigrateApplyJson({
      plan,
      backup,
      checks: [
        ...checks,
        {
          id: "migrate.apply.result",
          state: "error",
          label: "Migration apply result",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
      execute: true,
      approve: args.approve,
      artifactPath,
      startedAt,
      applied: 0,
      remainingPending: plan.summary.pending,
      error: error instanceof Error ? error.message : String(error),
      nextCommand: "nexpress ops migrate rollback-plan --json",
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  }
}

function formatState(state: OpsMigrateJson["status"], color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  if (state === "ready") return `${c.green}ready${c.reset}`;
  if (state === "attention") return `${c.yellow}attention${c.reset}`;
  return `${c.red}blocked${c.reset}`;
}

function formatCheck(check: CheckResult, color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  const marker =
    check.state === "ok"
      ? `${c.green}[ok]${c.reset}`
      : check.state === "warn"
        ? `${c.yellow}[warn]${c.reset}`
        : `${c.red}[error]${c.reset}`;
  const detail = check.detail ? ` - ${check.detail.replace(/\s+/g, " ")}` : "";
  return `${marker} ${check.id}${detail}`;
}

export function renderBriefOpsMigrateReport(
  report: OpsMigrateJson,
  options: RenderOptions = { color: true },
): string {
  const lines = [
    `${options.color ? ANSI.dim : ""}NexPress ops migrate ${report.mode}${options.color ? ANSI.reset : ""}`,
    report.summary.inspectionBlocked
      ? `${formatState(report.status, options.color)}: applied migration state unavailable`
      : `${formatState(report.status, options.color)}: ${report.summary.pending.toString()} pending, ${report.summary.destructiveFindings.toString()} destructive findings`,
  ];
  for (const check of report.checks) lines.push(formatCheck(check, options.color));
  if (!report.summary.inspectionBlocked && report.pending.length > 0) {
    lines.push("pending:");
    for (const migration of report.pending) lines.push(`  - ${migration.tag}`);
  }
  if (report.destructiveFindings.length > 0) {
    lines.push("destructive SQL:");
    for (const finding of report.destructiveFindings) {
      lines.push(`  - ${finding.migration}:${finding.line.toString()} ${finding.pattern}`);
    }
  }
  if (report.actions.length > 0) {
    lines.push("migration handoff:");
    for (const action of report.actions) {
      const approval = action.requiresApproval ? " approval" : "";
      lines.push(`  - [${action.phase}] ${action.command}${approval}`);
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}

export function renderBriefOpsMigrateApply(
  report: OpsMigrateApplyJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const lines = [
    `${c.dim}NexPress ops migrate apply${c.reset}`,
    `${formatState(report.status, options.color)}: ${report.summary.applied.toString()} applied, ${report.summary.remainingPending.toString()} pending`,
    `backup: ${report.summary.backupReady ? "ready" : "blocked"}`,
  ];
  for (const check of report.checks) lines.push(formatCheck(check, options.color));
  if (report.pending.length > 0) {
    lines.push("pending before apply:");
    for (const migration of report.pending) lines.push(`  - ${migration.tag}`);
  }
  lines.push(
    `mutation: ${report.mutation.action} applied=${String(report.mutation.applied)}${report.mutation.error ? ` error=${report.mutation.error}` : ""}`,
  );
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  if (report.mutation.artifactPath) lines.push(`artifact: ${report.mutation.artifactPath}`);
  return lines.join("\n");
}

export function renderBriefOpsMigrateRollbackPlan(
  report: OpsMigrateRollbackPlanJson,
  options: RenderOptions = { color: true },
): string {
  const lines = [
    `${options.color ? ANSI.dim : ""}NexPress ops migrate rollback-plan${options.color ? ANSI.reset : ""}`,
    `${formatState(report.status, options.color)}: ${report.summary.pending.toString()} pending, ${report.summary.destructiveFindings.toString()} destructive findings, ${report.summary.commands.toString()} commands`,
  ];
  for (const check of report.checks) lines.push(formatCheck(check, options.color));
  if (report.pending.length > 0) {
    lines.push("pending:");
    for (const migration of report.pending) lines.push(`  - ${migration.tag}`);
  }
  if (report.steps.length > 0) {
    lines.push("steps:");
    for (const step of report.steps) {
      const approval = step.requiresApproval ? " approval" : "";
      lines.push(`  - [${step.phase}] ${step.command}${approval}`);
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}
