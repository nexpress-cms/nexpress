import { getRegisteredBlocks } from "@nexpress/blocks";
import {
  getAllPluginIds,
  getPluginAdminActionDiagnostics,
  getPluginPageRoutes,
  getPluginRegistration,
  getPluginRoutes,
  getRegisteredPluginActions,
  type NpPluginAdminActionIssue,
  type NpRegisteredPluginAction,
  type PluginPageRouteEntry,
  type PluginRouteHandler,
} from "@nexpress/core";

import type { CheckResult } from "../scripts/doctor-readiness";
import type { OpsPluginEntry, OpsPluginsJson } from "../scripts/ops-plugins-core";
import { toProjectCommand } from "../scripts/ops-command-format";

interface RuntimePluginRegistration {
  name?: string;
  version?: string;
  description?: string;
  capabilities?: readonly string[];
  allowedHosts?: readonly string[];
  schedules?: Map<string, unknown>;
}

interface RuntimePageRoute {
  pluginId: string;
  route: PluginPageRouteEntry;
}

export function collectRuntimeOpsPluginsStatus(): OpsPluginsJson {
  const pluginIds = getAllPluginIds();
  const routesByPlugin = groupRoutesByPlugin(getPluginRoutes());
  const pageRoutesByPlugin = groupPageRoutesByPlugin(getPluginPageRoutes());
  const blocksByPlugin = groupRegisteredBlocksByPlugin();
  const plugins = pluginIds.map((pluginId, index) =>
    buildRuntimePluginEntry({
      pluginId,
      index,
      actions: getRegisteredPluginActions(pluginId),
      routes: routesByPlugin.get(pluginId) ?? [],
      pageRoutes: pageRoutesByPlugin.get(pluginId) ?? [],
      blocks: blocksByPlugin.get(pluginId) ?? [],
    }),
  );

  return buildRuntimeOpsPluginsJson({
    plugins,
    checks: buildRuntimeChecks({
      pluginIds,
      plugins,
      routesByPlugin,
      pageRoutesByPlugin,
      blocksByPlugin,
      actionDiagnostics: pluginIds.map((pluginId) => ({
        pluginId,
        issues: getPluginAdminActionDiagnostics(pluginId),
      })),
    }),
  });
}

function buildRuntimePluginEntry(args: {
  pluginId: string;
  index: number;
  actions: NpRegisteredPluginAction[];
  routes: PluginRouteHandler[];
  pageRoutes: RuntimePageRoute[];
  blocks: string[];
}): OpsPluginEntry {
  const registration = getPluginRegistration(args.pluginId) as
    RuntimePluginRegistration | undefined;
  const scheduled = scheduledTaskIds(registration);

  return {
    index: args.index,
    id: args.pluginId,
    apiVersion: null,
    name: registration?.name ?? args.pluginId,
    version: registration?.version ?? null,
    description: registration?.description ?? null,
    author: null,
    license: null,
    nexpress: { minVersion: null, maxVersion: null },
    capabilities: [...(registration?.capabilities ?? [])],
    allowedHosts: [...(registration?.allowedHosts ?? [])],
    requires: [],
    provides: {
      blocks: args.blocks,
      fields: [],
      collections: [],
      adminExtensions: [],
      actions: args.actions.map((action) => action.id),
      apiRoutes: routeKeys(args.routes),
      pageRoutes: pageRouteKeys(args.pageRoutes),
      scheduledTasks: scheduled,
      hooks: [],
    },
    agent: { description: null, category: null, tags: [] },
    usesTokens: [],
    styleSlots: [],
    blocks: args.blocks,
    routes: routeKeys(args.routes),
    pageRoutes: pageRouteKeys(args.pageRoutes),
    scheduled,
    actions: args.actions,
  };
}

function buildRuntimeChecks(args: {
  pluginIds: string[];
  plugins: OpsPluginEntry[];
  routesByPlugin: Map<string, PluginRouteHandler[]>;
  pageRoutesByPlugin: Map<string, RuntimePageRoute[]>;
  blocksByPlugin: Map<string, string[]>;
  actionDiagnostics: Array<{ pluginId: string; issues: NpPluginAdminActionIssue[] }>;
}): CheckResult[] {
  const pageRouteConflicts = duplicateCheck(
    "plugins.runtime_page_route_conflict",
    "Runtime plugin page routes",
    args.plugins.flatMap((plugin) => plugin.pageRoutes.map((key) => ({ key, plugin: plugin.id }))),
    "Plugin page routes share the public site router. Change one pattern or disable one plugin, then restart.",
  );
  const blockConflicts = duplicateCheck(
    "plugins.runtime_block_conflict",
    "Runtime plugin block types",
    args.plugins.flatMap((plugin) => plugin.blocks.map((key) => ({ key, plugin: plugin.id }))),
    "Block type names share one registry. Rename one block type or disable one plugin, then restart.",
  );

  return [
    {
      id: "plugins.runtime_registry",
      state: "ok",
      label: "Runtime plugin registry",
      detail: `${args.pluginIds.length.toString()} loaded plugin${
        args.pluginIds.length === 1 ? "" : "s"
      }`,
    },
    {
      id: "plugins.runtime_routes",
      state: "ok",
      label: "Runtime plugin API routes",
      detail: `${countGrouped(args.routesByPlugin).toString()} route${
        countGrouped(args.routesByPlugin) === 1 ? "" : "s"
      }`,
    },
    {
      id: "plugins.runtime_page_routes",
      state: "ok",
      label: "Runtime plugin page routes",
      detail: `${countGrouped(args.pageRoutesByPlugin).toString()} page route${
        countGrouped(args.pageRoutesByPlugin) === 1 ? "" : "s"
      }`,
    },
    {
      id: "plugins.runtime_blocks",
      state: "ok",
      label: "Runtime plugin blocks",
      detail: `${countGrouped(args.blocksByPlugin).toString()} block${
        countGrouped(args.blocksByPlugin) === 1 ? "" : "s"
      } visible in the shared registry`,
    },
    ...buildRuntimeActionChecks(args.actionDiagnostics),
    ...[pageRouteConflicts, blockConflicts].filter((check): check is CheckResult => Boolean(check)),
  ];
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

function buildRuntimeActionChecks(
  diagnostics: Array<{ pluginId: string; issues: NpPluginAdminActionIssue[] }>,
): CheckResult[] {
  const grouped = new Map<
    NpPluginAdminActionIssue["code"],
    { details: string[]; pluginIds: string[] }
  >();
  for (const { pluginId, issues } of diagnostics) {
    for (const issue of issues) {
      const locations = issue.locations.length > 0 ? ` (${issue.locations.join(", ")})` : "";
      const current = grouped.get(issue.code) ?? { details: [], pluginIds: [] };
      grouped.set(issue.code, {
        details: [...current.details, `${pluginId}: ${issue.message}${locations}`],
        pluginIds: [...current.pluginIds, pluginId],
      });
    }
  }

  return [...grouped.entries()].map(([code, group]) => ({
    id: ACTION_CHECK_IDS[code],
    state: diagnostics.some(({ issues }) =>
      issues.some((issue) => issue.code === code && issue.severity === "error"),
    )
      ? "error"
      : "warn",
    label: "Runtime plugin admin action contracts",
    detail: group.details.join("; "),
    pluginIds: uniqueStrings(group.pluginIds),
    hint:
      code === "untyped"
        ? "Use a definition-level action or the matching typed setup registration helper."
        : code === "unused"
          ? "Reference the action from declarative admin or keep it only when dispatch-only use is intentional."
          : code === "unsafe-id"
            ? 'Rename the Admin action id so it is not "." or "..".'
            : "Align declarative admin action ids and expected kinds with runtime registrations, then restart.",
  }));
}

function groupRoutesByPlugin(routes: PluginRouteHandler[]): Map<string, PluginRouteHandler[]> {
  const byPlugin = new Map<string, PluginRouteHandler[]>();
  for (const route of routes) {
    const existing = byPlugin.get(route.pluginId) ?? [];
    existing.push(route);
    byPlugin.set(route.pluginId, existing);
  }
  return byPlugin;
}

function groupPageRoutesByPlugin(routes: RuntimePageRoute[]): Map<string, RuntimePageRoute[]> {
  const byPlugin = new Map<string, RuntimePageRoute[]>();
  for (const route of routes) {
    const existing = byPlugin.get(route.pluginId) ?? [];
    existing.push(route);
    byPlugin.set(route.pluginId, existing);
  }
  return byPlugin;
}

function groupRegisteredBlocksByPlugin(): Map<string, string[]> {
  const byPlugin = new Map<string, string[]>();
  for (const block of getRegisteredBlocks()) {
    const pluginId = readPluginSource(block.source);
    if (!pluginId) continue;
    const existing = byPlugin.get(pluginId) ?? [];
    existing.push(block.type);
    byPlugin.set(pluginId, existing);
  }
  return byPlugin;
}

function readPluginSource(source: unknown): string | null {
  if (typeof source !== "string") return null;
  const prefix = "plugin:";
  return source.startsWith(prefix) && source.length > prefix.length
    ? source.slice(prefix.length)
    : null;
}

function scheduledTaskIds(registration: RuntimePluginRegistration | undefined): string[] {
  return [...(registration?.schedules?.keys() ?? [])].sort();
}

function routeKeys(routes: PluginRouteHandler[]): string[] {
  return routes.map((route) => `${route.method.toUpperCase()} ${route.path}`).sort();
}

function pageRouteKeys(routes: RuntimePageRoute[]): string[] {
  return routes.map((route) => route.route.pattern).sort();
}

function duplicateCheck(
  id: string,
  label: string,
  keys: Array<{ key: string; plugin: string }>,
  hint: string,
): CheckResult | null {
  const owners = new Map<string, string[]>();
  for (const item of keys) {
    owners.set(item.key, [...(owners.get(item.key) ?? []), item.plugin]);
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
    hint,
    pluginIds: uniqueStrings(duplicates.flatMap(([, plugins]) => plugins)),
  };
}

function countGrouped<T>(grouped: Map<string, T[]>): number {
  return [...grouped.values()].reduce((total, values) => total + values.length, 0);
}

function buildRuntimeOpsPluginsJson(args: {
  checks: CheckResult[];
  plugins: OpsPluginEntry[];
}): OpsPluginsJson {
  const summary = {
    plugins: args.plugins.length,
    blocks: args.plugins.reduce((total, plugin) => total + plugin.blocks.length, 0),
    routes: args.plugins.reduce((total, plugin) => total + plugin.routes.length, 0),
    pageRoutes: args.plugins.reduce((total, plugin) => total + plugin.pageRoutes.length, 0),
    scheduled: args.plugins.reduce((total, plugin) => total + plugin.scheduled.length, 0),
    actions: args.plugins.reduce((total, plugin) => total + plugin.actions.length, 0),
    warnings: args.checks.filter((check) => check.state === "warn").length,
    errors: args.checks.filter((check) => check.state === "error").length,
  };
  const status = summary.errors > 0 ? "blocked" : summary.warnings > 0 ? "attention" : "ready";
  const nextCommands = buildRuntimeNextCommands(status, args.checks, args.plugins);
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

function buildRuntimeNextCommands(
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
    return uniqueStrings([...targetedInspectCommands, "nexpress ops plugins doctor --json"]);
  }
  const firstPlugin = plugins[0];
  return firstPlugin
    ? uniqueStrings([
        `nexpress ops plugins inspect ${firstPlugin.id} --json`,
        "nexpress ops plugins doctor --json",
      ])
    : ["nexpress ops plugins list --json"];
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
