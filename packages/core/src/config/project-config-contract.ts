import type { NpConfig } from "./types.js";
import { npConfigShapeSchema } from "./validation.js";
import { npAnalyzeStorageRuntimeConfig } from "../storage/contract.js";
import { npAnalyzeI18nConfig } from "../i18n-contract/contract.js";

export type NpProjectConfigIssueCode = "shape" | "reference";

export interface NpProjectConfigIssue {
  readonly code: NpProjectConfigIssueCode;
  readonly location: string;
  readonly message: string;
}

export type NpProjectConfigValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpProjectConfigIssue };

const pluginIdPattern = /^(@[\w-]+\/)?[\w-]+$/u;

function issue(
  code: NpProjectConfigIssueCode,
  location: string,
  message: string,
): NpProjectConfigIssue {
  return { code, location, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function pathOf(parts: readonly PropertyKey[]): string {
  return parts.map(String).join(".");
}

function analyzeSite(config: NpConfig, issues: NpProjectConfigIssue[]): void {
  if (config.site.name.trim() !== config.site.name || config.site.name === "") {
    issues.push(issue("shape", "site.name", "site.name must be non-empty and trimmed."));
  }
  const url = new URL(config.site.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    issues.push(
      issue(
        "shape",
        "site.url",
        "site.url must be an HTTP(S) origin without credentials, a path, query, or fragment.",
      ),
    );
  }

  try {
    const databaseUrl = new URL(config.db.connectionString);
    if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
      throw new Error("unsupported protocol");
    }
  } catch {
    issues.push(
      issue(
        "shape",
        "db.connectionString",
        "db.connectionString must be a PostgreSQL connection URL.",
      ),
    );
  }
}

function analyzeStorage(config: NpConfig, issues: NpProjectConfigIssue[]): void {
  if (!config.storage) return;
  for (const entry of npAnalyzeStorageRuntimeConfig(config.storage, "storage")) {
    issues.push(issue("shape", entry.path, entry.message));
  }
}

function analyzeI18n(config: NpConfig, issues: NpProjectConfigIssue[]): void {
  if (!config.i18n) return;
  const result = npAnalyzeI18nConfig(config.i18n);
  if (!result.ok) {
    for (const entry of result.issues) {
      issues.push(
        issue(entry.code === "duplicate" ? "reference" : "shape", entry.path, entry.message),
      );
    }
  }
}

interface PluginInventoryEntry {
  readonly id: string;
  readonly index: number;
  readonly requires: readonly string[];
}

function analyzeLegacyPlugin(
  plugin: Record<string, unknown>,
  index: number,
  issues: NpProjectConfigIssue[],
): PluginInventoryEntry | null {
  const location = `plugins.${index.toString()}`;
  const supported = new Set(["id", "name", "init"]);
  for (const key of Object.keys(plugin)) {
    if (!supported.has(key)) {
      issues.push(
        issue("shape", `${location}.${key}`, `unsupported legacy plugin field "${key}".`),
      );
    }
  }
  if (typeof plugin.id !== "string" || !pluginIdPattern.test(plugin.id)) {
    issues.push(
      issue("shape", `${location}.id`, "legacy plugin id must be a safe package-style id."),
    );
    return null;
  }
  if (typeof plugin.name !== "string" || plugin.name.trim() !== plugin.name || plugin.name === "") {
    issues.push(
      issue("shape", `${location}.name`, "legacy plugin name must be non-empty and trimmed."),
    );
  }
  if (plugin.init !== undefined && typeof plugin.init !== "function") {
    issues.push(issue("shape", `${location}.init`, "legacy plugin init must be a function."));
  }
  return { id: plugin.id, index, requires: [] };
}

function analyzeResolvedPlugin(
  manifest: Record<string, unknown>,
  index: number,
  issues: NpProjectConfigIssue[],
): PluginInventoryEntry | null {
  const location = `plugins.${index.toString()}.manifest`;
  if (typeof manifest.id !== "string" || !pluginIdPattern.test(manifest.id)) {
    issues.push(
      issue("shape", `${location}.id`, "plugin manifest id must be a safe package-style id."),
    );
    return null;
  }
  if (
    typeof manifest.name !== "string" ||
    manifest.name.trim() !== manifest.name ||
    manifest.name === ""
  ) {
    issues.push(
      issue("shape", `${location}.name`, "plugin manifest name must be non-empty and trimmed."),
    );
  }
  if (
    !Array.isArray(manifest.capabilities) ||
    !manifest.capabilities.every((entry) => typeof entry === "string")
  ) {
    issues.push(
      issue("shape", `${location}.capabilities`, "plugin capabilities must be a string array."),
    );
  }

  const rawRequires = manifest.requires;
  if (
    rawRequires !== undefined &&
    (!Array.isArray(rawRequires) || !rawRequires.every((entry) => typeof entry === "string"))
  ) {
    issues.push(issue("shape", `${location}.requires`, "plugin requires must be a string array."));
    return { id: manifest.id, index, requires: [] };
  }
  const requires = rawRequires ?? [];
  const seen = new Set<string>();
  for (const [requireIndex, dependency] of requires.entries()) {
    if (!pluginIdPattern.test(dependency)) {
      issues.push(
        issue(
          "shape",
          `${location}.requires.${requireIndex.toString()}`,
          `plugin dependency "${dependency}" is not a safe package-style id.`,
        ),
      );
    }
    if (seen.has(dependency)) {
      issues.push(
        issue(
          "reference",
          `${location}.requires.${requireIndex.toString()}`,
          `duplicate plugin dependency "${dependency}".`,
        ),
      );
    }
    seen.add(dependency);
  }
  return { id: manifest.id, index, requires };
}

function analyzePlugins(config: NpConfig, issues: NpProjectConfigIssue[]): void {
  const inventory: PluginInventoryEntry[] = [];
  for (const [index, rawPlugin] of (config.plugins ?? []).entries()) {
    if (!isRecord(rawPlugin)) {
      issues.push(
        issue("shape", `plugins.${index.toString()}`, "plugin entry must be a plain object."),
      );
      continue;
    }
    if ("manifest" in rawPlugin) {
      if (!isRecord(rawPlugin.manifest)) {
        issues.push(
          issue(
            "shape",
            `plugins.${index.toString()}.manifest`,
            "plugin manifest must be a plain object.",
          ),
        );
        continue;
      }
      const entry = analyzeResolvedPlugin(rawPlugin.manifest, index, issues);
      if (entry) inventory.push(entry);
    } else {
      const entry = analyzeLegacyPlugin(rawPlugin, index, issues);
      if (entry) inventory.push(entry);
    }
  }

  const byId = new Map<string, PluginInventoryEntry>();
  for (const entry of inventory) {
    const previous = byId.get(entry.id);
    if (previous) {
      issues.push(
        issue(
          "reference",
          `plugins.${entry.index.toString()}`,
          `duplicate plugin id "${entry.id}"; first declared at plugins.${previous.index.toString()}.`,
        ),
      );
    } else {
      byId.set(entry.id, entry);
    }
  }

  for (const entry of inventory) {
    for (const [index, dependency] of entry.requires.entries()) {
      const location = `plugins.${entry.index.toString()}.manifest.requires.${index.toString()}`;
      if (dependency === entry.id) {
        issues.push(issue("reference", location, `plugin "${entry.id}" cannot depend on itself.`));
      } else if (!byId.has(dependency)) {
        issues.push(
          issue(
            "reference",
            location,
            `plugin dependency "${dependency}" is not declared in config.plugins.`,
          ),
        );
      }
    }
  }

  const state = new Map<string, "visiting" | "visited">();
  const path: string[] = [];
  const reported = new Set<string>();
  const visit = (id: string): void => {
    if (state.get(id) === "visited") return;
    if (state.get(id) === "visiting") {
      const start = path.indexOf(id);
      const cycle = [...path.slice(start), id];
      const key = [...new Set(cycle)].sort().join("|");
      if (!reported.has(key)) {
        const entry = byId.get(id);
        issues.push(
          issue(
            "reference",
            `plugins.${entry?.index.toString() ?? "0"}.manifest.requires`,
            `plugin dependency cycle detected: ${cycle.join(" -> ")}.`,
          ),
        );
        reported.add(key);
      }
      return;
    }
    state.set(id, "visiting");
    path.push(id);
    for (const dependency of byId.get(id)?.requires ?? []) {
      if (byId.has(dependency)) visit(dependency);
    }
    path.pop();
    state.set(id, "visited");
  };
  for (const id of byId.keys()) visit(id);
}

export function npAnalyzeProjectConfig(value: unknown): NpProjectConfigIssue[] {
  const parsed = npConfigShapeSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((entry) => issue("shape", pathOf(entry.path), entry.message));
  }
  const config = parsed.data as NpConfig;
  const issues: NpProjectConfigIssue[] = [];
  analyzeSite(config, issues);
  analyzeStorage(config, issues);
  analyzeI18n(config, issues);
  analyzePlugins(config, issues);
  return issues;
}

export function npValidateProjectConfig(value: unknown): NpProjectConfigValidationResult {
  const first = npAnalyzeProjectConfig(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function npAssertProjectConfig(value: unknown): asserts value is NpConfig {
  const validation = npValidateProjectConfig(value);
  if (!validation.ok) {
    throw new Error(
      `Invalid project config at ${validation.issue.location || "config"}: ${validation.issue.message}`,
    );
  }
}
