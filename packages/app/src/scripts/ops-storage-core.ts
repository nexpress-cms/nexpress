import { createRequire } from "node:module";
import { access, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { createStorageAdapter } from "@nexpress/core";

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

export interface OpsStorageSummary {
  mediaRows: number;
  indexedObjects: number;
  localFiles: number | null;
  missingFiles: number;
  orphanedFiles: number;
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

async function loadPg(): Promise<PgModuleLike> {
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const resolved = require.resolve("pg");
  return import(resolved) as Promise<PgModuleLike>;
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
    pg = await loadPg();
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
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(current, entry.name);
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
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveStorageKey(root: string, key: string): string | null {
  const full = resolve(root, key);
  const rel = relative(root, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return full;
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
  return {
    schemaVersion: "np.ops-storage.v1",
    ok: counts.errors === 0,
    status,
    adapter: args.adapter,
    operation: args.operation ?? "status",
    mutation: args.mutation ?? null,
    summary: args.summary,
    nextCommand:
      status === "ready"
        ? null
        : args.operation === "verify"
          ? "nexpress ops storage verify --json"
          : "nexpress ops storage status --json",
    checks: args.checks,
  };
}

export async function collectOpsStorageStatus(
  env: OpsStorageEnv = process.env,
  operation: OpsStorageJson["operation"] = "status",
): Promise<OpsStorageJson> {
  const adapter = parseAdapter(env);
  const checks: CheckResult[] = [];
  const summary: OpsStorageSummary = {
    mediaRows: 0,
    indexedObjects: 0,
    localFiles: null,
    missingFiles: 0,
    orphanedFiles: 0,
  };

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

  const root = resolve(process.cwd(), env.NP_STORAGE_DIR ?? "./public/media");
  let localDirectoryReady = adapter !== "local";
  if (adapter === "local") {
    try {
      const storageStat = await stat(root);
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
    const files = await listFilesRecursive(root);
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

function buildStorageConfig(env: OpsStorageEnv, adapter: "local" | "s3") {
  if (adapter === "local") {
    return {
      adapter,
      local: {
        directory: resolve(process.cwd(), env.NP_STORAGE_DIR ?? "./public/media"),
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
  if (report.mutation) {
    lines.push(
      `mutation: ${report.mutation.action} applied=${String(report.mutation.applied)}${report.mutation.error ? ` error=${report.mutation.error}` : ""}`,
    );
  }
  return lines.join("\n");
}
