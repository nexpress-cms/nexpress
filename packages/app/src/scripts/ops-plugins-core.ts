import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { CheckResult } from "./doctor-readiness.js";

interface PluginManifestLike {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  capabilities?: unknown;
}

interface PluginLike {
  manifest?: PluginManifestLike;
  blocks?: unknown;
  routes?: unknown;
  pageRoutes?: unknown;
  scheduled?: unknown;
}

interface ConfigLike {
  plugins?: unknown;
}

export interface OpsPluginEntry {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  capabilities: string[];
  blocks: string[];
  routes: string[];
  pageRoutes: string[];
  scheduled: string[];
}

export interface OpsPluginsSummary {
  plugins: number;
  blocks: number;
  routes: number;
  pageRoutes: number;
  scheduled: number;
  warnings: number;
  errors: number;
}

export interface OpsPluginsJson {
  schemaVersion: "np.ops-plugins.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  summary: OpsPluginsSummary;
  nextCommand: string | null;
  checks: CheckResult[];
  plugins: OpsPluginEntry[];
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

const CONFIG_CANDIDATES = [
  "nexpress.config.ts",
  "src/nexpress.config.ts",
  "apps/web/src/nexpress.config.ts",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function routeKey(route: unknown): string | null {
  if (!isObject(route)) return null;
  const method = readString(route.method)?.toUpperCase() ?? "GET";
  const path = readString(route.path);
  return path ? `${method} ${path}` : null;
}

function pageRouteKey(route: unknown): string | null {
  if (!isObject(route)) return null;
  return readString(route.pattern);
}

function scheduledKey(task: unknown): string | null {
  if (!isObject(task)) return null;
  return readString(task.id);
}

function blockKey(block: unknown): string | null {
  if (!isObject(block)) return null;
  return readString(block.type);
}

function duplicateChecks(
  id: string,
  label: string,
  keys: Array<{ key: string; plugin: string }>,
): CheckResult | null {
  const owners = new Map<string, string[]>();
  for (const item of keys) {
    const existing = owners.get(item.key) ?? [];
    existing.push(item.plugin);
    owners.set(item.key, existing);
  }
  const duplicates = [...owners.entries()].filter(([, plugins]) => plugins.length > 1);
  if (duplicates.length === 0) return null;
  return {
    id,
    state: "warn",
    label,
    detail: duplicates
      .map(([key, plugins]) => `${key} (${plugins.join(", ")})`)
      .slice(0, 5)
      .join("; "),
  };
}

function summarize(checks: CheckResult[], plugins: OpsPluginEntry[]): OpsPluginsSummary {
  return {
    plugins: plugins.length,
    blocks: plugins.reduce((total, plugin) => total + plugin.blocks.length, 0),
    routes: plugins.reduce((total, plugin) => total + plugin.routes.length, 0),
    pageRoutes: plugins.reduce((total, plugin) => total + plugin.pageRoutes.length, 0),
    scheduled: plugins.reduce((total, plugin) => total + plugin.scheduled.length, 0),
    warnings: checks.filter((check) => check.state === "warn").length,
    errors: checks.filter((check) => check.state === "error").length,
  };
}

function normalizePlugin(plugin: PluginLike, index: number): OpsPluginEntry {
  const manifest = plugin.manifest ?? {};
  const id = readString(manifest.id) ?? `plugin-${index.toString()}`;
  return {
    id,
    name: readString(manifest.name) ?? id,
    version: readString(manifest.version),
    description: readString(manifest.description),
    capabilities: readCapabilities(manifest.capabilities),
    blocks: readArray(plugin.blocks)
      .map(blockKey)
      .filter((key): key is string => Boolean(key)),
    routes: readArray(plugin.routes)
      .map(routeKey)
      .filter((key): key is string => Boolean(key)),
    pageRoutes: readArray(plugin.pageRoutes)
      .map(pageRouteKey)
      .filter((key): key is string => Boolean(key)),
    scheduled: readArray(plugin.scheduled)
      .map(scheduledKey)
      .filter((key): key is string => Boolean(key)),
  };
}

export function buildOpsPluginsJson(args: {
  checks: CheckResult[];
  plugins: OpsPluginEntry[];
}): OpsPluginsJson {
  const summary = summarize(args.checks, args.plugins);
  const status = summary.errors > 0 ? "blocked" : summary.warnings > 0 ? "attention" : "ready";
  return {
    schemaVersion: "np.ops-plugins.v1",
    ok: summary.errors === 0,
    status,
    summary,
    nextCommand: status === "ready" ? null : "nexpress ops plugins doctor --json",
    checks: args.checks,
    plugins: args.plugins,
  };
}

export function analyzePlugins(pluginsInput: unknown): OpsPluginsJson {
  const checks: CheckResult[] = [];
  if (!Array.isArray(pluginsInput)) {
    checks.push({
      id: "plugins.config",
      state: "warn",
      label: "Plugin config",
      detail: "plugins is missing or not an array",
    });
    return buildOpsPluginsJson({ checks, plugins: [] });
  }

  const pluginObjects = pluginsInput.filter((plugin): plugin is PluginLike => isObject(plugin));
  const plugins = pluginObjects.map(normalizePlugin);
  checks.push({
    id: "plugins.config",
    state: "ok",
    label: "Plugin config",
    detail: `${plugins.length.toString()} plugins`,
  });

  const invalidCount = pluginsInput.length - pluginObjects.length;
  if (invalidCount > 0) {
    checks.push({
      id: "plugins.invalid_entries",
      state: "error",
      label: "Plugin entries",
      detail: `${invalidCount.toString()} entries are not plugin objects`,
    });
  }

  const missingManifest = pluginObjects.filter((plugin) => !isObject(plugin.manifest)).length;
  if (missingManifest > 0) {
    checks.push({
      id: "plugins.manifest",
      state: "error",
      label: "Plugin manifests",
      detail: `${missingManifest.toString()} plugins are missing manifest metadata`,
    });
  }

  const duplicateIds = duplicateChecks(
    "plugins.duplicate_id",
    "Plugin IDs",
    plugins.map((plugin) => ({ key: plugin.id, plugin: plugin.id })),
  );
  if (duplicateIds) checks.push(duplicateIds);

  const blockConflicts = duplicateChecks(
    "plugins.block_conflict",
    "Plugin block types",
    plugins.flatMap((plugin) => plugin.blocks.map((key) => ({ key, plugin: plugin.id }))),
  );
  if (blockConflicts) checks.push(blockConflicts);

  const routeConflicts = duplicateChecks(
    "plugins.route_conflict",
    "Plugin API routes",
    plugins.flatMap((plugin) => plugin.routes.map((key) => ({ key, plugin: plugin.id }))),
  );
  if (routeConflicts) checks.push(routeConflicts);

  const pageRouteConflicts = duplicateChecks(
    "plugins.page_route_conflict",
    "Plugin page routes",
    plugins.flatMap((plugin) => plugin.pageRoutes.map((key) => ({ key, plugin: plugin.id }))),
  );
  if (pageRouteConflicts) checks.push(pageRouteConflicts);

  return buildOpsPluginsJson({ checks, plugins });
}

export function resolveNexpressConfigPath(cwd = process.cwd()): string | null {
  for (const candidate of CONFIG_CANDIDATES) {
    const full = resolve(cwd, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

export async function collectOpsPluginsStatus(cwd = process.cwd()): Promise<OpsPluginsJson> {
  const configPath = resolveNexpressConfigPath(cwd);
  if (!configPath) {
    return buildOpsPluginsJson({
      plugins: [],
      checks: [
        {
          id: "plugins.config_file",
          state: "error",
          label: "nexpress.config.ts",
          detail: `looked at ${CONFIG_CANDIDATES.join(", ")}`,
        },
      ],
    });
  }

  try {
    const loaded = (await import(pathToFileURL(configPath).href)) as {
      default?: ConfigLike;
      config?: ConfigLike;
    };
    const config = loaded.default ?? loaded.config;
    const report = analyzePlugins(config?.plugins);
    return buildOpsPluginsJson({
      plugins: report.plugins,
      checks: [
        {
          id: "plugins.config_file",
          state: "ok",
          label: "nexpress.config.ts",
          detail: configPath,
        },
        ...report.checks,
      ],
    });
  } catch (error: unknown) {
    return buildOpsPluginsJson({
      plugins: [],
      checks: [
        {
          id: "plugins.config_file",
          state: "error",
          label: "nexpress.config.ts",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    });
  }
}

function formatBriefState(state: CheckResult["state"], color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  if (state === "ok") return `${c.green}[ok]${c.reset}`;
  if (state === "warn") return `${c.yellow}[warn]${c.reset}`;
  return `${c.red}[error]${c.reset}`;
}

export function renderBriefOpsPluginsStatus(
  report: OpsPluginsJson,
  mode: "list" | "doctor",
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
    `${c.dim}NexPress ops plugins${c.reset}`,
    `${state}: ${report.summary.plugins.toString()} plugins, ${report.summary.blocks.toString()} blocks, ${report.summary.routes.toString()} API routes, ${report.summary.pageRoutes.toString()} page routes`,
  ];
  if (mode === "list") {
    for (const plugin of report.plugins) {
      const version = plugin.version ? `@${plugin.version}` : "";
      lines.push(`- ${plugin.id}${version}: ${plugin.name}`);
    }
  } else {
    for (const check of report.checks) {
      const parts = [formatBriefState(check.state, options.color), check.id, check.label];
      if (check.detail) parts.push(`- ${check.detail.replace(/\s+/g, " ")}`);
      lines.push(parts.join(" "));
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  return lines.join("\n");
}
