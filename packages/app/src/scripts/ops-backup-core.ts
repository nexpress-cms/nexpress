import { access, readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { CheckResult } from "./doctor-readiness.js";

type OpsBackupEnv = Record<string, string | undefined>;

export type OpsBackupMode = "status" | "list" | "verify";

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
  manifests: BackupManifestSummary[];
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
    nextCommand:
      status === "ready"
        ? null
        : args.mode === "verify"
          ? "nexpress ops backup verify latest --json"
          : "nexpress ops backup status --required --json",
    manifests,
    checks,
  };
}

export async function collectOpsBackupReport(args: {
  mode: OpsBackupMode;
  required?: boolean;
  env?: OpsBackupEnv;
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
  const latest = summaries.sort(newestFirst)[0];
  if (args.mode === "verify" && latest) {
    const missing: string[] = [];
    if (latest.databasePath) {
      const databasePath = resolveBackupArtifactPath(backupDir, latest.databasePath);
      if (!databasePath || !(await pathExists(databasePath))) missing.push(latest.databasePath);
    }
    if (latest.mediaPath) {
      const mediaPath = resolveBackupArtifactPath(backupDir, latest.mediaPath);
      if (!mediaPath || !(await pathExists(mediaPath))) missing.push(latest.mediaPath);
    }
    if (missing.length > 0) {
      checks.push({
        id: "backup.artifacts",
        state: "error",
        label: "Backup artifacts",
        detail: `missing ${missing.join(", ")}`,
        hint: "Restore or recreate the missing backup artifacts before relying on this manifest.",
      });
    } else if (latest.databasePath || latest.mediaPath) {
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
  return lines.join("\n");
}
