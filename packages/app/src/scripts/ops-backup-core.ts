import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { toProjectCommand } from "./ops-command-format.js";
import type { CheckResult } from "./doctor-readiness.js";

type OpsBackupEnv = Record<string, string | undefined>;

export type OpsBackupMode = "create" | "status" | "list" | "verify";

export interface BackupManifest {
  id: string;
  createdAt: string;
  appVersion?: string;
  migrationVersion?: number | string | null;
  database?: {
    path?: string;
    sha256?: string;
    bytes?: number;
  };
  media?: {
    path?: string;
    manifestPath?: string;
    files?: number;
  };
  verification?: {
    verifiedAt?: string;
    restoreVerifiedAt?: string;
    status?: string;
  };
}

export interface BackupManifestSummary {
  id: string;
  createdAt: string;
  verified: boolean;
  restoreVerified: boolean;
  databasePath: string | null;
  mediaPath: string | null;
}

export interface OpsBackupSummary {
  manifests: number;
  verified: number;
  restoreVerified: number;
  latestId: string | null;
  latestCreatedAt: string | null;
  stale: boolean;
}

export interface OpsBackupJson {
  schemaVersion: "np.ops-backup.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  mode: OpsBackupMode;
  backupDir: string;
  required: boolean;
  maxAgeHours: number;
  summary: OpsBackupSummary;
  nextCommand: string | null;
  projectNextCommand: string | null;
  createdManifest?: BackupManifestSummary | null;
  manifests: BackupManifestSummary[];
  checks: CheckResult[];
}

export interface OpsBackupRestorePlanStep {
  id: string;
  phase: "inspect" | "prepare" | "restore" | "verify" | "record";
  command: string;
  projectCommand: string;
  required: boolean;
  requiresApproval: boolean;
  note: string;
}

export interface OpsBackupRestorePlanJson {
  schemaVersion: "np.ops-backup-restore-plan.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  backupDir: string;
  target: "isolated";
  manifestId: string | null;
  summary: {
    manifests: number;
    selected: boolean;
    verified: boolean;
    restoreVerified: boolean;
    databaseArtifact: boolean;
    mediaArtifact: boolean;
    commands: number;
  };
  nextCommand: string | null;
  projectNextCommand: string | null;
  manifest: BackupManifestSummary | null;
  checks: CheckResult[];
  steps: OpsBackupRestorePlanStep[];
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

function backupDirFromEnv(env: OpsBackupEnv): string {
  return resolve(process.cwd(), env.NP_BACKUP_DIR ?? ".nexpress/backups");
}

function maxAgeHoursFromEnv(env: OpsBackupEnv): number {
  const raw = env.NP_BACKUP_MAX_AGE_HOURS;
  if (!raw) return 24;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

function countChecks(checks: CheckResult[]): { errors: number; warnings: number } {
  return {
    errors: checks.filter((check) => check.state === "error").length,
    warnings: checks.filter((check) => check.state === "warn").length,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseBackupManifest(value: unknown): BackupManifest | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, "id");
  const createdAt = readString(record, "createdAt");
  if (!id || !createdAt || Number.isNaN(new Date(createdAt).getTime())) return null;
  return value as BackupManifest;
}

function manifestSummary(manifest: BackupManifest): BackupManifestSummary {
  return {
    id: manifest.id,
    createdAt: manifest.createdAt,
    verified:
      Boolean(manifest.verification?.verifiedAt) || manifest.verification?.status === "verified",
    restoreVerified: Boolean(manifest.verification?.restoreVerifiedAt),
    databasePath: manifest.database?.path ?? null,
    mediaPath: manifest.media?.path ?? manifest.media?.manifestPath ?? null,
  };
}

async function listManifestFiles(backupDir: string): Promise<string[]> {
  const entries = await readdir(backupDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(backupDir, entry.name));
}

async function readManifestFile(file: string): Promise<BackupManifest | null> {
  try {
    const raw = await readFile(file, "utf8");
    return parseBackupManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveBackupArtifactPath(backupDir: string, path: string): string | null {
  const resolved = resolve(backupDir, path);
  const rel = relative(backupDir, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return resolved;
}

function newestFirst(a: BackupManifestSummary, b: BackupManifestSummary): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function newestManifestFirst(a: BackupManifest, b: BackupManifest): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function isStale(latest: BackupManifestSummary | undefined, maxAgeHours: number): boolean {
  if (!latest) return true;
  const ageMs = Date.now() - new Date(latest.createdAt).getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

export function buildOpsBackupJson(args: {
  mode: OpsBackupMode;
  backupDir: string;
  required: boolean;
  maxAgeHours: number;
  manifests: BackupManifestSummary[];
  createdManifest?: BackupManifestSummary | null;
  checks?: CheckResult[];
}): OpsBackupJson {
  const manifests = [...args.manifests].sort(newestFirst);
  const latest = manifests[0];
  const stale = isStale(latest, args.maxAgeHours);
  const checks = [...(args.checks ?? [])];

  if (manifests.length === 0) {
    checks.push({
      id: "backup.manifest",
      state: args.required ? "error" : "warn",
      label: "Backup manifests",
      detail: "none found",
      hint: "Create a backup manifest before production release or restore drills.",
    });
  } else {
    checks.push({
      id: "backup.manifest",
      state: "ok",
      label: "Backup manifests",
      detail: `${manifests.length.toString()} found`,
    });
  }

  if (stale) {
    checks.push({
      id: "backup.stale",
      state: args.required ? "error" : "warn",
      label: "Backup freshness",
      detail: latest
        ? `latest backup is older than ${args.maxAgeHours.toString()} hours`
        : "no latest backup",
      hint: "Create and verify a fresh backup before production deploys.",
    });
  } else {
    checks.push({
      id: "backup.stale",
      state: "ok",
      label: "Backup freshness",
      detail: latest?.createdAt,
    });
  }

  if (latest && !latest.verified) {
    checks.push({
      id: "backup.verified",
      state: args.required ? "error" : "warn",
      label: "Backup verification",
      detail: "latest backup has not been verified",
      hint: "Verify the DB dump and media snapshot before relying on this backup.",
    });
  } else if (latest) {
    checks.push({ id: "backup.verified", state: "ok", label: "Backup verification" });
  }

  if (args.mode === "verify" && latest && !latest.restoreVerified) {
    checks.push({
      id: "backup.restore_verified",
      state: "warn",
      label: "Restore verification",
      detail: "latest backup has not passed restore verification",
      hint: "Run a restore drill against an isolated database and media snapshot.",
    });
  }

  const counts = countChecks(checks);
  const status = counts.errors > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const nextCommand =
    status === "ready"
      ? null
      : args.mode === "verify"
        ? "nexpress ops backup verify latest --json"
        : "nexpress ops backup status --required --json";
  return {
    schemaVersion: "np.ops-backup.v1",
    ok: counts.errors === 0,
    status,
    mode: args.mode,
    backupDir: args.backupDir,
    required: args.required,
    maxAgeHours: args.maxAgeHours,
    summary: {
      manifests: manifests.length,
      verified: manifests.filter((manifest) => manifest.verified).length,
      restoreVerified: manifests.filter((manifest) => manifest.restoreVerified).length,
      latestId: latest?.id ?? null,
      latestCreatedAt: latest?.createdAt ?? null,
      stale,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    createdManifest: args.createdManifest ?? null,
    manifests,
    checks,
  };
}

export async function collectOpsBackupReport(args: {
  mode: OpsBackupMode;
  required?: boolean;
  env?: OpsBackupEnv;
  manifestId?: string | null;
}): Promise<OpsBackupJson> {
  const env = args.env ?? process.env;
  const backupDir = backupDirFromEnv(env);
  const maxAgeHours = maxAgeHoursFromEnv(env);
  const required = args.required ?? false;
  const checks: CheckResult[] = [];

  try {
    const dirStat = await stat(backupDir);
    if (!dirStat.isDirectory()) {
      return buildOpsBackupJson({
        mode: args.mode,
        backupDir,
        required,
        maxAgeHours,
        manifests: [],
        checks: [
          {
            id: "backup.directory",
            state: required ? "error" : "warn",
            label: "Backup directory",
            detail: `${backupDir} is not a directory`,
          },
        ],
      });
    }
    checks.push({
      id: "backup.directory",
      state: "ok",
      label: "Backup directory",
      detail: backupDir,
    });
  } catch {
    return buildOpsBackupJson({
      mode: args.mode,
      backupDir,
      required,
      maxAgeHours,
      manifests: [],
      checks: [
        {
          id: "backup.directory",
          state: required ? "error" : "warn",
          label: "Backup directory",
          detail: `${backupDir} does not exist`,
          hint: "Set NP_BACKUP_DIR or create backup manifests in .nexpress/backups.",
        },
      ],
    });
  }

  const files = await listManifestFiles(backupDir);
  const parsed = await Promise.all(files.map(readManifestFile));
  const manifests = parsed.filter((manifest): manifest is BackupManifest => Boolean(manifest));
  const summaries = manifests.map(manifestSummary);
  const selectedManifest = selectBackupManifest(manifests, args.manifestId ?? "latest");
  const selectedSummary = selectedManifest ? manifestSummary(selectedManifest) : null;
  if (args.mode === "verify" && args.manifestId && !selectedManifest) {
    checks.push({
      id: "backup.verify.selection",
      state: "error",
      label: "Backup verification target",
      detail: `manifest ${args.manifestId} was not found`,
    });
  }
  if (args.mode === "verify" && selectedSummary) {
    const missing: string[] = [];
    if (selectedSummary.databasePath) {
      const databasePath = resolveBackupArtifactPath(backupDir, selectedSummary.databasePath);
      if (!databasePath || !(await pathExists(databasePath)))
        missing.push(selectedSummary.databasePath);
    }
    if (selectedSummary.mediaPath) {
      const mediaPath = resolveBackupArtifactPath(backupDir, selectedSummary.mediaPath);
      if (!mediaPath || !(await pathExists(mediaPath))) missing.push(selectedSummary.mediaPath);
    }
    if (missing.length > 0) {
      checks.push({
        id: "backup.artifacts",
        state: "error",
        label: "Backup artifacts",
        detail: `missing ${missing.join(", ")}`,
        hint: "Restore or recreate the missing backup artifacts before relying on this manifest.",
      });
    } else if (selectedSummary.databasePath || selectedSummary.mediaPath) {
      checks.push({ id: "backup.artifacts", state: "ok", label: "Backup artifacts" });
    }
  }

  return buildOpsBackupJson({
    mode: args.mode,
    backupDir,
    required,
    maxAgeHours,
    manifests: summaries,
    checks,
  });
}

async function collectBackupManifests(env: OpsBackupEnv): Promise<{
  backupDir: string;
  maxAgeHours: number;
  manifests: BackupManifest[];
  checks: CheckResult[];
}> {
  const backupDir = backupDirFromEnv(env);
  const maxAgeHours = maxAgeHoursFromEnv(env);
  const checks: CheckResult[] = [];

  try {
    const dirStat = await stat(backupDir);
    if (!dirStat.isDirectory()) {
      return {
        backupDir,
        maxAgeHours,
        manifests: [],
        checks: [
          {
            id: "backup.directory",
            state: "error",
            label: "Backup directory",
            detail: `${backupDir} is not a directory`,
          },
        ],
      };
    }
    checks.push({
      id: "backup.directory",
      state: "ok",
      label: "Backup directory",
      detail: backupDir,
    });
  } catch {
    return {
      backupDir,
      maxAgeHours,
      manifests: [],
      checks: [
        {
          id: "backup.directory",
          state: "error",
          label: "Backup directory",
          detail: `${backupDir} does not exist`,
          hint: "Set NP_BACKUP_DIR or create backup manifests in .nexpress/backups.",
        },
      ],
    };
  }

  const files = await listManifestFiles(backupDir);
  const parsed = await Promise.all(files.map(readManifestFile));
  return {
    backupDir,
    maxAgeHours,
    manifests: parsed.filter((manifest): manifest is BackupManifest => Boolean(manifest)),
    checks,
  };
}

function selectBackupManifest(
  manifests: BackupManifest[],
  manifestId: string | null,
): BackupManifest | null {
  const sorted = [...manifests].sort(newestManifestFirst);
  if (!manifestId || manifestId === "latest") return sorted[0] ?? null;
  return sorted.find((manifest) => manifest.id === manifestId) ?? null;
}

async function artifactCheck(args: {
  backupDir: string;
  id: string;
  label: string;
  path: string | null;
  required: boolean;
}): Promise<CheckResult> {
  if (!args.path) {
    return {
      id: args.id,
      state: args.required ? "error" : "warn",
      label: args.label,
      detail: "not recorded in backup manifest",
    };
  }
  const resolved = resolveBackupArtifactPath(args.backupDir, args.path);
  if (!resolved || !(await pathExists(resolved))) {
    return {
      id: args.id,
      state: "error",
      label: args.label,
      detail: `missing ${args.path}`,
      hint: "Restore or recreate the missing backup artifact before restore drills.",
    };
  }
  return {
    id: args.id,
    state: "ok",
    label: args.label,
    detail: args.path,
  };
}

function restorePlanSteps(manifest: BackupManifestSummary | null): OpsBackupRestorePlanStep[] {
  const withProjectCommands = (
    steps: Array<Omit<OpsBackupRestorePlanStep, "projectCommand">>,
  ): OpsBackupRestorePlanStep[] =>
    steps.map((step) => ({ ...step, projectCommand: toProjectCommand(step.command) }));

  if (!manifest) {
    return withProjectCommands([
      {
        id: "backup.create",
        phase: "prepare",
        command: "nexpress ops backup create --database artifacts/db.dump --verified --json",
        required: true,
        requiresApproval: false,
        note: "Record a backup manifest before planning a restore drill.",
      },
    ]);
  }

  const database = manifest.databasePath ?? "<database-dump>";
  const media = manifest.mediaPath ?? "<media-snapshot>";
  return withProjectCommands([
    {
      id: "backup.verify",
      phase: "inspect",
      command: `nexpress ops backup verify ${manifest.id} --json`,
      required: true,
      requiresApproval: false,
      note: "Verify manifest artifacts before creating an isolated restore target.",
    },
    {
      id: "restore.target",
      phase: "prepare",
      command: "createdb nexpress_restore_drill",
      required: true,
      requiresApproval: true,
      note: "Create an isolated database; never run restore drills against production.",
    },
    {
      id: "restore.database",
      phase: "restore",
      command: `pg_restore --dbname="$RESTORE_DATABASE_URL" --jobs=4 --no-owner --no-privileges ${database}`,
      required: true,
      requiresApproval: true,
      note: "Restore the database dump into the isolated target.",
    },
    {
      id: "restore.media",
      phase: "restore",
      command: `rsync -a --delete ${media}/ "$RESTORE_STORAGE_DIR"/`,
      required: Boolean(manifest.mediaPath),
      requiresApproval: Boolean(manifest.mediaPath),
      note: "Restore media that matches the database snapshot; adapt for S3 versioned restores.",
    },
    {
      id: "restore.smoke",
      phase: "verify",
      command: "SITE_URL=$RESTORE_SITE_URL nexpress ops health --url $RESTORE_SITE_URL --json",
      required: true,
      requiresApproval: false,
      note: "Run app health checks against the restored environment.",
    },
    {
      id: "restore.record",
      phase: "record",
      command: `nexpress ops backup create --database ${database} --restore-verified --json`,
      required: true,
      requiresApproval: false,
      note: "Record restore verification once the isolated drill passes.",
    },
  ]);
}

export async function collectOpsBackupRestorePlan(args: {
  env?: OpsBackupEnv;
  manifestId?: string | null;
}): Promise<OpsBackupRestorePlanJson> {
  const env = args.env ?? process.env;
  const collected = await collectBackupManifests(env);
  const checks: CheckResult[] = [...collected.checks];
  const selected = selectBackupManifest(collected.manifests, args.manifestId ?? "latest");
  const summary = selected ? manifestSummary(selected) : null;

  if (collected.manifests.length === 0) {
    checks.push({
      id: "backup.manifest",
      state: "error",
      label: "Backup manifests",
      detail: "none found",
      hint: "Create and verify a backup before restore planning.",
    });
  } else {
    checks.push({
      id: "backup.manifest",
      state: "ok",
      label: "Backup manifests",
      detail: `${collected.manifests.length.toString()} found`,
    });
  }

  if (!selected) {
    checks.push({
      id: "backup.restore_plan.selection",
      state: "error",
      label: "Restore-plan manifest",
      detail:
        args.manifestId && args.manifestId !== "latest"
          ? `manifest ${args.manifestId} was not found`
          : "no latest manifest",
    });
  } else {
    checks.push({
      id: "backup.restore_plan.selection",
      state: "ok",
      label: "Restore-plan manifest",
      detail: selected.id,
    });

    if (!summary?.verified) {
      checks.push({
        id: "backup.verified",
        state: "warn",
        label: "Backup verification",
        detail: "selected backup has not been verified",
        hint: "Run artifact verification before restore drills.",
      });
    }
    if (!summary?.restoreVerified) {
      checks.push({
        id: "backup.restore_verified",
        state: "warn",
        label: "Restore verification",
        detail: "selected backup has not passed restore verification",
      });
    }
    checks.push(
      await artifactCheck({
        backupDir: collected.backupDir,
        id: "backup.database_artifact",
        label: "Database artifact",
        path: summary?.databasePath ?? null,
        required: true,
      }),
    );
    checks.push(
      await artifactCheck({
        backupDir: collected.backupDir,
        id: "backup.media_artifact",
        label: "Media artifact",
        path: summary?.mediaPath ?? null,
        required: false,
      }),
    );
  }

  const counts = countChecks(checks);
  const status = counts.errors > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const steps = restorePlanSteps(summary);
  const firstApproval = steps.find((step) => step.requiresApproval);
  const nextCommand =
    status === "blocked"
      ? "nexpress ops backup status --required --json"
      : (firstApproval?.command ?? null);

  return {
    schemaVersion: "np.ops-backup-restore-plan.v1",
    ok: counts.errors === 0,
    status,
    backupDir: collected.backupDir,
    target: "isolated",
    manifestId: summary?.id ?? args.manifestId ?? null,
    summary: {
      manifests: collected.manifests.length,
      selected: Boolean(summary),
      verified: summary?.verified ?? false,
      restoreVerified: summary?.restoreVerified ?? false,
      databaseArtifact: Boolean(summary?.databasePath),
      mediaArtifact: Boolean(summary?.mediaPath),
      commands: steps.length,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    manifest: summary,
    checks,
    steps,
  };
}

function backupArtifactManifestPath(backupDir: string, input: string): string {
  const resolved = isAbsolute(input) ? resolve(input) : resolve(backupDir, input);
  const rel = relative(backupDir, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Backup artifact must be inside ${backupDir}: ${input}`);
  }
  return rel;
}

export async function createOpsBackupManifest(args: {
  env?: OpsBackupEnv;
  databasePath?: string | null;
  mediaPath?: string | null;
  verified?: boolean;
  restoreVerified?: boolean;
  now?: Date;
  id?: string;
}): Promise<OpsBackupJson> {
  const env = args.env ?? process.env;
  const backupDir = backupDirFromEnv(env);
  const now = args.now ?? new Date();
  const id =
    args.id ?? `backup-${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const createdAt = now.toISOString();
  const verified = Boolean(args.verified || args.restoreVerified);
  await mkdir(backupDir, { recursive: true });

  const manifest: BackupManifest = {
    id,
    createdAt,
    ...(args.databasePath
      ? { database: { path: backupArtifactManifestPath(backupDir, args.databasePath) } }
      : {}),
    ...(args.mediaPath
      ? { media: { path: backupArtifactManifestPath(backupDir, args.mediaPath) } }
      : {}),
    ...(verified || args.restoreVerified
      ? {
          verification: {
            ...(verified ? { verifiedAt: createdAt, status: "verified" } : {}),
            ...(args.restoreVerified ? { restoreVerifiedAt: createdAt } : {}),
          },
        }
      : {}),
  };

  await writeFile(join(backupDir, `${id}.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const report = await collectOpsBackupReport({ mode: "create", env });
  return {
    ...report,
    createdManifest: manifestSummary(manifest),
  };
}

function formatState(state: OpsBackupJson["status"], color: boolean): string {
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

export function renderBriefOpsBackupReport(
  report: OpsBackupJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const lines = [
    `${c.dim}NexPress ops backup ${report.mode}${c.reset}`,
    `${formatState(report.status, options.color)}: ${report.summary.manifests.toString()} manifests, latest ${report.summary.latestId ?? "none"}`,
  ];
  if (report.createdManifest) lines.push(`created: ${report.createdManifest.id}`);
  for (const check of report.checks) lines.push(formatCheck(check, options.color));
  if (report.manifests.length > 0) {
    lines.push("manifests:");
    for (const manifest of report.manifests.slice(0, 5)) {
      lines.push(
        `  - ${manifest.id} ${manifest.createdAt} verified=${String(manifest.verified)} restore=${String(manifest.restoreVerified)}`,
      );
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}

export function renderBriefOpsBackupRestorePlan(
  report: OpsBackupRestorePlanJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const lines = [
    `${c.dim}NexPress ops backup restore-plan${c.reset}`,
    `${formatState(report.status, options.color)}: manifest ${report.manifest?.id ?? "none"}, ${report.summary.commands.toString()} commands`,
    `target: ${report.target}`,
  ];
  for (const check of report.checks) lines.push(formatCheck(check, options.color));
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
