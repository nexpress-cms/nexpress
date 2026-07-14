import { access, readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { npValidateMediaVariants, type NpMediaVariants } from "@nexpress/core/media-contract";
import {
  createStorageAdapter,
  npCloseStorageAdapter,
  npDeleteStorageObject,
  npReadStorageRuntimeConfig,
  npRequireStorageRuntimeConfig,
  npRequireStorageKey,
  npStorageObjectExists,
  npUploadStorageObject,
} from "@nexpress/core/storage";
import pg from "pg";

import { toProjectCommand } from "./ops-command-format.js";
import {
  buildOpsMutationAudit,
  defaultOpsArtifactPath,
  type OpsMutationAudit,
  writeOpsJsonArtifact,
} from "./ops-mutation.js";
import type { CheckResult } from "./doctor-readiness.js";

type OpsStorageEnv = Record<string, string | undefined>;

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

interface MediaRow {
  storage_key: string;
  sizes: unknown;
  original_filename: string;
  mime_type: string;
  filesize: number | string;
}

export interface OpsStorageDriftItem {
  key: string;
  kind: "missing" | "orphaned";
  path: string | null;
}

export interface OpsStorageSummary {
  mediaRows: number;
  indexedObjects: number;
  localFiles: number | null;
  missingFiles: number;
  orphanedFiles: number;
}

export interface OpsStorageDriftListJson {
  schemaVersion: "np.ops-storage-list.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  adapter: "local" | "s3" | "custom" | "unknown";
  operation: "missing-files" | "orphaned-files";
  summary: OpsStorageSummary & {
    total: number;
    returned: number;
    limit: number;
    truncated: boolean;
    invalidStorageKeys: number;
  };
  nextCommand: string | null;
  projectNextCommand: string | null;
  checks: CheckResult[];
  items: OpsStorageDriftItem[];
}

export interface OpsStorageMigrationPlanJson {
  schemaVersion: "np.ops-storage-migration-plan.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  source: "local";
  target: string;
  summary: OpsStorageSummary & {
    copyCandidates: number;
    invalidStorageKeys: number;
  };
  nextCommand: string | null;
  projectNextCommand: string | null;
  checks: CheckResult[];
  commands: Array<{
    phase: "inspect" | "prepare" | "apply";
    command: string;
    projectCommand: string;
    required: boolean;
    requiresApproval: boolean;
  }>;
}

export interface OpsStorageMigrationApplyItem {
  key: string;
  status: "planned" | "copied" | "failed";
  bytes: number | null;
  error: string | null;
}

export interface OpsStorageMigrationApplyJson {
  schemaVersion: "np.ops-storage-migration-apply.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  source: "local";
  target: string;
  summary: OpsStorageSummary & {
    planned: number;
    copied: number;
    failed: number;
    returned: number;
    truncated: boolean;
    invalidStorageKeys: number;
  };
  mutation: OpsMutationAudit;
  nextCommand: string | null;
  projectNextCommand: string | null;
  checks: CheckResult[];
  items: OpsStorageMigrationApplyItem[];
}

export interface OpsStorageJson {
  schemaVersion: "np.ops-storage.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  adapter: "local" | "s3" | "custom" | "unknown";
  operation: "status" | "verify" | "test";
  mutation?: {
    action: "test";
    applied: boolean;
    mode: "dry-run" | "execute";
    error: string | null;
    result?: Record<string, string | boolean | null>;
  } | null;
  summary: OpsStorageSummary;
  nextCommand: string | null;
  projectNextCommand: string | null;
  checks: CheckResult[];
}

interface LocalStorageInventory {
  adapter: OpsStorageJson["adapter"];
  root: string;
  summary: OpsStorageSummary;
  checks: CheckResult[];
  indexed: Set<string>;
  files: string[];
  missing: OpsStorageDriftItem[];
  orphaned: OpsStorageDriftItem[];
  invalidStorageKeys: number;
  metadata: Map<string, StorageObjectMetadata>;
}

interface StorageObjectMetadata {
  contentType: string;
  contentLength: number | null;
  originalFilename: string;
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

function loadPg(): PgModuleLike {
  return { default: pg as unknown as PgModuleLike["default"] };
}

function parseAdapter(env: OpsStorageEnv): OpsStorageJson["adapter"] {
  try {
    return npReadStorageRuntimeConfig(env).adapter;
  } catch {
    return "unknown";
  }
}

function countChecks(checks: CheckResult[]): { errors: number; warnings: number } {
  return {
    errors: checks.filter((check) => check.state === "error").length,
    warnings: checks.filter((check) => check.state === "warn").length,
  };
}

function collectSizeStorageKeys(value: unknown): string[] {
  const variants = asCanonicalMediaVariants(value);
  return variants ? Object.values(variants).map((variant) => variant.storageKey) : [];
}

function collectSizeStorageMetadata(
  value: unknown,
): Array<{ key: string; metadata: StorageObjectMetadata }> {
  const variants = asCanonicalMediaVariants(value);
  if (!variants) return [];
  return Object.values(variants).map((variant) => ({
    key: variant.storageKey,
    metadata: {
      contentType: variant.mimeType,
      contentLength: variant.filesize,
      originalFilename: variant.filename,
    },
  }));
}

function asCanonicalMediaVariants(value: unknown): NpMediaVariants | null {
  if (value === null) return null;
  const validation = npValidateMediaVariants(value);
  return validation.ok ? (value as NpMediaVariants) : null;
}

function appendMediaContractCheck(rows: MediaRow[], checks: CheckResult[]): void {
  const invalid = rows.filter(
    (row) => row.sizes !== null && !npValidateMediaVariants(row.sizes).ok,
  ).length;
  checks.push({
    id: "storage.media_contract",
    state: invalid === 0 ? "ok" : "error",
    label: "Media variant metadata",
    detail:
      invalid === 0
        ? "all persisted variant maps match the canonical media contract"
        : `${invalid.toString()} media row(s) have malformed variant metadata`,
  });
}

function parseContentLength(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readMediaRows(
  env: OpsStorageEnv,
): Promise<
  | { ok: true; rows: MediaRow[] }
  | { ok: false; reason: "missing-url" | "pg-unavailable" | "query-failed" }
> {
  const url = env.DATABASE_URL;
  if (!url) return { ok: false, reason: "missing-url" };

  let pg: PgModuleLike;
  try {
    pg = loadPg();
  } catch {
    return { ok: false, reason: "pg-unavailable" };
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const result = await client.query<MediaRow>(
      `select storage_key, sizes, original_filename, mime_type, filesize
         from np_media
        where deleted_at is null`,
    );
    await client.end();
    return { ok: true, rows: result.rows };
  } catch {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return { ok: false, reason: "query-failed" };
  }
}

async function listFilesRecursive(root: string, current = root): Promise<string[]> {
  const entries = await readdir(/* turbopackIgnore: true */ current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(/* turbopackIgnore: true */ current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(root, full)));
    } else if (entry.isFile()) {
      files.push(relative(root, full).split(sep).join("/"));
    }
  }
  return files;
}

async function existsAt(path: string): Promise<boolean> {
  try {
    await access(/* turbopackIgnore: true */ path);
    return true;
  } catch {
    return false;
  }
}

function resolveStorageKey(root: string, key: string): string | null {
  let validated: string;
  try {
    validated = npRequireStorageKey(key);
  } catch {
    return null;
  }
  const full = resolve(/* turbopackIgnore: true */ root, validated);
  const rel = relative(root, full);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return full;
}

function emptySummary(): OpsStorageSummary {
  return {
    mediaRows: 0,
    indexedObjects: 0,
    localFiles: null,
    missingFiles: 0,
    orphanedFiles: 0,
  };
}

function limitItems<T>(items: T[], limit: number): { returned: T[]; truncated: boolean } {
  return { returned: items.slice(0, limit), truncated: items.length > limit };
}

function normalizeLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) return 100;
  return Math.min(Math.floor(value), 1_000);
}

async function collectLocalStorageInventory(
  env: OpsStorageEnv = process.env,
): Promise<LocalStorageInventory> {
  const adapter = parseAdapter(env);
  const checks: CheckResult[] = [];
  const summary = emptySummary();
  const indexed = new Set<string>();
  const metadata = new Map<string, StorageObjectMetadata>();
  const root = resolve(
    /* turbopackIgnore: true */ process.cwd(),
    env.NP_STORAGE_DIR ?? "./public/media",
  );
  let files: string[] = [];
  let localDirectoryReady = false;
  let invalidStorageKeys = 0;

  if (adapter !== "local") {
    checks.push({
      id: "storage.local_source",
      state: "error",
      label: "Local storage source",
      detail:
        adapter === "s3"
          ? "active adapter is s3"
          : adapter === "custom"
            ? "active adapter is custom"
            : "invalid adapter configuration",
      hint: "Set NP_STORAGE_ADAPTER=local when inspecting local media drift.",
    });
    return {
      adapter,
      root,
      summary,
      checks,
      indexed,
      files,
      missing: [],
      orphaned: [],
      invalidStorageKeys,
      metadata,
    };
  }

  checks.push({ id: "storage.adapter", state: "ok", label: "Storage adapter", detail: "local" });

  try {
    const storageStat = await stat(/* turbopackIgnore: true */ root);
    if (storageStat.isDirectory()) {
      localDirectoryReady = true;
      checks.push({
        id: "storage.local_directory",
        state: "ok",
        label: "Local storage directory",
        detail: root,
      });
    } else {
      checks.push({
        id: "storage.local_directory",
        state: "error",
        label: "Local storage directory",
        detail: `${root} is not a directory`,
      });
    }
  } catch (error) {
    checks.push({
      id: "storage.local_directory",
      state: isMissingPathError(error) ? "warn" : "error",
      label: "Local storage directory",
      detail: isMissingPathError(error)
        ? `${root} does not exist yet`
        : error instanceof Error
          ? error.message
          : String(error),
    });
  }

  const media = await readMediaRows(env);
  if (!media.ok) {
    checks.push({
      id: "storage.media_index",
      state: "warn",
      label: "Media database index",
      detail:
        media.reason === "missing-url"
          ? "DATABASE_URL not set"
          : media.reason === "pg-unavailable"
            ? "pg package unavailable"
            : "could not query np_media",
    });
    return {
      adapter,
      root,
      summary,
      checks,
      indexed,
      files,
      missing: [],
      orphaned: [],
      invalidStorageKeys,
      metadata,
    };
  }

  for (const row of media.rows) {
    indexed.add(row.storage_key);
    metadata.set(row.storage_key, {
      contentType: row.mime_type,
      contentLength: parseContentLength(row.filesize),
      originalFilename: row.original_filename,
    });
    for (const key of collectSizeStorageKeys(row.sizes)) indexed.add(key);
    for (const item of collectSizeStorageMetadata(row.sizes)) metadata.set(item.key, item.metadata);
  }
  summary.mediaRows = media.rows.length;
  summary.indexedObjects = indexed.size;
  checks.push({
    id: "storage.media_index",
    state: "ok",
    label: "Media database index",
    detail: `${summary.mediaRows.toString()} rows, ${summary.indexedObjects.toString()} objects`,
  });
  appendMediaContractCheck(media.rows, checks);

  const missing: OpsStorageDriftItem[] = [];
  if (localDirectoryReady) {
    for (const key of indexed) {
      const full = resolveStorageKey(root, key);
      if (!full) {
        invalidStorageKeys += 1;
        continue;
      }
      if (!(await existsAt(full))) {
        missing.push({ key, kind: "missing", path: full });
      }
    }
    files = await listFilesRecursive(/* turbopackIgnore: true */ root);
    summary.localFiles = files.length;
  }
  const orphaned = files
    .filter((file) => !indexed.has(file))
    .map<OpsStorageDriftItem>((file) => ({
      key: file,
      kind: "orphaned",
      path: resolve(/* turbopackIgnore: true */ root, file),
    }));
  summary.missingFiles = missing.length;
  summary.orphanedFiles = orphaned.length;

  if (invalidStorageKeys > 0) {
    checks.push({
      id: "storage.local_keys",
      state: "warn",
      label: "Local media keys",
      detail: `${invalidStorageKeys.toString()} indexed keys violate the canonical storage-key contract`,
      hint: "Repair np_media.storage_key values before trusting local media drift counts.",
    });
  }
  const drift = summary.missingFiles + summary.orphanedFiles;
  if (localDirectoryReady && media.ok) {
    checks.push(
      drift === 0
        ? {
            id: "storage.local_integrity",
            state: "ok",
            label: "Local media files",
            detail: `${files.length.toString()} files match the media index`,
          }
        : {
            id: "storage.local_integrity",
            state: "warn",
            label: "Local media files",
            detail: `${summary.missingFiles.toString()} missing, ${summary.orphanedFiles.toString()} orphaned`,
            hint: "Inspect the media table and storage directory before deleting or re-uploading assets.",
          },
    );
  }

  return {
    adapter,
    root,
    summary,
    checks,
    indexed,
    files,
    missing,
    orphaned,
    invalidStorageKeys,
    metadata,
  };
}

export function buildOpsStorageJson(args: {
  adapter: OpsStorageJson["adapter"];
  summary: OpsStorageSummary;
  checks: CheckResult[];
  operation?: OpsStorageJson["operation"];
  mutation?: OpsStorageJson["mutation"];
}): OpsStorageJson {
  const counts = countChecks(args.checks);
  const status = counts.errors > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const nextCommand =
    status === "ready"
      ? null
      : status === "attention"
        ? args.operation === "verify"
          ? "nexpress ops storage test --json"
          : "nexpress ops storage verify --json"
        : "nexpress ops storage status --json";
  return {
    schemaVersion: "np.ops-storage.v1",
    ok: counts.errors === 0,
    status,
    adapter: args.adapter,
    operation: args.operation ?? "status",
    mutation: args.mutation ?? null,
    summary: args.summary,
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    checks: args.checks,
  };
}

export async function collectOpsStorageStatus(
  env: OpsStorageEnv = process.env,
  operation: OpsStorageJson["operation"] = "status",
): Promise<OpsStorageJson> {
  const adapter = parseAdapter(env);
  const checks: CheckResult[] = [];
  const summary = emptySummary();

  if (adapter === "unknown") {
    let detail = env.NP_STORAGE_ADAPTER ?? "unknown";
    try {
      npReadStorageRuntimeConfig(env);
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    checks.push({
      id: "storage.contract",
      state: "error",
      label: "Storage runtime contract",
      detail,
      hint: "Use exact local, s3, or custom storage intent and satisfy its settings.",
    });
    return buildOpsStorageJson({ adapter, summary, checks, operation });
  }

  if (adapter === "custom") {
    checks.push({
      id: "storage.adapter",
      state: "error",
      label: "Storage adapter",
      detail: "custom adapters are installed by the app runtime, not the standalone ops process",
      hint: "Run provider-native checks or expose the adapter to a project-owned ops command.",
    });
    return buildOpsStorageJson({ adapter, summary, checks, operation });
  }

  checks.push({ id: "storage.adapter", state: "ok", label: "Storage adapter", detail: adapter });

  if (adapter === "s3") {
    checks.push({ id: "storage.s3_config", state: "ok", label: "S3 storage config" });
  }

  const root = resolve(
    /* turbopackIgnore: true */ process.cwd(),
    env.NP_STORAGE_DIR ?? "./public/media",
  );
  let localDirectoryReady = adapter !== "local";
  if (adapter === "local") {
    try {
      const storageStat = await stat(/* turbopackIgnore: true */ root);
      if (storageStat.isDirectory()) {
        localDirectoryReady = true;
        checks.push({
          id: "storage.local_directory",
          state: "ok",
          label: "Local storage directory",
          detail: root,
        });
      } else {
        checks.push({
          id: "storage.local_directory",
          state: "error",
          label: "Local storage directory",
          detail: `${root} is not a directory`,
        });
      }
    } catch (error) {
      checks.push({
        id: "storage.local_directory",
        state: isMissingPathError(error) ? "warn" : "error",
        label: "Local storage directory",
        detail: isMissingPathError(error)
          ? `${root} does not exist yet`
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  const media = await readMediaRows(env);
  if (!media.ok) {
    checks.push({
      id: "storage.media_index",
      state: "warn",
      label: "Media database index",
      detail:
        media.reason === "missing-url"
          ? "DATABASE_URL not set"
          : media.reason === "pg-unavailable"
            ? "pg package unavailable"
            : "could not query np_media",
    });
    return buildOpsStorageJson({ adapter, summary, checks, operation });
  }

  const indexed = new Set<string>();
  for (const row of media.rows) {
    indexed.add(row.storage_key);
    for (const key of collectSizeStorageKeys(row.sizes)) indexed.add(key);
  }
  summary.mediaRows = media.rows.length;
  summary.indexedObjects = indexed.size;
  checks.push({
    id: "storage.media_index",
    state: "ok",
    label: "Media database index",
    detail: `${summary.mediaRows.toString()} rows, ${summary.indexedObjects.toString()} objects`,
  });
  appendMediaContractCheck(media.rows, checks);

  if (adapter === "local" && localDirectoryReady) {
    let invalidStorageKeys = 0;
    for (const key of indexed) {
      const full = resolveStorageKey(root, key);
      if (!full) {
        invalidStorageKeys += 1;
        continue;
      }
      if (!(await existsAt(full))) summary.missingFiles += 1;
    }
    const files = await listFilesRecursive(/* turbopackIgnore: true */ root);
    summary.localFiles = files.length;
    summary.orphanedFiles = files.filter((file) => !indexed.has(file)).length;
    if (invalidStorageKeys > 0) {
      checks.push({
        id: "storage.local_keys",
        state: "warn",
        label: "Local media keys",
        detail: `${invalidStorageKeys.toString()} indexed keys resolve outside the storage directory`,
        hint: "Review np_media.storage_key values before trusting local media drift counts.",
      });
    }
    const drift = summary.missingFiles + summary.orphanedFiles;
    checks.push(
      drift === 0
        ? {
            id: "storage.local_integrity",
            state: "ok",
            label: "Local media files",
            detail: `${files.length.toString()} files match the media index`,
          }
        : {
            id: "storage.local_integrity",
            state: "warn",
            label: "Local media files",
            detail: `${summary.missingFiles.toString()} missing, ${summary.orphanedFiles.toString()} orphaned`,
            hint: "Inspect the media table and storage directory before deleting or re-uploading assets.",
          },
    );
  }

  return buildOpsStorageJson({ adapter, summary, checks, operation });
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function collectOpsStorageDriftList(args: {
  operation: "missing-files" | "orphaned-files";
  limit?: number;
  env?: OpsStorageEnv;
}): Promise<OpsStorageDriftListJson> {
  const limit = normalizeLimit(args.limit);
  const inventory = await collectLocalStorageInventory(args.env ?? process.env);
  const items = args.operation === "missing-files" ? inventory.missing : inventory.orphaned;
  const limited = limitItems(items, limit);
  const counts = countChecks(inventory.checks);
  const status =
    counts.errors > 0 ? "blocked" : items.length > 0 || counts.warnings > 0 ? "attention" : "ready";
  const nextCommand =
    status === "ready"
      ? null
      : args.operation === "missing-files"
        ? "nexpress ops storage orphaned-files --json"
        : "nexpress ops storage migrate plan --target s3 --json";
  return {
    schemaVersion: "np.ops-storage-list.v1",
    ok: counts.errors === 0,
    status,
    adapter: inventory.adapter,
    operation: args.operation,
    summary: {
      ...inventory.summary,
      total: items.length,
      returned: limited.returned.length,
      limit,
      truncated: limited.truncated,
      invalidStorageKeys: inventory.invalidStorageKeys,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    checks: inventory.checks,
    items: limited.returned,
  };
}

export async function buildOpsStorageMigrationPlan(args: {
  target?: string | null;
  env?: OpsStorageEnv;
}): Promise<OpsStorageMigrationPlanJson> {
  const env = args.env ?? process.env;
  const inventory = await collectLocalStorageInventory(env);
  const checks = [...inventory.checks];
  const target = args.target ?? "s3";
  if (target !== "s3") {
    checks.push({
      id: "storage.migration_target",
      state: "error",
      label: "Storage migration target",
      detail: String(target),
      hint: "Only --target s3 is supported by the read-only migration plan.",
    });
  } else {
    try {
      npRequireStorageRuntimeConfig(buildStorageConfig(env, "s3"));
      checks.push({ id: "storage.s3_config", state: "ok", label: "S3 storage config" });
    } catch (error) {
      checks.push({
        id: "storage.s3_config",
        state: "error",
        label: "S3 storage config",
        detail: error instanceof Error ? error.message : String(error),
        hint: "Fix the exact S3 bucket, region, and optional endpoint before planning migration.",
      });
    }
  }
  if (inventory.summary.missingFiles > 0) {
    checks.push({
      id: "storage.migration_missing_files",
      state: "error",
      label: "Migration source files",
      detail: `${inventory.summary.missingFiles.toString()} indexed local files are missing`,
      hint: "Run `nexpress ops storage missing-files --json` and restore missing files before migration.",
    });
  }
  if (inventory.summary.orphanedFiles > 0) {
    checks.push({
      id: "storage.migration_orphaned_files",
      state: "warn",
      label: "Orphaned local files",
      detail: `${inventory.summary.orphanedFiles.toString()} local files are not referenced by np_media`,
      hint: "Run `nexpress ops storage orphaned-files --json` before deciding whether to keep or archive them.",
    });
  }
  const counts = countChecks(checks);
  const status = counts.errors > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const copyCandidates = Math.max(
    0,
    inventory.summary.indexedObjects -
      inventory.summary.missingFiles -
      inventory.invalidStorageKeys,
  );
  const nextCommand =
    status === "ready"
      ? "nexpress ops storage test --json"
      : (checks
          .find((check) => check.state === "error" && check.hint)
          ?.hint?.match(/`([^`]+)`/)?.[1] ?? "nexpress ops storage verify --json");
  const commands = [
    {
      phase: "inspect" as const,
      command: "nexpress ops storage missing-files --json",
      required: inventory.summary.missingFiles > 0,
      requiresApproval: false,
    },
    {
      phase: "inspect" as const,
      command: "nexpress ops storage orphaned-files --json",
      required: inventory.summary.orphanedFiles > 0,
      requiresApproval: false,
    },
    {
      phase: "prepare" as const,
      command: "nexpress ops storage test --json",
      required: true,
      requiresApproval: false,
    },
    {
      phase: "apply" as const,
      command: "nexpress ops storage migrate apply --target s3 --execute --approve storage-migrate",
      required: true,
      requiresApproval: true,
    },
  ].map((command) => ({ ...command, projectCommand: toProjectCommand(command.command) }));
  return {
    schemaVersion: "np.ops-storage-migration-plan.v1",
    ok: counts.errors === 0,
    status,
    source: "local",
    target,
    summary: {
      ...inventory.summary,
      copyCandidates,
      invalidStorageKeys: inventory.invalidStorageKeys,
    },
    nextCommand,
    projectNextCommand: toProjectCommand(nextCommand),
    checks,
    commands,
  };
}

function migrationApplyNextCommand(target = "s3"): string {
  return `nexpress ops storage migrate apply --target ${target} --execute --approve storage-migrate --json`;
}

function copyItemLimit<T>(items: T[]): { returned: T[]; truncated: boolean } {
  return { returned: items.slice(0, 100), truncated: items.length > 100 };
}

export async function runOpsStorageMigrationApply(args: {
  target?: string | null;
  execute?: boolean;
  approve?: string | null;
  out?: string | null;
  env?: OpsStorageEnv;
}): Promise<OpsStorageMigrationApplyJson> {
  const env = args.env ?? process.env;
  const target = args.target ?? "s3";
  const startedAt = new Date();
  const artifactPath =
    args.out ??
    (args.execute ? defaultOpsArtifactPath("storage", "storage-migrate", startedAt) : null);
  const inventory = await collectLocalStorageInventory(env);
  const plan = await buildOpsStorageMigrationPlan({ target, env });
  const checks = [...plan.checks];
  const plannedKeys = [...inventory.indexed].sort();
  const nextCommand = migrationApplyNextCommand(target);

  if (target !== "s3") {
    const report = buildStorageMigrationApplyReport({
      inventory,
      target,
      checks,
      items: [],
      startedAt,
      artifactPath,
      execute: args.execute,
      approve: args.approve,
      error: `Unsupported target ${target}`,
      nextCommand: "nexpress ops storage migrate plan --target s3 --json",
    });
    await maybeWriteStorageApplyArtifact(report, artifactPath);
    return report;
  }

  if (!args.execute) {
    const planned = plannedKeys.map<OpsStorageMigrationApplyItem>((key) => {
      const metadata = inventory.metadata.get(key);
      return {
        key,
        status: "planned",
        bytes: metadata?.contentLength ?? null,
        error: null,
      };
    });
    const report = buildStorageMigrationApplyReport({
      inventory,
      target,
      checks,
      items: planned,
      startedAt,
      artifactPath,
      execute: false,
      approve: args.approve,
      nextCommand,
    });
    await maybeWriteStorageApplyArtifact(report, artifactPath);
    return report;
  }

  if (
    !inventory.checks.some((check) => check.id === "storage.media_index" && check.state === "ok")
  ) {
    checks.push({
      id: "storage.migration_apply.media_index",
      state: "error",
      label: "Storage migration media index",
      detail: "np_media index is not readable",
      hint: "Set DATABASE_URL and re-run storage migrate apply after the media index is readable.",
    });
  }
  if (
    !inventory.checks.some(
      (check) => check.id === "storage.local_directory" && check.state === "ok",
    )
  ) {
    checks.push({
      id: "storage.migration_apply.local_source",
      state: "error",
      label: "Storage migration local source",
      detail: "local storage directory is not ready",
      hint: "Restore or configure the local storage directory before copying objects to S3.",
    });
  }

  if (args.approve !== "storage-migrate") {
    checks.push({
      id: "storage.migration_apply.approval",
      state: "error",
      label: "Storage migration approval",
      detail: "missing --approve storage-migrate",
    });
    const report = buildStorageMigrationApplyReport({
      inventory,
      target,
      checks,
      items: [],
      startedAt,
      artifactPath,
      execute: true,
      approve: args.approve,
      error: "Missing --approve storage-migrate",
      nextCommand,
    });
    await maybeWriteStorageApplyArtifact(report, artifactPath);
    return report;
  }

  if (countChecks(checks).errors > 0) {
    const report = buildStorageMigrationApplyReport({
      inventory,
      target,
      checks,
      items: [],
      startedAt,
      artifactPath,
      execute: true,
      approve: args.approve,
      error: "Storage migration apply gate is blocked",
      nextCommand: plan.nextCommand,
    });
    await maybeWriteStorageApplyArtifact(report, artifactPath);
    return report;
  }

  const targetStorage = createStorageAdapter(buildStorageConfig(env, "s3"));
  const items: OpsStorageMigrationApplyItem[] = [];
  for (const key of plannedKeys) {
    const full = resolveStorageKey(inventory.root, key);
    if (!full) {
      items.push({
        key,
        status: "failed",
        bytes: null,
        error: "Key violates the canonical storage-key or local-root contract",
      });
      continue;
    }
    try {
      const [buffer, fileStat] = await Promise.all([
        readFile(/* turbopackIgnore: true */ full),
        stat(/* turbopackIgnore: true */ full),
      ]);
      const metadata = inventory.metadata.get(key);
      await npUploadStorageObject(targetStorage, key, buffer, {
        contentType: metadata?.contentType ?? "application/octet-stream",
        contentLength: fileStat.size,
        originalFilename: metadata?.originalFilename ?? key.split("/").pop() ?? key,
      });
      const exists = await npStorageObjectExists(targetStorage, key);
      items.push({
        key,
        status: exists ? "copied" : "failed",
        bytes: fileStat.size,
        error: exists ? null : "Target object did not become readable",
      });
    } catch (error) {
      items.push({
        key,
        status: "failed",
        bytes: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  let shutdownError: string | null = null;
  try {
    await npCloseStorageAdapter(targetStorage);
  } catch (error) {
    shutdownError = error instanceof Error ? error.message : String(error);
    checks.push({
      id: "storage.migration_apply.shutdown",
      state: "error",
      label: "Storage adapter shutdown",
      detail: shutdownError,
    });
  }

  const failures = items.filter((item) => item.status === "failed");
  if (failures.length > 0) {
    checks.push({
      id: "storage.migration_apply.copy",
      state: "error",
      label: "Storage object copy",
      detail: `${failures.length.toString()} objects failed to copy`,
      hint: "Review the apply artifact, fix the failing object, then rerun the migration apply.",
    });
  } else {
    checks.push({
      id: "storage.migration_apply.copy",
      state: "ok",
      label: "Storage object copy",
      detail: `${items.length.toString()} objects copied to S3`,
    });
  }

  const report = buildStorageMigrationApplyReport({
    inventory,
    target,
    checks,
    items,
    startedAt,
    artifactPath,
    execute: true,
    approve: args.approve,
    error:
      failures.length > 0
        ? "One or more objects failed to copy"
        : shutdownError
          ? `Storage adapter shutdown failed: ${shutdownError}`
          : null,
    nextCommand:
      failures.length > 0
        ? "nexpress ops storage migrate apply --target s3 --execute --approve storage-migrate --json"
        : "nexpress ops storage verify --json",
  });
  await maybeWriteStorageApplyArtifact(report, artifactPath);
  return report;
}

function buildStorageMigrationApplyReport(args: {
  inventory: LocalStorageInventory;
  target: string;
  checks: CheckResult[];
  items: OpsStorageMigrationApplyItem[];
  startedAt: Date;
  artifactPath: string | null;
  execute?: boolean;
  approve?: string | null;
  error?: string | null;
  nextCommand: string | null;
}): OpsStorageMigrationApplyJson {
  const counts = countChecks(args.checks);
  const failed = args.items.filter((item) => item.status === "failed").length;
  const copied = args.items.filter((item) => item.status === "copied").length;
  const planned = args.items.filter((item) => item.status === "planned").length;
  const status =
    counts.errors > 0 || failed > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const limited = copyItemLimit(args.items);
  return {
    schemaVersion: "np.ops-storage-migration-apply.v1",
    ok: counts.errors === 0 && failed === 0,
    status,
    source: "local",
    target: args.target,
    summary: {
      ...args.inventory.summary,
      planned,
      copied,
      failed,
      returned: limited.returned.length,
      truncated: limited.truncated,
      invalidStorageKeys: args.inventory.invalidStorageKeys,
    },
    mutation: buildOpsMutationAudit({
      action: "storage.migrate.apply",
      execute: args.execute,
      approve: args.approve,
      requiredApproval: "storage-migrate",
      artifactPath: args.artifactPath,
      applied: Boolean(args.execute && copied > 0 && failed === 0 && counts.errors === 0),
      error: args.error ?? null,
      rollbackHint:
        "Keep local storage unchanged until the deployed app is verified with NP_STORAGE_ADAPTER=s3. Roll back by restoring the previous storage env vars.",
      nextCommand: args.nextCommand,
      startedAt: args.startedAt,
      completedAt: new Date(),
    }),
    nextCommand: args.nextCommand,
    projectNextCommand: args.nextCommand ? toProjectCommand(args.nextCommand) : null,
    checks: args.checks,
    items: limited.returned,
  };
}

async function maybeWriteStorageApplyArtifact(
  report: OpsStorageMigrationApplyJson,
  artifactPath: string | null,
): Promise<void> {
  if (!artifactPath) return;
  await writeOpsJsonArtifact(artifactPath, report);
}

function buildStorageConfig(env: OpsStorageEnv, adapter: "local" | "s3") {
  if (adapter === "local") {
    return {
      adapter,
      local: {
        directory: resolve(
          /* turbopackIgnore: true */ process.cwd(),
          env.NP_STORAGE_DIR ?? "./public/media",
        ),
        baseUrl: env.NP_STORAGE_URL ?? "/media",
      },
    } as const;
  }

  return {
    adapter,
    s3: {
      bucket: env.NP_S3_BUCKET ?? "",
      region: env.NP_S3_REGION ?? "",
      endpoint: env.NP_S3_ENDPOINT,
    },
  } as const;
}

export async function runOpsStorageTest(args: {
  execute?: boolean;
  approve?: string | null;
  env?: OpsStorageEnv;
}): Promise<OpsStorageJson> {
  const env = args.env ?? process.env;
  const base = await collectOpsStorageStatus(env, "test");
  const adapter = base.adapter;
  const mode = args.execute ? "execute" : "dry-run";
  if (adapter === "unknown" || adapter === "custom") {
    return {
      ...base,
      operation: "test",
      mutation: {
        action: "test",
        applied: false,
        mode,
        error:
          adapter === "custom"
            ? "Custom storage adapters must be tested through the running application"
            : "Storage adapter is unknown",
      },
    };
  }

  if (!args.execute) {
    return {
      ...base,
      operation: "test",
      nextCommand: "nexpress ops storage test --execute --approve storage-test --json",
      projectNextCommand: toProjectCommand(
        "nexpress ops storage test --execute --approve storage-test --json",
      ),
      mutation: {
        action: "test",
        applied: false,
        mode,
        error: null,
        result: { probe: "dry-run" },
      },
    };
  }

  if (args.approve !== "storage-test") {
    return {
      ...base,
      ok: false,
      status: "blocked",
      operation: "test",
      nextCommand: "nexpress ops storage test --execute --approve storage-test --json",
      projectNextCommand: toProjectCommand(
        "nexpress ops storage test --execute --approve storage-test --json",
      ),
      mutation: {
        action: "test",
        applied: false,
        mode,
        error: "Missing --approve storage-test",
      },
    };
  }

  const key = `.nexpress-ops/probe-${Date.now().toString(36)}.txt`;
  const storage = createStorageAdapter(buildStorageConfig(env, adapter));
  let report: OpsStorageJson;
  try {
    await npUploadStorageObject(storage, key, Buffer.from("nexpress storage probe\n", "utf8"), {
      contentType: "text/plain; charset=utf-8",
      contentLength: Buffer.byteLength("nexpress storage probe\n"),
      originalFilename: "probe.txt",
    });
    const exists = await npStorageObjectExists(storage, key);
    await npDeleteStorageObject(storage, key);
    const verified = await collectOpsStorageStatus(env, "verify");
    report = {
      ...verified,
      operation: "test",
      mutation: {
        action: "test",
        applied: exists,
        mode,
        error: exists ? null : "Probe upload did not become readable",
        result: { key, exists, deleted: true },
      },
    };
  } catch (error) {
    report = {
      ...base,
      ok: false,
      status: "blocked",
      operation: "test",
      nextCommand: "Check storage credentials and rerun nexpress ops storage test --json",
      projectNextCommand: "Check storage credentials and rerun nexpress ops storage test --json",
      mutation: {
        action: "test",
        applied: false,
        mode,
        error: error instanceof Error ? error.message : String(error),
        result: { key, exists: false, deleted: false },
      },
    };
  }

  try {
    await npCloseStorageAdapter(storage);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const existingError = report.mutation?.error;
    report = {
      ...report,
      ok: false,
      status: "blocked",
      nextCommand: "Check storage credentials and rerun nexpress ops storage test --json",
      projectNextCommand: "Check storage credentials and rerun nexpress ops storage test --json",
      mutation: report.mutation
        ? {
            ...report.mutation,
            applied: false,
            error: `${existingError ? `${existingError}; ` : ""}adapter shutdown failed: ${detail}`,
          }
        : null,
      checks: [
        ...report.checks,
        {
          id: "storage.test.shutdown",
          state: "error",
          label: "Storage adapter shutdown",
          detail,
        },
      ],
    };
  }
  return report;
}

function formatBriefState(state: CheckResult["state"], color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  if (state === "ok") return `${c.green}[ok]${c.reset}`;
  if (state === "warn") return `${c.yellow}[warn]${c.reset}`;
  return `${c.red}[error]${c.reset}`;
}

export function renderBriefOpsStorageStatus(
  report: OpsStorageJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const state =
    report.status === "ready"
      ? `${c.green}ready${c.reset}`
      : report.status === "attention"
        ? `${c.yellow}attention${c.reset}`
        : `${c.red}blocked${c.reset}`;
  const lines = [
    `${c.dim}NexPress ops storage${c.reset}`,
    `${state}: ${report.adapter} (${report.operation})`,
    `media: ${report.summary.mediaRows.toString()} rows, ${report.summary.indexedObjects.toString()} indexed objects`,
  ];
  if (report.summary.localFiles !== null) {
    lines.push(
      `local: ${report.summary.localFiles.toString()} files, ${report.summary.missingFiles.toString()} missing, ${report.summary.orphanedFiles.toString()} orphaned`,
    );
  }
  for (const check of report.checks) {
    const parts = [formatBriefState(check.state, options.color), check.id, check.label];
    if (check.detail) parts.push(`- ${check.detail.replace(/\s+/g, " ")}`);
    lines.push(parts.join(" "));
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  if (report.mutation) {
    lines.push(
      `mutation: ${report.mutation.action} applied=${String(report.mutation.applied)}${report.mutation.error ? ` error=${report.mutation.error}` : ""}`,
    );
  }
  return lines.join("\n");
}
