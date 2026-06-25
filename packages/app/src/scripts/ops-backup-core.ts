import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import type { Dirent, Stats } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { toProjectCommand } from "./ops-command-format.js";
import {
  buildOpsMutationAudit,
  defaultOpsArtifactPath,
  type OpsMutationAudit,
  writeOpsJsonArtifact,
} from "./ops-mutation.js";
import { resolveRuntimePath } from "./runtime-path.js";
import type { CheckResult } from "./doctor-readiness.js";

type OpsBackupEnv = Record<string, string | undefined>;
const execFileAsync = promisify(execFile);
// Backup commands inspect operator-owned runtime paths; keep those dynamic fs reads
// opaque to Next/Turbopack's standalone file tracer so it does not copy the project root.
const FS_METHODS = {
  access: "access",
  cp: "cp",
  mkdir: "mkdir",
  readdir: "readdir",
  readFile: "readFile",
  stat: "stat",
  writeFile: "writeFile",
} as const;

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
  backupRequired: boolean;
  verificationRequired: boolean;
  restoreDrillRecommended: boolean;
}

export interface OpsBackupAction {
  id:
    | "backup.record_manifest"
    | "backup.verify_artifacts"
    | "backup.record_verified_manifest"
    | "backup.restore_plan";
  phase: "record" | "verify" | "drill";
  command: string;
  projectCommand: string;
  required: boolean;
  requiresApproval: boolean;
  blockedBy: string[];
  note: string;
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
  plan: {
    nextCommands: string[];
    projectNextCommands: string[];
  };
  createdManifest?: BackupManifestSummary | null;
  manifests: BackupManifestSummary[];
  actions: OpsBackupAction[];
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
  plan: {
    nextCommands: string[];
    projectNextCommands: string[];
  };
  manifest: BackupManifestSummary | null;
  checks: CheckResult[];
  steps: OpsBackupRestorePlanStep[];
}

export interface OpsBackupRestoreApplyStep {
  id: string;
  status: "planned" | "completed" | "skipped" | "failed";
  detail: string | null;
}

export interface OpsBackupRestoreApplyJson {
  schemaVersion: "np.ops-backup-restore-apply.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  backupDir: string;
  target: "isolated";
  manifestId: string | null;
  summary: {
    selected: boolean;
    verified: boolean;
    restoreVerifiedBefore: boolean;
    databaseRestored: boolean;
    mediaRestored: boolean;
    manifestUpdated: boolean;
  };
  mutation: OpsMutationAudit;
  nextCommand: string | null;
  projectNextCommand: string | null;
  manifest: BackupManifestSummary | null;
  checks: CheckResult[];
  steps: OpsBackupRestoreApplyStep[];
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

function runtimeAccess(path: string): Promise<void> {
  const access = fsPromises[FS_METHODS.access] as (path: string) => Promise<void>;
  return access(path);
}

function runtimeCp(source: string, target: string): Promise<void> {
  const cp = fsPromises[FS_METHODS.cp] as (
    source: string,
    target: string,
    options: { recursive: true; force: true },
  ) => Promise<void>;
  return cp(source, target, { recursive: true, force: true });
}

function runtimeMkdir(path: string): Promise<string | undefined> {
  const mkdir = fsPromises[FS_METHODS.mkdir] as (
    path: string,
    options: { recursive: true },
  ) => Promise<string | undefined>;
  return mkdir(path, { recursive: true });
}

function runtimeReaddir(path: string): Promise<Dirent[]> {
  const readdir = fsPromises[FS_METHODS.readdir] as (
    path: string,
    options: { withFileTypes: true },
  ) => Promise<Dirent[]>;
  return readdir(path, { withFileTypes: true });
}

function runtimeReadTextFile(path: string): Promise<string> {
  const readFile = fsPromises[FS_METHODS.readFile] as (
    path: string,
    encoding: "utf8",
  ) => Promise<string>;
  return readFile(path, "utf8");
}

function runtimeStat(path: string): Promise<Stats> {
  const stat = fsPromises[FS_METHODS.stat] as (path: string) => Promise<Stats>;
  return stat(path);
}

function runtimeWriteTextFile(path: string, value: string): Promise<void> {
  const writeFile = fsPromises[FS_METHODS.writeFile] as (
    path: string,
    value: string,
    encoding: "utf8",
  ) => Promise<void>;
  return writeFile(path, value, "utf8");
}

function backupDirFromEnv(env: OpsBackupEnv): string {
  return resolveRuntimePath(env.NP_BACKUP_DIR ?? ".nexpress/backups");
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
  const entries = await runtimeReaddir(backupDir);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(/* turbopackIgnore: true */ backupDir, entry.name));
}

async function readManifestFile(file: string): Promise<BackupManifest | null> {
  try {
    const raw = await runtimeReadTextFile(file);
    return parseBackupManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await runtimeAccess(path);
    return true;
  } catch {
    return false;
  }
}

function resolveBackupArtifactPath(backupDir: string, path: string): string | null {
  const resolved = resolve(/* turbopackIgnore: true */ backupDir, path);
  const rel = relative(backupDir, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return resolved;
}

function withProjectCommand<T extends { command: string }>(
  action: T,
): T & { projectCommand: string } {
  return { ...action, projectCommand: toProjectCommand(action.command) };
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

function recordManifestCommand(latest: BackupManifestSummary | undefined): string {
  const database = latest?.databasePath ?? "artifacts/db.dump";
  const media = latest?.mediaPath ? ` --media ${latest.mediaPath}` : "";
  return `nexpress ops backup create --database ${database}${media} --verified --json`;
}

function verifyManifestCommand(manifest: BackupManifestSummary | undefined): string {
  return `nexpress ops backup verify ${manifest?.id ?? "latest"} --json`;
}

function buildOpsBackupActions(args: {
  required: boolean;
  latest: BackupManifestSummary | undefined;
  actionManifest: BackupManifestSummary | undefined;
  stale: boolean;
  checks: CheckResult[];
}): OpsBackupAction[] {
  const actions: OpsBackupAction[] = [];
  const needsBackup = !args.latest || args.stale;
  const needsVerification = Boolean(args.latest && !args.latest.verified);
  const verificationFailed = args.checks.some(
    (check) =>
      check.state === "error" &&
      (check.id === "backup.artifacts" || check.id === "backup.verify.selection"),
  );
  const recordCommand = recordManifestCommand(args.actionManifest);
  const verifyCommand = verifyManifestCommand(args.actionManifest);

  if (needsBackup) {
    actions.push(
      withProjectCommand({
        id: "backup.record_manifest",
        phase: "record",
        command: recordCommand,
        required: args.required,
        requiresApproval: false,
        blockedBy: [],
        note: "Capture a provider or pg_dump backup first, place artifacts under NP_BACKUP_DIR, then record the manifest.",
      }),
    );
  }

  if (needsBackup || needsVerification || verificationFailed) {
    actions.push(
      withProjectCommand({
        id: "backup.verify_artifacts",
        phase: "verify",
        command: verifyCommand,
        required: args.required || verificationFailed,
        requiresApproval: false,
        blockedBy: needsBackup ? ["backup.record_manifest"] : [],
        note: "Verify declared database and media artifacts exist before release promotion.",
      }),
    );
  }

  if (needsVerification) {
    actions.push(
      withProjectCommand({
        id: "backup.record_verified_manifest",
        phase: "record",
        command: recordCommand,
        required: args.required,
        requiresApproval: false,
        blockedBy: ["backup.verify_artifacts"],
        note: "After artifact verification passes, record a verified manifest for release gates.",
      }),
    );
  }

  if (args.latest && args.latest.verified && !args.latest.restoreVerified) {
    actions.push(
      withProjectCommand({
        id: "backup.restore_plan",
        phase: "drill",
        command: `nexpress ops backup restore-plan ${args.latest.id} --json`,
        required: false,
        requiresApproval: false,
        blockedBy: [],
        note: "Prepare an isolated restore drill so the backup is proven before an incident.",
      }),
    );
  }

  return actions;
}

function requiredActionCommands(actions: OpsBackupAction[]): string[] {
  return [...new Set(actions.filter((action) => action.required).map((action) => action.command))];
}

export function buildOpsBackupJson(args: {
  mode: OpsBackupMode;
  backupDir: string;
  required: boolean;
  maxAgeHours: number;
  manifests: BackupManifestSummary[];
  selectedManifest?: BackupManifestSummary | null;
  createdManifest?: BackupManifestSummary | null;
  checks?: CheckResult[];
}): OpsBackupJson {
  const manifests = [...args.manifests].sort(newestFirst);
  const latest = manifests[0];
  const actionManifest = args.selectedManifest ?? latest;
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
  const backupRequired = args.required && (!latest || stale);
  const verificationRequired = args.required && Boolean(latest && !latest.verified);
  const restoreDrillRecommended = Boolean(latest && latest.verified && !latest.restoreVerified);
  const actions = buildOpsBackupActions({
    required: args.required,
    latest,
    actionManifest,
    stale,
    checks,
  });
  const nextCommands = requiredActionCommands(actions);
  const nextCommand = status === "ready" ? null : (actions[0]?.command ?? null);
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
      backupRequired,
      verificationRequired,
      restoreDrillRecommended,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    plan: {
      nextCommands,
      projectNextCommands: nextCommands.map(toProjectCommand),
    },
    createdManifest: args.createdManifest ?? null,
    manifests,
    actions,
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
    const dirStat = await runtimeStat(backupDir);
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
    selectedManifest: args.mode === "verify" ? selectedSummary : null,
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
    const dirStat = await runtimeStat(backupDir);
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

async function findBackupManifestFile(
  backupDir: string,
  manifestId: string,
): Promise<{ manifest: BackupManifest; file: string } | null> {
  const files = await listManifestFiles(backupDir);
  for (const file of files) {
    const manifest = await readManifestFile(file);
    if (manifest?.id === manifestId) return { manifest, file };
  }
  return null;
}

async function markBackupRestoreVerified(args: {
  backupDir: string;
  manifestId: string;
  now: Date;
}): Promise<BackupManifestSummary | null> {
  const found = await findBackupManifestFile(args.backupDir, args.manifestId);
  if (!found) return null;
  const restoreVerifiedAt = args.now.toISOString();
  const manifest: BackupManifest = {
    ...found.manifest,
    verification: {
      ...(found.manifest.verification ?? {}),
      verifiedAt: found.manifest.verification?.verifiedAt ?? restoreVerifiedAt,
      restoreVerifiedAt,
      status: found.manifest.verification?.status ?? "verified",
    },
  };
  await runtimeWriteTextFile(found.file, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestSummary(manifest);
}

function restoreApplyNextCommand(manifestId: string | null): string {
  return `nexpress ops backup restore apply ${manifestId ?? "latest"} --execute --approve restore-apply --json`;
}

function normalizeDatabaseUrlForCompare(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const defaultPort =
      url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "";
    const port = url.port || defaultPort;
    return `${url.protocol}//${url.hostname}${port ? `:${port}` : ""}${url.pathname}`;
  } catch {
    return value.trim();
  }
}

function sameDatabaseTarget(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeDatabaseUrlForCompare(left);
  const b = normalizeDatabaseUrlForCompare(right);
  return Boolean(a && b && a === b);
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
  const nextCommands = steps.filter((step) => step.required).map((step) => step.command);

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
    plan: {
      nextCommands,
      projectNextCommands: nextCommands.map(toProjectCommand),
    },
    manifest: summary,
    checks,
    steps,
  };
}

function restoreApplyChecks(args: {
  plan: OpsBackupRestorePlanJson;
  env: OpsBackupEnv;
}): CheckResult[] {
  const checks = args.plan.checks.map((check) => {
    if (check.id === "backup.restore_verified" && check.state === "warn") {
      return {
        ...check,
        state: "ok" as const,
        detail: "restore apply will record restore verification on success",
        hint: undefined,
      };
    }
    if (
      check.id === "backup.media_artifact" &&
      check.state === "warn" &&
      args.plan.manifest &&
      !args.plan.manifest.mediaPath
    ) {
      return {
        ...check,
        state: "ok" as const,
        detail: "no media artifact recorded; media restore skipped",
        hint: undefined,
      };
    }
    return check;
  });
  const manifest = args.plan.manifest;
  if (manifest && !manifest.verified) {
    checks.push({
      id: "backup.restore_apply.verified",
      state: "error",
      label: "Restore apply verification gate",
      detail: "selected manifest is not artifact-verified",
      hint: "Run `nexpress ops backup verify <manifestId> --json` before restore apply.",
    });
  } else if (manifest) {
    checks.push({
      id: "backup.restore_apply.verified",
      state: "ok",
      label: "Restore apply verification gate",
      detail: manifest.id,
    });
  }

  const restoreDatabaseUrl = args.env.RESTORE_DATABASE_URL;
  if (!restoreDatabaseUrl) {
    checks.push({
      id: "backup.restore_apply.target_database",
      state: "error",
      label: "Isolated restore database",
      detail: "RESTORE_DATABASE_URL not set",
      hint: "Set RESTORE_DATABASE_URL to an isolated database before applying a restore drill.",
    });
  } else if (sameDatabaseTarget(restoreDatabaseUrl, args.env.DATABASE_URL)) {
    checks.push({
      id: "backup.restore_apply.target_database",
      state: "error",
      label: "Isolated restore database",
      detail: "RESTORE_DATABASE_URL matches DATABASE_URL",
      hint: "Never run restore apply against the production/application database.",
    });
  } else {
    checks.push({
      id: "backup.restore_apply.target_database",
      state: "ok",
      label: "Isolated restore database",
      detail: "RESTORE_DATABASE_URL",
    });
  }

  if (manifest?.mediaPath && !args.env.RESTORE_STORAGE_DIR) {
    checks.push({
      id: "backup.restore_apply.target_storage",
      state: "error",
      label: "Isolated restore storage",
      detail: "RESTORE_STORAGE_DIR not set",
      hint: "Set RESTORE_STORAGE_DIR to a scratch directory for matching media restore.",
    });
  } else if (manifest?.mediaPath) {
    checks.push({
      id: "backup.restore_apply.target_storage",
      state: "ok",
      label: "Isolated restore storage",
      detail: args.env.RESTORE_STORAGE_DIR,
    });
  }

  return checks;
}

function buildOpsBackupRestoreApplyJson(args: {
  plan: OpsBackupRestorePlanJson;
  checks: CheckResult[];
  execute?: boolean;
  approve?: string | null;
  artifactPath: string | null;
  startedAt: Date;
  steps: OpsBackupRestoreApplyStep[];
  databaseRestored?: boolean;
  mediaRestored?: boolean;
  manifestUpdated?: boolean;
  manifest?: BackupManifestSummary | null;
  error?: string | null;
  nextCommand?: string | null;
}): OpsBackupRestoreApplyJson {
  const counts = countChecks(args.checks);
  const status = counts.errors > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const manifest = args.manifest ?? args.plan.manifest;
  const nextCommand =
    args.nextCommand ??
    (args.execute && counts.errors === 0
      ? `nexpress ops backup verify ${manifest?.id ?? "latest"} --json`
      : restoreApplyNextCommand(args.plan.manifestId));
  return {
    schemaVersion: "np.ops-backup-restore-apply.v1",
    ok: counts.errors === 0,
    status,
    backupDir: args.plan.backupDir,
    target: "isolated",
    manifestId: manifest?.id ?? args.plan.manifestId,
    summary: {
      selected: Boolean(manifest),
      verified: manifest?.verified ?? false,
      restoreVerifiedBefore: args.plan.manifest?.restoreVerified ?? false,
      databaseRestored: Boolean(args.databaseRestored),
      mediaRestored: Boolean(args.mediaRestored),
      manifestUpdated: Boolean(args.manifestUpdated),
    },
    mutation: buildOpsMutationAudit({
      action: "backup.restore-apply",
      execute: args.execute,
      approve: args.approve,
      requiredApproval: "restore-apply",
      artifactPath: args.artifactPath,
      applied: Boolean(args.execute && args.manifestUpdated && counts.errors === 0),
      error: args.error ?? null,
      rollbackHint:
        "Restore apply only targets RESTORE_DATABASE_URL/RESTORE_STORAGE_DIR. Drop the isolated database or delete the scratch storage directory to clean up.",
      nextCommand,
      startedAt: args.startedAt,
      completedAt: new Date(),
    }),
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    manifest,
    checks: args.checks,
    steps: args.steps,
  };
}

async function copyRestoreMedia(args: {
  backupDir: string;
  mediaPath: string;
  restoreStorageDir: string;
}): Promise<string> {
  const source = resolveBackupArtifactPath(args.backupDir, args.mediaPath);
  if (!source) throw new Error(`Invalid media artifact path: ${args.mediaPath}`);
  const sourceStat = await runtimeStat(source);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Media artifact must be a directory for restore apply: ${args.mediaPath}`);
  }
  const target = resolve(/* turbopackIgnore: true */ args.restoreStorageDir, basename(source));
  await runtimeMkdir(args.restoreStorageDir);
  await runtimeCp(source, target);
  return target;
}

async function runPgRestore(args: { databaseUrl: string; databasePath: string }): Promise<void> {
  await execFileAsync("pg_restore", [
    "--dbname",
    args.databaseUrl,
    "--jobs",
    "4",
    "--no-owner",
    "--no-privileges",
    args.databasePath,
  ]);
}

export async function runOpsBackupRestoreApply(args: {
  manifestId?: string | null;
  execute?: boolean;
  approve?: string | null;
  out?: string | null;
  env?: OpsBackupEnv;
}): Promise<OpsBackupRestoreApplyJson> {
  const env = args.env ?? process.env;
  const startedAt = new Date();
  const manifestId = args.manifestId ?? "latest";
  const artifactPath =
    args.out ??
    (args.execute
      ? defaultOpsArtifactPath("restores", `restore-apply-${manifestId}`, startedAt)
      : null);
  const plan = await collectOpsBackupRestorePlan({ env, manifestId });
  const checks = restoreApplyChecks({ plan, env });
  const steps: OpsBackupRestoreApplyStep[] = [
    {
      id: "restore.database",
      status: "planned",
      detail: plan.manifest?.databasePath ?? null,
    },
    {
      id: "restore.media",
      status: plan.manifest?.mediaPath ? "planned" : "skipped",
      detail: plan.manifest?.mediaPath ?? "no media artifact recorded",
    },
    {
      id: "restore.record",
      status: "planned",
      detail: plan.manifest?.id ?? null,
    },
  ];

  if (!args.execute) {
    const report = buildOpsBackupRestoreApplyJson({
      plan,
      checks,
      execute: false,
      approve: args.approve,
      artifactPath,
      startedAt,
      steps,
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  }

  if (args.approve !== "restore-apply") {
    checks.push({
      id: "backup.restore_apply.approval",
      state: "error",
      label: "Restore apply approval",
      detail: "missing --approve restore-apply",
    });
    const report = buildOpsBackupRestoreApplyJson({
      plan,
      checks,
      execute: true,
      approve: args.approve,
      artifactPath,
      startedAt,
      steps,
      error: "Missing --approve restore-apply",
      nextCommand: restoreApplyNextCommand(plan.manifestId),
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  }

  if (countChecks(checks).errors > 0 || !plan.manifest?.databasePath) {
    const report = buildOpsBackupRestoreApplyJson({
      plan,
      checks,
      execute: true,
      approve: args.approve,
      artifactPath,
      startedAt,
      steps,
      error: "Restore apply gate is blocked",
      nextCommand: plan.nextCommand,
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  }

  let databaseRestored = false;
  let mediaRestored = false;
  let manifestUpdated = false;
  let updatedManifest: BackupManifestSummary | null = null;
  try {
    const databasePath = resolveBackupArtifactPath(plan.backupDir, plan.manifest.databasePath);
    if (!databasePath)
      throw new Error(`Invalid database artifact path: ${plan.manifest.databasePath}`);
    await runPgRestore({ databaseUrl: env.RESTORE_DATABASE_URL ?? "", databasePath });
    databaseRestored = true;
    steps[0] = { ...steps[0], status: "completed", detail: plan.manifest.databasePath };

    if (plan.manifest.mediaPath) {
      const restoredTo = await copyRestoreMedia({
        backupDir: plan.backupDir,
        mediaPath: plan.manifest.mediaPath,
        restoreStorageDir: env.RESTORE_STORAGE_DIR ?? "",
      });
      mediaRestored = true;
      steps[1] = { ...steps[1], status: "completed", detail: restoredTo };
    }

    updatedManifest = await markBackupRestoreVerified({
      backupDir: plan.backupDir,
      manifestId: plan.manifest.id,
      now: new Date(),
    });
    if (!updatedManifest) throw new Error(`Backup manifest not found: ${plan.manifest.id}`);
    manifestUpdated = true;
    steps[2] = { ...steps[2], status: "completed", detail: updatedManifest.id };

    const report = buildOpsBackupRestoreApplyJson({
      plan,
      checks: [
        ...checks,
        {
          id: "backup.restore_apply.result",
          state: "ok",
          label: "Restore apply result",
          detail: "isolated restore completed and manifest marked restore-verified",
        },
      ],
      execute: true,
      approve: args.approve,
      artifactPath,
      startedAt,
      steps,
      databaseRestored,
      mediaRestored,
      manifestUpdated,
      manifest: updatedManifest,
      nextCommand: `nexpress ops backup verify ${updatedManifest.id} --json`,
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failedStepIndex = steps.findIndex((step) => step.status === "planned");
    if (failedStepIndex >= 0) {
      steps[failedStepIndex] = { ...steps[failedStepIndex], status: "failed", detail };
    }
    const report = buildOpsBackupRestoreApplyJson({
      plan,
      checks: [
        ...checks,
        {
          id: "backup.restore_apply.result",
          state: "error",
          label: "Restore apply result",
          detail,
        },
      ],
      execute: true,
      approve: args.approve,
      artifactPath,
      startedAt,
      steps,
      databaseRestored,
      mediaRestored,
      manifestUpdated,
      manifest: updatedManifest,
      error: detail,
      nextCommand: "nexpress ops backup restore-plan latest --json",
    });
    if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
    return report;
  }
}

function backupArtifactManifestPath(backupDir: string, input: string): string {
  const resolved = isAbsolute(input)
    ? resolve(/* turbopackIgnore: true */ input)
    : resolve(/* turbopackIgnore: true */ backupDir, input);
  const rel = relative(backupDir, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Backup artifact must be inside ${backupDir}: ${input}`);
  }
  return rel;
}

async function checkedBackupArtifactManifestPath(
  backupDir: string,
  input: string,
): Promise<string> {
  const rel = backupArtifactManifestPath(backupDir, input);
  const artifactPath = resolve(/* turbopackIgnore: true */ backupDir, rel);
  if (!(await pathExists(artifactPath))) {
    throw new Error(`Backup artifact does not exist inside ${backupDir}: ${rel}`);
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
  await runtimeMkdir(backupDir);

  const manifest: BackupManifest = {
    id,
    createdAt,
    ...(args.databasePath
      ? {
          database: {
            path: await checkedBackupArtifactManifestPath(backupDir, args.databasePath),
          },
        }
      : {}),
    ...(args.mediaPath
      ? { media: { path: await checkedBackupArtifactManifestPath(backupDir, args.mediaPath) } }
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

  await runtimeWriteTextFile(
    join(/* turbopackIgnore: true */ backupDir, `${id}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
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
  if (report.actions.length > 0) {
    lines.push("actions:");
    for (const action of report.actions) {
      const required = action.required ? " required" : "";
      lines.push(`  - [${action.phase}${required}] ${action.command}`);
      lines.push(`    note: ${action.note}`);
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
      lines.push(`    note: ${step.note}`);
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}

export function renderBriefOpsBackupRestoreApply(
  report: OpsBackupRestoreApplyJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const lines = [
    `${c.dim}NexPress ops backup restore apply${c.reset}`,
    `${formatState(report.status, options.color)}: manifest ${report.manifest?.id ?? "none"}`,
    `target: ${report.target}`,
  ];
  for (const check of report.checks) lines.push(formatCheck(check, options.color));
  if (report.steps.length > 0) {
    lines.push("steps:");
    for (const step of report.steps) {
      const detail = step.detail ? ` - ${step.detail.replace(/\s+/g, " ")}` : "";
      lines.push(`  - [${step.status}] ${step.id}${detail}`);
    }
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
