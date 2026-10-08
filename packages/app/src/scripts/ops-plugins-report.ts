import type { NpRegisteredPluginAction } from "@nexpress/core";

import type { CheckResult } from "./doctor-readiness.js";
import { toProjectCommand } from "./ops-command-format";

const OPS_PLUGINS_DOCTOR_COMMAND = "nexpress ops plugins doctor --json";

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
    templates: string[];
    translations: string[];
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
  templates: string[];
  translations: string[];
  routes: string[];
  pageRoutes: string[];
  scheduled: string[];
  actions: NpRegisteredPluginAction[];
}

export interface OpsPluginsSummary {
  plugins: number;
  blocks: number;
  patterns: number;
  templates: number;
  translations: number;
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

export function buildOpsPluginsJson(args: {
  checks: CheckResult[];
  plugins: OpsPluginEntry[];
}): OpsPluginsJson {
  const summary = summarizeOpsPlugins(args.checks, args.plugins);
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

export function summarizeOpsPlugins(
  checks: CheckResult[],
  plugins: OpsPluginEntry[],
): OpsPluginsSummary {
  return {
    plugins: plugins.length,
    blocks: plugins.reduce((total, plugin) => total + plugin.blocks.length, 0),
    patterns: plugins.reduce((total, plugin) => total + plugin.patterns.length, 0),
    templates: plugins.reduce((total, plugin) => total + plugin.templates.length, 0),
    translations: plugins.reduce((total, plugin) => total + plugin.translations.length, 0),
    routes: plugins.reduce((total, plugin) => total + plugin.routes.length, 0),
    pageRoutes: plugins.reduce((total, plugin) => total + plugin.pageRoutes.length, 0),
    scheduled: plugins.reduce((total, plugin) => total + plugin.scheduled.length, 0),
    actions: plugins.reduce((total, plugin) => total + plugin.actions.length, 0),
    warnings: checks.filter((check) => check.state === "warn").length,
    errors: checks.filter((check) => check.state === "error").length,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
