import { access, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { createStorageAdapter } from "@nexpress/core";
import pg from "pg";

import { toProjectCommand } from "./ops-command-format.js";
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
  adapter: "local" | "s3" | "unknown";
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

export interface OpsStorageJson {
  schemaVersion: "np.ops-storage.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  adapter: "local" | "s3" | "unknown";
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
  const adapter = (env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
  if (adapter === "local" || adapter === "s3") return adapter;
  return "unknown";
}

function countChecks(checks: CheckResult[]): { errors: number; warnings: number } {
  return {
    errors: checks.filter((check) => check.state === "error").length,
    warnings: checks.filter((check) => check.state === "warn").length,
  };
}

function collectSizeStorageKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const keys: string[] = [];
  for (const size of Object.values(value as Record<string, unknown>)) {
    if (!size || typeof size !== "object") continue;
    const storageKey = (size as Record<string, unknown>).storageKey;
    if (typeof storageKey === "string" && storageKey.length > 0) keys.push(storageKey);
  }
  return keys;
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
      `select storage_key, sizes
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
  const full = resolve(/* turbopackIgnore: true */ root, key);
  const rel = relative(root, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
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
      detail: adapter === "s3" ? "active adapter is s3" : "unknown adapter",
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
  } catch {
    checks.push({
      id: "storage.local_directory",
      state: "warn",
      label: "Local storage directory",
      detail: `${root} does not exist yet`,
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
    };
  }

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
      detail: `${invalidStorageKeys.toString()} indexed keys resolve outside the storage directory`,
      hint: "Review np_media.storage_key values before trusting local media drift counts.",
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
    checks.push({
      id: "storage.adapter",
      state: "error",
      label: "Storage adapter",
      detail: env.NP_STORAGE_ADAPTER ?? "unknown",
      hint: "Use NP_STORAGE_ADAPTER=local or NP_STORAGE_ADAPTER=s3.",
    });
    return buildOpsStorageJson({ adapter, summary, checks, operation });
  }

  checks.push({ id: "storage.adapter", state: "ok", label: "Storage adapter", detail: adapter });

  if (adapter === "s3") {
    const missing = ["NP_S3_BUCKET", "NP_S3_REGION"].filter((name) => !env[name]);
    checks.push(
      missing.length === 0
        ? { id: "storage.s3_config", state: "ok", label: "S3 storage config" }
        : {
            id: "storage.s3_config",
            state: "error",
            label: "S3 storage config",
            detail: `missing ${missing.join(", ")}`,
            hint: "Set NP_S3_BUCKET and NP_S3_REGION before deploying with S3 storage.",
          },
    );
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
    } catch {
      checks.push({
        id: "storage.local_directory",
        state: "warn",
        label: "Local storage directory",
        detail: `${root} does not exist yet`,
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
    const missing = ["NP_S3_BUCKET", "NP_S3_REGION"].filter((name) => !env[name]);
    checks.push(
      missing.length === 0
        ? { id: "storage.s3_config", state: "ok", label: "S3 storage config" }
        : {
            id: "storage.s3_config",
            state: "error",
            label: "S3 storage config",
            detail: `missing ${missing.join(", ")}`,
            hint: "Set NP_S3_BUCKET and NP_S3_REGION before planning local-to-S3 migration.",
          },
    );
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
      region: env.NP_S3_REGION ?? "us-east-1",
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
  if (adapter === "unknown") {
    return {
      ...base,
      operation: "test",
      mutation: {
        action: "test",
        applied: false,
        mode,
        error: "Storage adapter is unknown",
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
  try {
    await storage.upload(key, Buffer.from("nexpress storage probe\n", "utf8"), {
      contentType: "text/plain; charset=utf-8",
      contentLength: Buffer.byteLength("nexpress storage probe\n"),
      originalFilename: "probe.txt",
    });
    const exists = await storage.exists(key);
    await storage.delete(key);
    const report = await collectOpsStorageStatus(env, "verify");
    return {
      ...report,
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
    return {
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
