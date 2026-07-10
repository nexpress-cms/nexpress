import * as fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  invalidatePluginEnabled,
  npAnalyzePluginAdminActionContract,
  npAnalyzePluginScheduledTasks,
  npValidatePluginApiRouteDefinition,
  npValidatePluginPageRouteDefinition,
  type NpPluginActionKind,
  type NpPluginAdminActionIssue,
  type NpRegisteredPluginAction,
} from "@nexpress/core";
import {
  npAnalyzeBlockDefinitions,
  npAnalyzePatternDefinitions,
  npValidateBlockDefinition,
  npValidatePatternDefinition,
} from "@nexpress/blocks/contracts";
import { getDefaultBlocks } from "@nexpress/blocks";
import pg from "pg";

import { toProjectCommand } from "./ops-command-format.js";
import {
  buildOpsMutationAudit,
  defaultOpsArtifactPath,
  type OpsMutationAudit,
  writeOpsJsonArtifact,
} from "./ops-mutation.js";
import { resolveRuntimePath } from "./runtime-path.js";
import type { CheckResult } from "./doctor-readiness.js";

const OPS_PLUGINS_DOCTOR_COMMAND = "nexpress ops plugins doctor --json";
const OPS_PLUGINS_PROJECT_DOCTOR_COMMAND = toProjectCommand(OPS_PLUGINS_DOCTOR_COMMAND);

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
  patterns?: unknown;
  routes?: unknown;
  pageRoutes?: unknown;
  scheduled?: unknown;
  actions?: unknown;
  admin?: unknown;
  setup?: unknown;
}

interface ConfigLike {
  plugins?: unknown;
}

type OpsPluginsEnv = Record<string, string | undefined>;

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
    patterns: string[];
    fields: string[];
    collections: string[];
    adminExtensions: string[];
    actions: string[];
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
  patterns: string[];
  routes: string[];
  pageRoutes: string[];
  scheduled: string[];
  actions: NpRegisteredPluginAction[];
}

export interface OpsPluginsSummary {
  plugins: number;
  blocks: number;
  patterns: number;
  routes: number;
  pageRoutes: number;
  scheduled: number;
  actions: number;
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
  plan: {
    nextCommands: string[];
    projectNextCommands: string[];
  };
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

export interface OpsPluginsMutationJson {
  schemaVersion: "np.ops-plugins-mutation.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  action: "enable" | "disable";
  pluginId: string;
  enabled: boolean | null;
  mutation: OpsMutationAudit;
  nextCommand: string | null;
  projectNextCommand: string | null;
  checks: CheckResult[];
  plugin: OpsPluginEntry | null;
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
// Plugin ops inspect project config at runtime; keep file reads opaque to
// Next/Turbopack's standalone tracer so it does not copy the whole project root.
const FS_METHODS = {
  existsSync: "existsSync",
  readFileSync: "readFileSync",
} as const;

function loadPg(): PgModuleLike {
  return { default: pg as unknown as PgModuleLike["default"] };
}

function runtimeExists(path: string): boolean {
  const existsSync = fs[FS_METHODS.existsSync] as (path: string) => boolean;
  return existsSync(path);
}

function runtimeReadTextFile(path: string): string {
  const readFileSync = fs[FS_METHODS.readFileSync] as (path: string, encoding: "utf8") => string;
  return readFileSync(path, "utf8");
}

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
    patterns: readStringArray(source.patterns),
    fields: readStringArray(source.fields),
    collections: readStringArray(source.collections),
    adminExtensions: readStringArray(source.adminExtensions),
    actions: readStringArray(source.actions),
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

function patternKey(pattern: unknown): string | null {
  if (!isObject(pattern)) return null;
  return readString(pattern.id);
}

function readActionDefinitions(value: unknown): NpRegisteredPluginAction[] {
  if (!isObject(value)) return [];
  const validKinds = new Set<NpPluginActionKind>(["action", "metric", "status", "table"]);
  return Object.entries(value)
    .flatMap(([id, rawAction]) => {
      if (
        !isObject(rawAction) ||
        !validKinds.has(rawAction.kind as NpPluginActionKind) ||
        typeof rawAction.handler !== "function"
      ) {
        return [];
      }
      return [
        {
          id,
          kind: rawAction.kind as NpPluginActionKind,
          source: "definition" as const,
          description: readString(rawAction.description) ?? undefined,
        },
      ];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const ACTION_CHECK_IDS = {
  missing: "plugins.action_missing",
  "kind-mismatch": "plugins.action_kind_mismatch",
  "conflicting-references": "plugins.action_conflicting_references",
  duplicate: "plugins.action_duplicate",
  untyped: "plugins.action_untyped",
  unused: "plugins.action_unreferenced",
  "unsafe-id": "plugins.action_unsafe_id",
} as const satisfies Record<NpPluginAdminActionIssue["code"], string>;

function buildActionChecks(
  diagnostics: Array<{ pluginId: string; issues: NpPluginAdminActionIssue[] }>,
): CheckResult[] {
  const grouped = new Map<
    NpPluginAdminActionIssue["code"],
    { details: string[]; pluginIds: string[] }
  >();
  for (const { pluginId, issues } of diagnostics) {
    for (const issue of issues) {
      const locations = issue.locations.length > 0 ? ` (${issue.locations.join(", ")})` : "";
      const detail = `${pluginId}: ${issue.message}${locations}`;
      const current = grouped.get(issue.code) ?? { details: [], pluginIds: [] };
      grouped.set(issue.code, {
        details: [...current.details, detail],
        pluginIds: [...current.pluginIds, pluginId],
      });
    }
  }

  return [...grouped.entries()].map(([code, group]) => {
    const hasError = diagnostics.some(({ issues }) =>
      issues.some((issue) => issue.code === code && issue.severity === "error"),
    );
    return {
      id: ACTION_CHECK_IDS[code],
      state: hasError ? "error" : "warn",
      label: "Plugin admin action contracts",
      detail: group.details.join("; "),
      pluginIds: uniqueStrings(group.pluginIds),
      hint: withDoctorRerun(
        code === "untyped"
          ? "Declare a definition-level actions registry so doctor can verify action ids and result kinds without executing setup."
          : code === "unused"
            ? "Reference the action from declarative admin or remove it when it is not intentionally dispatch-only."
            : code === "unsafe-id"
              ? 'Rename the Admin action id so it is not "." or "..".'
              : "Align declarative admin action ids and expected kinds with the plugin's actions registry.",
      ),
    } satisfies CheckResult;
  });
}

function analyzeStaticPluginActions(
  plugin: PluginLike,
  normalized: OpsPluginEntry,
): NpPluginAdminActionIssue[] {
  const issues = npAnalyzePluginAdminActionContract(plugin.admin, normalized.actions);
  if (typeof plugin.setup !== "function") return issues;

  // Missing definition entries may be supplied by setup. Static doctor must
  // not claim they are absent without executing plugin code, but it should
  // keep them visible until runtime doctor confirms the actual registration.
  return issues.map((issue) =>
    issue.code === "missing"
      ? {
          ...issue,
          code: "untyped" as const,
          severity: "warning" as const,
          message:
            `Action "${issue.actionId}" may be registered dynamically during setup, so ` +
            "static doctor cannot verify that it exists or returns the expected result kind.",
        }
      : issue,
  );
}

function actionContractImportCheck(error: unknown): CheckResult | null {
  const detail = error instanceof Error ? error.message : String(error);
  const unsafe = detail.match(/^\[plugin:([^\]]+)\].*uses unsafe action id "(\.{1,2})"\.?$/u);
  if (unsafe) {
    return {
      id: ACTION_CHECK_IDS["unsafe-id"],
      state: "error",
      label: "Plugin admin action contracts",
      detail,
      pluginIds: unsafe[1] ? [unsafe[1]] : undefined,
      hint: withDoctorRerun(`Rename action "${unsafe[2] ?? "unknown"}" to a safe URL segment.`),
    };
  }
  const missing = detail.match(/^\[plugin:([^\]]+)\].*references missing action "([^"]+)"\.?$/u);
  if (missing) {
    return {
      id: ACTION_CHECK_IDS.missing,
      state: "error",
      label: "Plugin admin action contracts",
      detail,
      pluginIds: missing[1] ? [missing[1]] : undefined,
      hint: withDoctorRerun(
        `Declare action "${missing[2] ?? "unknown"}" in the ${missing[1] ?? "plugin"} definition-level actions registry.`,
      ),
    };
  }

  const mismatch = detail.match(
    /^\[plugin:([^\]]+)\].*expects a (metric|status|table) action, but "([^"]+)" is registered as (action|metric|status|table)\.?$/u,
  );
  if (mismatch) {
    return {
      id: ACTION_CHECK_IDS["kind-mismatch"],
      state: "error",
      label: "Plugin admin action contracts",
      detail,
      pluginIds: mismatch[1] ? [mismatch[1]] : undefined,
      hint: withDoctorRerun(
        `Change action "${mismatch[3] ?? "unknown"}" to kind ${mismatch[2] ?? "expected"}, or update the consuming admin surface.`,
      ),
    };
  }
  return null;
}

function apiRouteContractImportCheck(error: unknown): CheckResult | null {
  const detail = error instanceof Error ? error.message : String(error);
  const match = detail.match(
    /^\[plugin:([^\]]+)\] (?:routes must be an array|API route |duplicate API route )/u,
  );
  if (!match) return null;

  const duplicate = detail.includes("duplicate API route");
  return {
    id: duplicate ? "plugins.route_conflict" : "plugins.route_invalid",
    state: "error",
    label: "Plugin API route contracts",
    detail,
    pluginIds: match[1] ? [match[1]] : undefined,
    hint: withDoctorRerun(
      duplicate
        ? "A plugin can declare each method/path pair only once. Remove or rename the duplicate route."
        : "Use an uppercase supported method, a canonical static path, a function handler, and valid description/auth fields.",
    ),
  };
}

function pageRouteContractImportCheck(error: unknown): CheckResult | null {
  const detail = error instanceof Error ? error.message : String(error);
  const match = detail.match(
    /^\[plugin:([^\]]+)\] (?:pageRoutes must be an array|invalid page route |duplicate page route )/u,
  );
  if (!match) return null;

  const duplicate = detail.includes("duplicate page route");
  return {
    id: duplicate ? "plugins.page_route_duplicate" : "plugins.page_route_invalid",
    state: "error",
    label: "Plugin page route contracts",
    detail,
    pluginIds: match[1] ? [match[1]] : undefined,
    hint: withDoctorRerun(
      duplicate
        ? "A plugin can declare each page route pattern only once. Remove or rename the duplicate route."
        : "Use a canonical supported pattern, function component/metadata handlers, and valid surface/locale fields.",
    ),
  };
}

function blockContractImportCheck(error: unknown): CheckResult | null {
  const detail = error instanceof Error ? error.message : String(error);
  const match = detail.match(
    /^\[plugin:([^\]]+)\] (?:blocks must be an array|invalid block |duplicate block type )/u,
  );
  if (!match) return null;

  const duplicate = detail.includes("duplicate block type");
  return {
    id: duplicate ? "plugins.block_duplicate" : "plugins.block_invalid",
    state: "error",
    label: "Plugin block contracts",
    detail,
    pluginIds: match[1] ? [match[1]] : undefined,
    hint: withDoctorRerun(
      duplicate
        ? "A plugin can declare each block type only once. Remove or rename the duplicate block."
        : "Use a canonical block type, serializable metadata, a valid props schema, and a function renderer.",
    ),
  };
}

function patternContractImportCheck(error: unknown): CheckResult | null {
  const detail = error instanceof Error ? error.message : String(error);
  const match = detail.match(
    /^\[plugin:([^\]]+)\] (?:patterns must be an array|invalid pattern |duplicate pattern id )/u,
  );
  if (!match) return null;

  const duplicate = detail.includes("duplicate pattern id");
  return {
    id: duplicate ? "plugins.pattern_duplicate" : "plugins.pattern_invalid",
    state: "error",
    label: "Plugin pattern contracts",
    detail,
    pluginIds: match[1] ? [match[1]] : undefined,
    hint: withDoctorRerun(
      duplicate
        ? "A plugin can declare each pattern id only once. Remove or rename the duplicate pattern."
        : "Use canonical pattern metadata and a non-empty recursive tree of serializable block instances.",
    ),
  };
}

function scheduledTaskContractImportCheck(error: unknown): CheckResult | null {
  const detail = error instanceof Error ? error.message : String(error);
  const match = detail.match(
    /^\[plugin:([^\]]+)\] (?:scheduled must be an array|invalid scheduled task |duplicate scheduled task id )/u,
  );
  if (!match) return null;

  const duplicate = detail.includes("duplicate scheduled task id");
  return {
    id: duplicate ? "plugins.schedule_duplicate" : "plugins.schedule_invalid",
    state: "error",
    label: "Plugin scheduled task contracts",
    detail,
    pluginIds: match[1] ? [match[1]] : undefined,
    hint: withDoctorRerun(
      duplicate
        ? "A plugin can declare each scheduled task id only once. Remove or rename the duplicate task."
        : "Use a safe task id, a valid five-field UTC cron, a function handler, and a valid description.",
    ),
  };
}

function duplicateChecks(
  id: string,
  label: string,
  keys: Array<{ key: string; plugin: string }>,
  resolution: string,
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
      .map(([key, plugins]) => `${key} is claimed by plugins ${plugins.join(", ")}`)
      .join("; "),
    hint: resolution,
    pluginIds: uniqueStrings(duplicates.flatMap(([, plugins]) => plugins)),
  };
}

function buildApiRouteChecks(
  pluginObjects: PluginLike[],
  plugins: OpsPluginEntry[],
): CheckResult[] {
  const invalidRoutes: string[] = [];
  const invalidPluginIds: string[] = [];
  const duplicateRoutes: string[] = [];
  const duplicatePluginIds: string[] = [];

  for (const [index, plugin] of pluginObjects.entries()) {
    const pluginId = plugins[index]?.id ?? `plugin-${index.toString()}`;
    if (plugin.routes === undefined) continue;
    if (!Array.isArray(plugin.routes)) {
      invalidRoutes.push(`[plugin:${pluginId}] routes must be an array`);
      invalidPluginIds.push(pluginId);
      continue;
    }

    const seen = new Set<string>();
    for (const [routeIndex, route] of plugin.routes.entries()) {
      const validation = npValidatePluginApiRouteDefinition(route);
      if (!validation.ok) {
        invalidRoutes.push(
          `[plugin:${pluginId}] API route at index ${routeIndex.toString()}: ${validation.message}`,
        );
        invalidPluginIds.push(pluginId);
        continue;
      }

      const key = routeKey(route);
      if (!key) continue;
      if (seen.has(key)) {
        duplicateRoutes.push(`[plugin:${pluginId}] ${key} is declared more than once`);
        duplicatePluginIds.push(pluginId);
      }
      seen.add(key);
    }
  }

  const checks: CheckResult[] = [];
  if (invalidRoutes.length > 0) {
    checks.push({
      id: "plugins.route_invalid",
      state: "error",
      label: "Plugin API route contracts",
      detail: invalidRoutes.join("; "),
      hint: withDoctorRerun(
        "Use an uppercase supported method, a canonical static path, a function handler, and valid description/auth fields.",
      ),
      pluginIds: uniqueStrings(invalidPluginIds),
    });
  }
  if (duplicateRoutes.length > 0) {
    checks.push({
      id: "plugins.route_conflict",
      state: "error",
      label: "Plugin API routes",
      detail: duplicateRoutes.join("; "),
      hint: withDoctorRerun(
        "A plugin can declare each method/path pair only once. Remove or rename the duplicate route.",
      ),
      pluginIds: uniqueStrings(duplicatePluginIds),
    });
  }
  return checks;
}

function buildBlockChecks(pluginObjects: PluginLike[], plugins: OpsPluginEntry[]): CheckResult[] {
  const invalidBlocks: string[] = [];
  const invalidPluginIds: string[] = [];
  const duplicateBlocks: string[] = [];
  const duplicatePluginIds: string[] = [];

  for (const [index, plugin] of pluginObjects.entries()) {
    if (plugin.blocks === undefined) continue;
    const pluginId = plugins[index]?.id ?? `plugin-${index.toString()}`;
    for (const issue of npAnalyzeBlockDefinitions(plugin.blocks)) {
      const detail = `[plugin:${pluginId}] ${issue.message}`;
      if (issue.code === "duplicate-type") {
        duplicateBlocks.push(detail);
        duplicatePluginIds.push(pluginId);
      } else {
        invalidBlocks.push(detail);
        invalidPluginIds.push(pluginId);
      }
    }
  }

  const checks: CheckResult[] = [];
  if (invalidBlocks.length > 0) {
    checks.push({
      id: "plugins.block_invalid",
      state: "error",
      label: "Plugin block contracts",
      detail: invalidBlocks.join("; "),
      hint: withDoctorRerun(
        "Use a canonical block type, serializable metadata, a valid props schema, and a function renderer.",
      ),
      pluginIds: uniqueStrings(invalidPluginIds),
    });
  }
  if (duplicateBlocks.length > 0) {
    checks.push({
      id: "plugins.block_duplicate",
      state: "error",
      label: "Plugin block types",
      detail: duplicateBlocks.join("; "),
      hint: withDoctorRerun(
        "A plugin can declare each block type only once. Remove or rename the duplicate block.",
      ),
      pluginIds: uniqueStrings(duplicatePluginIds),
    });
  }
  return checks;
}

function buildPatternChecks(pluginObjects: PluginLike[], plugins: OpsPluginEntry[]): CheckResult[] {
  const invalidPatterns: string[] = [];
  const invalidPluginIds: string[] = [];
  const duplicatePatterns: string[] = [];
  const duplicatePluginIds: string[] = [];
  const knownBlockTypes = new Set([
    ...getDefaultBlocks().map((block) => block.type),
    ...pluginObjects.flatMap((plugin) =>
      readArray(plugin.blocks).flatMap((block) => {
        const key = blockKey(block);
        return key && npValidateBlockDefinition(block).ok ? [key] : [];
      }),
    ),
  ]);

  for (const [index, plugin] of pluginObjects.entries()) {
    if (plugin.patterns === undefined) continue;
    const pluginId = plugins[index]?.id ?? `plugin-${index.toString()}`;
    for (const issue of npAnalyzePatternDefinitions(plugin.patterns, { knownBlockTypes })) {
      const detail = `[plugin:${pluginId}] ${issue.message}`;
      if (issue.code === "duplicate-id") {
        duplicatePatterns.push(detail);
        duplicatePluginIds.push(pluginId);
      } else {
        invalidPatterns.push(detail);
        invalidPluginIds.push(pluginId);
      }
    }
  }

  const checks: CheckResult[] = [];
  if (invalidPatterns.length > 0) {
    checks.push({
      id: "plugins.pattern_invalid",
      state: "error",
      label: "Plugin pattern contracts",
      detail: invalidPatterns.join("; "),
      hint: withDoctorRerun(
        "Use canonical pattern metadata and a non-empty recursive tree of serializable block instances.",
      ),
      pluginIds: uniqueStrings(invalidPluginIds),
    });
  }
  if (duplicatePatterns.length > 0) {
    checks.push({
      id: "plugins.pattern_duplicate",
      state: "error",
      label: "Plugin pattern ids",
      detail: duplicatePatterns.join("; "),
      hint: withDoctorRerun(
        "A plugin can declare each pattern id only once. Remove or rename the duplicate pattern.",
      ),
      pluginIds: uniqueStrings(duplicatePluginIds),
    });
  }
  return checks;
}

function buildScheduledTaskChecks(
  pluginObjects: PluginLike[],
  plugins: OpsPluginEntry[],
): CheckResult[] {
  const invalidTasks: string[] = [];
  const invalidPluginIds: string[] = [];
  const duplicateTasks: string[] = [];
  const duplicatePluginIds: string[] = [];

  for (const [index, plugin] of pluginObjects.entries()) {
    if (plugin.scheduled === undefined) continue;
    const pluginId = plugins[index]?.id ?? `plugin-${index.toString()}`;
    for (const issue of npAnalyzePluginScheduledTasks(plugin.scheduled)) {
      const detail = `[plugin:${pluginId}] ${issue.message}`;
      if (issue.code === "duplicate-id") {
        duplicateTasks.push(detail);
        duplicatePluginIds.push(pluginId);
      } else {
        invalidTasks.push(detail);
        invalidPluginIds.push(pluginId);
      }
    }
  }

  const checks: CheckResult[] = [];
  if (invalidTasks.length > 0) {
    checks.push({
      id: "plugins.schedule_invalid",
      state: "error",
      label: "Plugin scheduled task contracts",
      detail: invalidTasks.join("; "),
      hint: withDoctorRerun(
        "Use a safe task id, a valid five-field UTC cron, a function handler, and a valid description.",
      ),
      pluginIds: uniqueStrings(invalidPluginIds),
    });
  }
  if (duplicateTasks.length > 0) {
    checks.push({
      id: "plugins.schedule_duplicate",
      state: "error",
      label: "Plugin scheduled task ids",
      detail: duplicateTasks.join("; "),
      hint: withDoctorRerun(
        "A plugin can declare each scheduled task id only once. Remove or rename the duplicate task.",
      ),
      pluginIds: uniqueStrings(duplicatePluginIds),
    });
  }
  return checks;
}

function buildPageRouteChecks(
  pluginObjects: PluginLike[],
  plugins: OpsPluginEntry[],
): CheckResult[] {
  const invalidRoutes: string[] = [];
  const invalidPluginIds: string[] = [];
  const duplicateRoutes: string[] = [];
  const duplicatePluginIds: string[] = [];

  for (const [index, plugin] of pluginObjects.entries()) {
    const pluginId = plugins[index]?.id ?? `plugin-${index.toString()}`;
    if (plugin.pageRoutes === undefined) continue;
    if (!Array.isArray(plugin.pageRoutes)) {
      invalidRoutes.push(`[plugin:${pluginId}] pageRoutes must be an array`);
      invalidPluginIds.push(pluginId);
      continue;
    }

    const seen = new Set<string>();
    for (const [routeIndex, route] of plugin.pageRoutes.entries()) {
      const validation = npValidatePluginPageRouteDefinition(route);
      if (!validation.ok) {
        invalidRoutes.push(
          `[plugin:${pluginId}] page route at index ${routeIndex.toString()}: ${validation.message}`,
        );
        invalidPluginIds.push(pluginId);
        continue;
      }

      const key = pageRouteKey(route);
      if (!key) continue;
      if (seen.has(key)) {
        duplicateRoutes.push(`[plugin:${pluginId}] ${key} is declared more than once`);
        duplicatePluginIds.push(pluginId);
      }
      seen.add(key);
    }
  }

  const checks: CheckResult[] = [];
  if (invalidRoutes.length > 0) {
    checks.push({
      id: "plugins.page_route_invalid",
      state: "error",
      label: "Plugin page route contracts",
      detail: invalidRoutes.join("; "),
      hint: withDoctorRerun(
        "Use a canonical supported pattern, function component/metadata handlers, and valid surface/locale fields.",
      ),
      pluginIds: uniqueStrings(invalidPluginIds),
    });
  }
  if (duplicateRoutes.length > 0) {
    checks.push({
      id: "plugins.page_route_duplicate",
      state: "error",
      label: "Plugin page routes",
      detail: duplicateRoutes.join("; "),
      hint: withDoctorRerun(
        "A plugin can declare each page route pattern only once. Remove or rename the duplicate route.",
      ),
      pluginIds: uniqueStrings(duplicatePluginIds),
    });
  }
  return checks;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function duplicateCheckPluginIds(check: CheckResult): string[] {
  if (!check.detail?.includes("claimed by plugins")) return [];
  return check.detail.split(";").flatMap((part) => {
    const match = part.match(/claimed by plugins\s+(.+)$/u);
    if (!match) return [];
    return (match[1] ?? "")
      .split(",")
      .map((plugin) => plugin.trim())
      .filter(Boolean);
  });
}

function buildOpsPluginNextCommands(
  status: OpsPluginsJson["status"],
  checks: CheckResult[],
  plugins: OpsPluginEntry[],
): string[] {
  if (status === "ready") return [];

  const targetedInspectCommands = checks.flatMap((check) =>
    uniqueStrings([...(check.pluginIds ?? []), ...duplicateCheckPluginIds(check)]).map(
      (pluginId) => `nexpress ops plugins inspect ${pluginId} --json`,
    ),
  );
  if (targetedInspectCommands.length > 0) {
    return uniqueStrings([...targetedInspectCommands, OPS_PLUGINS_DOCTOR_COMMAND]);
  }

  const firstPlugin = plugins[0];
  if (firstPlugin) {
    return uniqueStrings([
      `nexpress ops plugins inspect ${firstPlugin.id} --json`,
      OPS_PLUGINS_DOCTOR_COMMAND,
    ]);
  }

  return ["nexpress ops plugins list --json"];
}

function summarize(checks: CheckResult[], plugins: OpsPluginEntry[]): OpsPluginsSummary {
  return {
    plugins: plugins.length,
    blocks: plugins.reduce((total, plugin) => total + plugin.blocks.length, 0),
    patterns: plugins.reduce((total, plugin) => total + plugin.patterns.length, 0),
    routes: plugins.reduce((total, plugin) => total + plugin.routes.length, 0),
    pageRoutes: plugins.reduce((total, plugin) => total + plugin.pageRoutes.length, 0),
    scheduled: plugins.reduce((total, plugin) => total + plugin.scheduled.length, 0),
    actions: plugins.reduce((total, plugin) => total + plugin.actions.length, 0),
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
    patterns: readArray(plugin.patterns)
      .map(patternKey)
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
    actions: readActionDefinitions(plugin.actions),
  };
}

function withDoctorRerun(action: string): string {
  return `${action} Then rerun \`${OPS_PLUGINS_DOCTOR_COMMAND}\` or \`${OPS_PLUGINS_PROJECT_DOCTOR_COMMAND}\` from a generated project.`;
}

export function buildOpsPluginsJson(args: {
  checks: CheckResult[];
  plugins: OpsPluginEntry[];
}): OpsPluginsJson {
  const summary = summarize(args.checks, args.plugins);
  const status = summary.errors > 0 ? "blocked" : summary.warnings > 0 ? "attention" : "ready";
  const nextCommands = buildOpsPluginNextCommands(status, args.checks, args.plugins);
  const nextCommand = nextCommands[0] ?? null;
  return {
    schemaVersion: "np.ops-plugins.v1",
    ok: summary.errors === 0,
    status,
    summary,
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    plan: {
      nextCommands,
      projectNextCommands: nextCommands.map(toProjectCommand),
    },
    checks: args.checks,
    plugins: args.plugins,
  };
}

function checkMentionsPlugin(check: CheckResult, pluginId: string): boolean {
  if (check.pluginIds && check.pluginIds.length > 0) {
    return check.pluginIds.includes(pluginId);
  }
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
        patterns: 0,
        routes: 0,
        pageRoutes: 0,
        scheduled: 0,
        actions: 0,
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
    plan: {
      nextCommands: [nextCommand],
      projectNextCommands: [toProjectCommand(nextCommand)],
    },
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
      hint: withDoctorRerun(
        "Add `plugins: []` to defineConfig, or run this from a generated NexPress project root.",
      ),
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
      hint: withDoctorRerun(
        "Every plugin entry should be a definePlugin(...) object exported by the plugin package.",
      ),
    });
  }

  const missingManifest = pluginObjects.filter((plugin) => !isObject(plugin.manifest)).length;
  if (missingManifest > 0) {
    checks.push({
      id: "plugins.manifest",
      state: "error",
      label: "Plugin manifests",
      detail: `${missingManifest.toString()} plugins are missing manifest metadata`,
      hint: withDoctorRerun(
        "Use definePlugin() from @nexpress/plugin-sdk so manifest metadata is present at boot.",
      ),
    });
  }

  checks.push(
    ...buildActionChecks(
      pluginObjects.map((plugin, index) => {
        const normalized = normalizePlugin(plugin, index);
        return {
          pluginId: normalized.id,
          issues: analyzeStaticPluginActions(plugin, normalized),
        };
      }),
    ),
    ...buildBlockChecks(pluginObjects, plugins),
    ...buildPatternChecks(pluginObjects, plugins),
    ...buildApiRouteChecks(pluginObjects, plugins),
    ...buildPageRouteChecks(pluginObjects, plugins),
    ...buildScheduledTaskChecks(pluginObjects, plugins),
  );

  const duplicateIds = duplicateChecks(
    "plugins.duplicate_id",
    "Plugin IDs",
    plugins.map((plugin) => ({ key: plugin.id, plugin: plugin.id })),
    withDoctorRerun(
      "Plugin manifest ids must be unique. Rename one plugin id or remove one registration, then restart.",
    ),
  );
  if (duplicateIds) checks.push(duplicateIds);

  const blockConflicts = duplicateChecks(
    "plugins.block_conflict",
    "Plugin block types",
    pluginObjects.flatMap((plugin, index) => {
      const pluginId = plugins[index]?.id ?? `plugin-${index.toString()}`;
      const validKeys = readArray(plugin.blocks).flatMap((block) => {
        const validation = npValidateBlockDefinition(block);
        const key = blockKey(block);
        return validation.ok && key ? [key] : [];
      });
      return [...new Set(validKeys)].map((key) => ({ key, plugin: pluginId }));
    }),
    withDoctorRerun(
      "Block type names share one registry. Rename one block type or disable one plugin, then rebuild.",
    ),
  );
  if (blockConflicts) checks.push(blockConflicts);

  const patternConflicts = duplicateChecks(
    "plugins.pattern_conflict",
    "Plugin pattern ids",
    pluginObjects.flatMap((plugin, index) => {
      const pluginId = plugins[index]?.id ?? `plugin-${index.toString()}`;
      const validKeys = readArray(plugin.patterns).flatMap((pattern) => {
        const validation = npValidatePatternDefinition(pattern);
        const key = patternKey(pattern);
        return validation.ok && key ? [key] : [];
      });
      return [...new Set(validKeys)].map((key) => ({ key, plugin: pluginId }));
    }),
    withDoctorRerun(
      "Pattern ids share one registry. Namespace one pattern id or disable one plugin, then rebuild.",
    ),
  );
  if (patternConflicts) checks.push(patternConflicts);

  const pageRouteConflicts = duplicateChecks(
    "plugins.page_route_conflict",
    "Plugin page routes",
    plugins.flatMap((plugin) =>
      [...new Set(plugin.pageRoutes)].map((key) => ({ key, plugin: plugin.id })),
    ),
    withDoctorRerun(
      "Plugin page routes share the public site router. Change one pattern or disable one plugin, then restart.",
    ),
  );
  if (pageRouteConflicts) checks.push(pageRouteConflicts);

  return buildOpsPluginsJson({ checks, plugins });
}

export function resolveNexpressConfigPath(cwd = resolveRuntimePath("")): string | null {
  for (const candidate of CONFIG_CANDIDATES) {
    const full = resolve(cwd, candidate);
    if (runtimeExists(full)) return full;
  }
  return null;
}

export async function collectOpsPluginsStatus(
  cwd = resolveRuntimePath(""),
): Promise<OpsPluginsJson> {
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
          hint: withDoctorRerun(
            "Run this from the project root or add src/nexpress.config.ts before checking plugins.",
          ),
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
    const actionCheck = actionContractImportCheck(error);
    const apiRouteCheck = apiRouteContractImportCheck(error);
    const pageRouteCheck = pageRouteContractImportCheck(error);
    const blockCheck = blockContractImportCheck(error);
    const patternCheck = patternContractImportCheck(error);
    const scheduledTaskCheck = scheduledTaskContractImportCheck(error);
    return buildOpsPluginsJson({
      plugins: [],
      checks: [
        {
          id: "plugins.config_file",
          state: "error",
          label: "nexpress.config.ts",
          detail: error instanceof Error ? error.message : String(error),
          hint: withDoctorRerun("Fix the config import error."),
        },
        ...(actionCheck ? [actionCheck] : []),
        ...(blockCheck ? [blockCheck] : []),
        ...(patternCheck ? [patternCheck] : []),
        ...(apiRouteCheck ? [apiRouteCheck] : []),
        ...(pageRouteCheck ? [pageRouteCheck] : []),
        ...(scheduledTaskCheck ? [scheduledTaskCheck] : []),
      ],
    });
  }
}

function readPackageDependencies(
  cwd = resolveRuntimePath(""),
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
    if (!runtimeExists(packageJsonPath)) continue;
    try {
      const pkg = JSON.parse(runtimeReadTextFile(packageJsonPath)) as Record<string, unknown>;
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
      command: OPS_PLUGINS_DOCTOR_COMMAND,
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
    `${state}: ${report.summary.plugins.toString()} plugins, ${report.summary.actions.toString()} actions, ${report.summary.blocks.toString()} blocks, ${report.summary.routes.toString()} API routes, ${report.summary.pageRoutes.toString()} page routes`,
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
      if (plugin.actions.length > 0) {
        lines.push(
          `actions: ${plugin.actions.map((action) => `${action.id} (${action.kind})`).join(", ")}`,
        );
      }
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
      if (check.hint && check.state !== "ok") lines.push(`  hint: ${check.hint}`);
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  const additionalNextCommands = report.plan.nextCommands.filter(
    (command) => command !== report.nextCommand,
  );
  if (additionalNextCommands.length > 0) {
    lines.push("Next commands:");
    for (const command of additionalNextCommands) lines.push(`  - ${command}`);
  }
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  const additionalProjectCommands = report.plan.projectNextCommands.filter(
    (command, index) =>
      command !== report.projectNextCommand && command !== report.plan.nextCommands[index],
  );
  if (additionalProjectCommands.length > 0) {
    lines.push("Project next commands:");
    for (const command of additionalProjectCommands) lines.push(`  - ${command}`);
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

async function readPluginEnabledState(
  env: OpsPluginsEnv,
  pluginId: string,
): Promise<
  | { ok: true; enabled: boolean | null }
  | { ok: false; reason: "missing-url" | "query-failed"; detail: string }
> {
  const url = env.DATABASE_URL;
  if (!url) return { ok: false, reason: "missing-url", detail: "DATABASE_URL not set" };
  const pg = loadPg();
  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const result = await client.query<{ enabled: boolean }>(
      "select enabled from np_plugins where id = $1 limit 1",
      [pluginId],
    );
    await client.end();
    return { ok: true, enabled: result.rows[0]?.enabled ?? null };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      ok: false,
      reason: "query-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writePluginEnabledState(
  env: OpsPluginsEnv,
  pluginId: string,
  enabled: boolean,
): Promise<{ ok: true; enabled: boolean } | { ok: false; detail: string }> {
  const url = env.DATABASE_URL;
  if (!url) return { ok: false, detail: "DATABASE_URL not set" };
  const pg = loadPg();
  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const result = await client.query<{ enabled: boolean }>(
      `insert into np_plugins (id, enabled, installed_at, updated_at)
       values ($1, $2, now(), now())
       on conflict (id) do update set enabled = excluded.enabled, updated_at = now()
       returning enabled`,
      [pluginId, enabled],
    );
    await client.end();
    return { ok: true, enabled: result.rows[0]?.enabled ?? enabled };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function countChecks(checks: CheckResult[]): { errors: number; warnings: number } {
  return {
    errors: checks.filter((check) => check.state === "error").length,
    warnings: checks.filter((check) => check.state === "warn").length,
  };
}

export async function runOpsPluginsMutation(args: {
  action: "enable" | "disable";
  pluginId: string;
  execute?: boolean;
  approve?: string | null;
  out?: string | null;
  env?: OpsPluginsEnv;
  cwd?: string;
}): Promise<OpsPluginsMutationJson> {
  const env = args.env ?? process.env;
  const startedAt = new Date();
  const requiredApproval = `plugin-${args.action}`;
  const artifactPath =
    args.out ??
    (args.execute
      ? defaultOpsArtifactPath("plugins", `${args.action}-${args.pluginId}`, startedAt)
      : null);
  const inventory = await collectOpsPluginsStatus(args.cwd);
  const plugin = inventory.plugins.find((entry) => entry.id === args.pluginId) ?? null;
  const checks: CheckResult[] = [
    ...inventory.checks,
    plugin
      ? {
          id: "plugins.mutation.plugin",
          state: "ok",
          label: "Plugin mutation target",
          detail: args.pluginId,
        }
      : {
          id: "plugins.mutation.plugin",
          state: "error",
          label: "Plugin mutation target",
          detail: `No configured plugin has id ${args.pluginId}`,
          hint: "Only plugins registered in nexpress.config.ts can be enabled or disabled.",
        },
  ];
  const desiredEnabled = args.action === "enable";
  let enabled: boolean | null = null;
  let mutationError: string | null = null;

  if (!args.execute) {
    const current = await readPluginEnabledState(env, args.pluginId);
    if (current.ok) {
      enabled = current.enabled ?? true;
      checks.push({
        id: "plugins.mutation.current_state",
        state: "ok",
        label: "Plugin DB state",
        detail:
          current.enabled === null ? "missing row, defaults enabled" : String(current.enabled),
      });
    } else {
      checks.push({
        id: "plugins.mutation.current_state",
        state: "warn",
        label: "Plugin DB state",
        detail: current.detail,
      });
    }
  } else if (args.approve !== requiredApproval) {
    mutationError = `Missing --approve ${requiredApproval}`;
    checks.push({
      id: "plugins.mutation.approval",
      state: "error",
      label: "Plugin mutation approval",
      detail: mutationError,
    });
  } else if (plugin) {
    const written = await writePluginEnabledState(env, args.pluginId, desiredEnabled);
    if (written.ok) {
      enabled = written.enabled;
      invalidatePluginEnabled(args.pluginId);
      checks.push({
        id: "plugins.mutation.write",
        state: "ok",
        label: "Plugin DB state",
        detail: `${args.pluginId} enabled=${String(written.enabled)}`,
      });
    } else {
      mutationError = written.detail;
      checks.push({
        id: "plugins.mutation.write",
        state: "error",
        label: "Plugin DB state",
        detail: written.detail,
      });
    }
  }

  const nextCommand = args.execute
    ? "nexpress ops plugins doctor --json"
    : `nexpress ops plugins ${args.action} ${args.pluginId} --execute --approve ${requiredApproval} --json`;
  const counts = countChecks(checks);
  const status = counts.errors > 0 ? "blocked" : counts.warnings > 0 ? "attention" : "ready";
  const report: OpsPluginsMutationJson = {
    schemaVersion: "np.ops-plugins-mutation.v1",
    ok: counts.errors === 0,
    status,
    action: args.action,
    pluginId: args.pluginId,
    enabled,
    mutation: buildOpsMutationAudit({
      action: `plugins.${args.action}`,
      execute: args.execute,
      approve: args.approve,
      requiredApproval,
      artifactPath,
      applied: Boolean(args.execute && counts.errors === 0),
      error: mutationError,
      rollbackHint: `Run nexpress ops plugins ${desiredEnabled ? "disable" : "enable"} ${args.pluginId} --execute --approve plugin-${desiredEnabled ? "disable" : "enable"} --json`,
      nextCommand,
      startedAt,
      completedAt: new Date(),
    }),
    nextCommand,
    projectNextCommand: toProjectCommand(nextCommand),
    checks,
    plugin,
  };
  if (artifactPath) await writeOpsJsonArtifact(artifactPath, report);
  return report;
}

export function renderBriefOpsPluginsMutation(
  report: OpsPluginsMutationJson,
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
    `${c.dim}NexPress ops plugins ${report.action}${c.reset}`,
    `${state}: ${report.pluginId} enabled=${String(report.enabled)}`,
  ];
  for (const check of report.checks) {
    const parts = [formatBriefState(check.state, options.color), check.id, check.label];
    if (check.detail) parts.push(`- ${check.detail.replace(/\s+/g, " ")}`);
    lines.push(parts.join(" "));
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
