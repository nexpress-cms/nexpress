import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { toProjectCommand } from "./ops-command-format.js";
import type { CheckResult } from "./doctor-readiness.js";

interface PluginManifestLike {
  apiVersion?: unknown;
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  author?: unknown;
  license?: unknown;
  nexpress?: unknown;
  capabilities?: unknown;
  allowedHosts?: unknown;
  requires?: unknown;
  provides?: unknown;
  agent?: unknown;
  usesTokens?: unknown;
  styleSlots?: unknown;
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
  index: number;
  id: string;
  apiVersion: string | null;
  name: string;
  version: string | null;
  description: string | null;
  author: string | null;
  license: string | null;
  nexpress: {
    minVersion: string | null;
    maxVersion: string | null;
  };
  capabilities: string[];
  allowedHosts: string[];
  requires: string[];
  provides: {
    blocks: string[];
    fields: string[];
    collections: string[];
    adminExtensions: string[];
    apiRoutes: string[];
    pageRoutes: string[];
    scheduledTasks: string[];
    hooks: string[];
  };
  agent: {
    description: string | null;
    category: string | null;
    tags: string[];
  };
  usesTokens: string[];
  styleSlots: string[];
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
  projectNextCommand: string | null;
  checks: CheckResult[];
  plugins: OpsPluginEntry[];
}

export interface OpsPluginInspectJson extends Omit<OpsPluginsJson, "plugins"> {
  mode: "inspect";
  pluginId: string;
  plugin: OpsPluginEntry | null;
  relatedChecks: CheckResult[];
  plugins: OpsPluginEntry[];
}

export interface OpsPluginPackageRef {
  pluginId: string;
  packageName: string | null;
  currentRange: string | null;
  dependencyField: "dependencies" | "devDependencies" | "optionalDependencies" | null;
  confidence: "exact" | "inferred" | "unknown";
}

export interface OpsPluginUpgradeStep {
  id: string;
  pluginId: string;
  packageName: string | null;
  status: "ready" | "manual";
  required: boolean;
  requiresApproval: boolean;
  command: string;
  projectCommand: string;
  note: string;
}

export interface OpsPluginsUpgradePlanJson {
  schemaVersion: "np.ops-plugins-upgrade-plan.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  pluginId: string | null;
  summary: {
    plugins: number;
    packages: number;
    manual: number;
    commands: number;
  };
  nextCommand: string | null;
  projectNextCommand: string | null;
  checks: CheckResult[];
  packages: OpsPluginPackageRef[];
  steps: OpsPluginUpgradeStep[];
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

const PACKAGE_JSON_CANDIDATES = ["package.json", "apps/web/package.json"];

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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readStringRecordKeys(value: unknown): string[] {
  if (!isObject(value)) return [];
  return Object.keys(value).sort();
}

function readAuthor(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (!isObject(value)) return null;
  return readString(value.name);
}

function readNexpress(value: unknown): OpsPluginEntry["nexpress"] {
  if (!isObject(value)) return { minVersion: null, maxVersion: null };
  return {
    minVersion: readString(value.minVersion),
    maxVersion: readString(value.maxVersion),
  };
}

function readProvides(value: unknown): OpsPluginEntry["provides"] {
  const source = isObject(value) ? value : {};
  return {
    blocks: readStringArray(source.blocks),
    fields: readStringArray(source.fields),
    collections: readStringArray(source.collections),
    adminExtensions: readStringArray(source.adminExtensions),
    apiRoutes: readStringArray(source.apiRoutes),
    pageRoutes: readStringArray(source.pageRoutes),
    scheduledTasks: readStringArray(source.scheduledTasks),
    hooks: readStringArray(source.hooks),
  };
}

function readAgent(value: unknown): OpsPluginEntry["agent"] {
  if (!isObject(value)) return { description: null, category: null, tags: [] };
  return {
    description: readString(value.description),
    category: readString(value.category),
    tags: readStringArray(value.tags),
  };
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
    index,
    id,
    apiVersion: readString(manifest.apiVersion),
    name: readString(manifest.name) ?? id,
    version: readString(manifest.version),
    description: readString(manifest.description),
    author: readAuthor(manifest.author),
    license: readString(manifest.license),
    nexpress: readNexpress(manifest.nexpress),
    capabilities: readCapabilities(manifest.capabilities),
    allowedHosts: readStringArray(manifest.allowedHosts),
    requires: readStringArray(manifest.requires),
    provides: readProvides(manifest.provides),
    agent: readAgent(manifest.agent),
    usesTokens: readStringArray(manifest.usesTokens),
    styleSlots: readStringRecordKeys(manifest.styleSlots),
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
  const nextCommand = status === "ready" ? null : "nexpress ops plugins doctor --json";
  return {
    schemaVersion: "np.ops-plugins.v1",
    ok: summary.errors === 0,
    status,
    summary,
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    checks: args.checks,
    plugins: args.plugins,
  };
}

function checkMentionsPlugin(check: CheckResult, pluginId: string): boolean {
  return (
    check.id === "plugins.config_file" ||
    check.id === "plugins.config" ||
    check.detail?.includes(pluginId) === true
  );
}

export function buildOpsPluginInspectJson(
  report: OpsPluginsJson,
  pluginId: string,
): OpsPluginInspectJson {
  const plugin = report.plugins.find((entry) => entry.id === pluginId) ?? null;
  const missingPluginChecks: CheckResult[] = [
    {
      id: "plugins.inspect.not_found",
      state: "error",
      label: "Plugin inspect",
      detail: `No configured plugin has id ${pluginId}`,
    },
  ];
  const relatedChecks: CheckResult[] = plugin
    ? report.checks.filter((check) => checkMentionsPlugin(check, pluginId))
    : missingPluginChecks;
  const checks = plugin ? report.checks : [...report.checks, ...relatedChecks];
  const summary = plugin
    ? summarize(relatedChecks, [plugin])
    : {
        plugins: 0,
        blocks: 0,
        routes: 0,
        pageRoutes: 0,
        scheduled: 0,
        warnings: relatedChecks.filter((check) => check.state === "warn").length,
        errors: relatedChecks.filter((check) => check.state === "error").length,
      };
  const status = summary.errors > 0 ? "blocked" : summary.warnings > 0 ? "attention" : "ready";
  const nextCommand = plugin
    ? `nexpress ops plugins upgrade-plan ${plugin.id} --json`
    : "nexpress ops plugins list --json";
  return {
    schemaVersion: "np.ops-plugins.v1",
    mode: "inspect",
    ok: plugin !== null && summary.errors === 0,
    status,
    summary,
    nextCommand,
    projectNextCommand: toProjectCommand(nextCommand),
    checks,
    relatedChecks,
    pluginId,
    plugin,
    plugins: plugin ? [plugin] : [],
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

function readPackageDependencies(
  cwd = process.cwd(),
): Record<string, { range: string; field: OpsPluginPackageRef["dependencyField"] }> {
  const result: Record<string, { range: string; field: OpsPluginPackageRef["dependencyField"] }> =
    {};
  const fields: Array<NonNullable<OpsPluginPackageRef["dependencyField"]>> = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ];
  for (const candidate of PACKAGE_JSON_CANDIDATES) {
    const packageJsonPath = resolve(cwd, candidate);
    if (!existsSync(packageJsonPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
      // Later candidates are closer to generated app runtime (`apps/web` in the monorepo),
      // so they intentionally override root workspace ranges when both exist.
      for (const field of fields) {
        const deps = pkg[field];
        if (!isObject(deps)) continue;
        for (const [name, range] of Object.entries(deps)) {
          if (typeof range === "string") result[name] = { range, field };
        }
      }
    } catch {
      continue;
    }
  }
  return result;
}

function pluginPackageCandidates(pluginId: string): string[] {
  if (pluginId.startsWith("@")) return [pluginId];
  return [`@nexpress/plugin-${pluginId}`, `@nexpress/${pluginId}`, `plugin-${pluginId}`, pluginId];
}

function inferPluginPackage(
  plugin: OpsPluginEntry,
  dependencies: Record<string, { range: string; field: OpsPluginPackageRef["dependencyField"] }>,
): OpsPluginPackageRef {
  for (const candidate of pluginPackageCandidates(plugin.id)) {
    const dependency = dependencies[candidate];
    if (!dependency) continue;
    return {
      pluginId: plugin.id,
      packageName: candidate,
      currentRange: dependency.range,
      dependencyField: dependency.field,
      confidence: candidate === plugin.id ? "exact" : "inferred",
    };
  }
  return {
    pluginId: plugin.id,
    packageName: null,
    currentRange: null,
    dependencyField: null,
    confidence: "unknown",
  };
}

function buildUpgradeSteps(packageRef: OpsPluginPackageRef): OpsPluginUpgradeStep[] {
  const inspectCommand = `nexpress ops plugins inspect ${packageRef.pluginId} --json`;
  const withProjectCommands = (
    steps: Array<Omit<OpsPluginUpgradeStep, "projectCommand">>,
  ): OpsPluginUpgradeStep[] =>
    steps.map((step) => ({ ...step, projectCommand: toProjectCommand(step.command) }));
  if (!packageRef.packageName) {
    return withProjectCommands([
      {
        id: `${packageRef.pluginId}.inspect`,
        pluginId: packageRef.pluginId,
        packageName: null,
        status: "manual",
        required: true,
        requiresApproval: false,
        command: inspectCommand,
        note: "Inspect the configured plugin before resolving its package name manually.",
      },
      {
        id: `${packageRef.pluginId}.package`,
        pluginId: packageRef.pluginId,
        packageName: null,
        status: "manual",
        required: true,
        requiresApproval: true,
        command: "pnpm add <plugin-package>@latest",
        note: "No matching package dependency was found for this plugin id.",
      },
    ]);
  }
  return withProjectCommands([
    {
      id: `${packageRef.pluginId}.inspect`,
      pluginId: packageRef.pluginId,
      packageName: packageRef.packageName,
      status: "ready",
      required: true,
      requiresApproval: false,
      command: inspectCommand,
      note: "Capture the current manifest and plugin-owned contracts before upgrading.",
    },
    {
      id: `${packageRef.pluginId}.outdated`,
      pluginId: packageRef.pluginId,
      packageName: packageRef.packageName,
      status: "ready",
      required: true,
      requiresApproval: false,
      command: `pnpm outdated ${packageRef.packageName}`,
      note: "Check the latest compatible package version.",
    },
    {
      id: `${packageRef.pluginId}.upgrade`,
      pluginId: packageRef.pluginId,
      packageName: packageRef.packageName,
      status: "ready",
      required: true,
      requiresApproval: true,
      command: `pnpm add ${packageRef.packageName}@latest`,
      note: "Changing plugin package code requires dependency review, rebuild, and redeploy.",
    },
    {
      id: `${packageRef.pluginId}.build`,
      pluginId: packageRef.pluginId,
      packageName: packageRef.packageName,
      status: "ready",
      required: true,
      requiresApproval: false,
      command: "pnpm build",
      note: "v1 plugins are loaded at boot, so rebuild and restart/deploy after dependency changes.",
    },
    {
      id: `${packageRef.pluginId}.doctor`,
      pluginId: packageRef.pluginId,
      packageName: packageRef.packageName,
      status: "ready",
      required: true,
      requiresApproval: false,
      command: "nexpress ops plugins doctor --json",
      note: "Verify plugin-owned routes, page routes, and blocks after rebuilding.",
    },
    {
      id: `${packageRef.pluginId}.release-check`,
      pluginId: packageRef.pluginId,
      packageName: packageRef.packageName,
      status: "ready",
      required: true,
      requiresApproval: false,
      command: "nexpress release check --json",
      note: "Run the full pre-release gate before deploying the upgraded plugin.",
    },
  ]);
}

export function buildOpsPluginsUpgradePlanJson(args: {
  report: OpsPluginsJson;
  cwd?: string;
  pluginId?: string | null;
}): OpsPluginsUpgradePlanJson {
  const selectedPlugins = args.pluginId
    ? args.report.plugins.filter((plugin) => plugin.id === args.pluginId)
    : args.report.plugins;
  const checks: CheckResult[] = [...args.report.checks];
  if (args.pluginId && selectedPlugins.length === 0) {
    checks.push({
      id: "plugins.upgrade_plan.not_found",
      state: "error",
      label: "Plugin upgrade plan",
      detail: `No configured plugin has id ${args.pluginId}`,
    });
  }
  const dependencies = readPackageDependencies(args.cwd);
  const packages = selectedPlugins.map((plugin) => inferPluginPackage(plugin, dependencies));
  const manualPackages = packages.filter((item) => item.confidence === "unknown");
  if (manualPackages.length > 0) {
    checks.push({
      id: "plugins.upgrade_plan.package_inference",
      state: "warn",
      label: "Plugin package inference",
      detail: manualPackages.map((item) => item.pluginId).join(", "),
    });
  }
  const steps = packages.flatMap(buildUpgradeSteps);
  const blocked = checks.some((check) => check.state === "error");
  const attention = checks.some((check) => check.state === "warn") || manualPackages.length > 0;
  const status = blocked ? "blocked" : attention ? "attention" : "ready";
  const nextCommand =
    status === "blocked"
      ? "nexpress ops plugins list --json"
      : (steps.find((step) => step.status === "manual")?.command ??
        steps.find((step) => step.requiresApproval)?.command ??
        null);
  return {
    schemaVersion: "np.ops-plugins-upgrade-plan.v1",
    ok: !blocked,
    status,
    pluginId: args.pluginId ?? null,
    summary: {
      plugins: selectedPlugins.length,
      packages: packages.filter((item) => item.packageName).length,
      manual: manualPackages.length,
      commands: steps.length,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    checks,
    packages,
    steps,
  };
}

function formatBriefState(state: CheckResult["state"], color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  if (state === "ok") return `${c.green}[ok]${c.reset}`;
  if (state === "warn") return `${c.yellow}[warn]${c.reset}`;
  return `${c.red}[error]${c.reset}`;
}

export function renderBriefOpsPluginsStatus(
  report: OpsPluginsJson | OpsPluginInspectJson,
  mode: "list" | "doctor" | "inspect",
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
  } else if (mode === "inspect") {
    const inspectReport = report as OpsPluginInspectJson;
    if (!inspectReport.plugin) {
      lines.push(`missing: ${inspectReport.pluginId}`);
    } else {
      const plugin = inspectReport.plugin;
      const version = plugin.version ? `@${plugin.version}` : "";
      lines.push(`${plugin.id}${version}: ${plugin.name}`);
      if (plugin.description) lines.push(`description: ${plugin.description}`);
      if (plugin.capabilities.length > 0)
        lines.push(`capabilities: ${plugin.capabilities.join(", ")}`);
      if (plugin.requires.length > 0) lines.push(`requires: ${plugin.requires.join(", ")}`);
      if (plugin.blocks.length > 0) lines.push(`blocks: ${plugin.blocks.join(", ")}`);
      if (plugin.routes.length > 0) lines.push(`routes: ${plugin.routes.join(", ")}`);
      if (plugin.pageRoutes.length > 0) lines.push(`page routes: ${plugin.pageRoutes.join(", ")}`);
      if (plugin.scheduled.length > 0) lines.push(`scheduled: ${plugin.scheduled.join(", ")}`);
      if (inspectReport.relatedChecks.length > 0) {
        lines.push("checks:");
        for (const check of inspectReport.relatedChecks) {
          const parts = [`  ${formatBriefState(check.state, options.color)}`, check.id];
          if (check.detail) parts.push(`- ${check.detail.replace(/\s+/g, " ")}`);
          lines.push(parts.join(" "));
        }
      }
    }
  } else {
    for (const check of report.checks) {
      const parts = [formatBriefState(check.state, options.color), check.id, check.label];
      if (check.detail) parts.push(`- ${check.detail.replace(/\s+/g, " ")}`);
      lines.push(parts.join(" "));
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}

export function renderBriefOpsPluginsUpgradePlan(
  report: OpsPluginsUpgradePlanJson,
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
    `${c.dim}NexPress ops plugins upgrade-plan${c.reset}`,
    `${state}: ${report.summary.plugins.toString()} plugins, ${report.summary.packages.toString()} packages, ${report.summary.commands.toString()} commands`,
  ];
  for (const packageRef of report.packages) {
    const name = packageRef.packageName ?? "<manual package>";
    const range = packageRef.currentRange ? ` ${packageRef.currentRange}` : "";
    lines.push(`- ${packageRef.pluginId}: ${name}${range} (${packageRef.confidence})`);
  }
  if (report.steps.length > 0) {
    lines.push("steps:");
    for (const step of report.steps) {
      const approval = step.requiresApproval ? " approval" : "";
      lines.push(`  - ${step.command}${approval}`);
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}
