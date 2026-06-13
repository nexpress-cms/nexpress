import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { CheckResult } from "./doctor-readiness.js";
import { toProjectCommand } from "./ops-command-format.js";
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
  { id: "drop-table", pattern: /\bdrop\s+table\b/i },
  { id: "drop-column", pattern: /\bdrop\s+column\b/i },
  { id: "truncate", pattern: /\btruncate\b/i },
  { id: "delete-without-where", pattern: /^\s*delete\s+from\b(?![\s\S]*\bwhere\b)/i },
  { id: "alter-type", pattern: /\balter\s+table\b[\s\S]*\balter\s+column\b[\s\S]*\btype\b/i },
];

async function loadPg(): Promise<PgModuleLike> {
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const resolved = require.resolve("pg");
  return import(resolved) as Promise<PgModuleLike>;
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
  if (args.status.local.length === 0) {
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
  const nextCommand =
    status === "ready"
      ? null
      : args.mode === "plan"
        ? "nexpress ops backup status --required --json"
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
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    pending: args.status.pending.map((migration) => ({
      tag: migration.tag,
      createdAt: migration.createdAt,
      hash: migration.hash,
    })),
    destructiveFindings: args.destructiveFindings,
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
  const local = readLocalMigrationEntries(migrationsFolder);
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
    pg = await loadPg();
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
    `${formatState(report.status, options.color)}: ${report.summary.pending.toString()} pending, ${report.summary.destructiveFindings.toString()} destructive findings`,
  ];
  for (const check of report.checks) lines.push(formatCheck(check, options.color));
  if (report.pending.length > 0) {
    lines.push("pending:");
    for (const migration of report.pending) lines.push(`  - ${migration.tag}`);
  }
  if (report.destructiveFindings.length > 0) {
    lines.push("destructive SQL:");
    for (const finding of report.destructiveFindings) {
      lines.push(`  - ${finding.migration}:${finding.line.toString()} ${finding.pattern}`);
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
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
