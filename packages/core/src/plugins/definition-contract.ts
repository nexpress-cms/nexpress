import IntlMessageFormat from "intl-messageformat";

import { npPluginIdMaxLength, npPluginIdPattern } from "../settings/contract.js";

export interface NpPluginDefinitionContractInput {
  manifest?: unknown;
  configSchema?: unknown;
  configVersion?: unknown;
  configMigrate?: unknown;
  setup?: unknown;
  teardown?: unknown;
  i18n?: unknown;
}

function analyzeManifest(
  input: NpPluginDefinitionContractInput,
): NpPluginDefinitionContractIssue[] {
  if (input.manifest === undefined) return [];
  if (!isRecord(input.manifest)) {
    return [issue("manifest", "manifest", "manifest must be a plain object.")];
  }
  const id = input.manifest.id;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > npPluginIdMaxLength ||
    !new RegExp(npPluginIdPattern, "u").test(id)
  ) {
    return [
      issue(
        "manifest",
        "manifest.id",
        `plugin id must be an npm-shaped id of at most ${npPluginIdMaxLength.toString()} characters.`,
      ),
    ];
  }
  return [];
}

export interface NpPluginDefinitionContractIssue {
  code: "manifest" | "config" | "lifecycle" | "i18n";
  location: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function issue(
  code: NpPluginDefinitionContractIssue["code"],
  location: string,
  message: string,
): NpPluginDefinitionContractIssue {
  return { code, location, message };
}

function isTopLevelZodObject(value: unknown): boolean {
  let node = value as { _def?: { type?: unknown; innerType?: unknown } };
  const visited = new Set<unknown>();
  while (
    node &&
    typeof node === "object" &&
    node._def &&
    ["default", "optional", "nullable"].includes(String(node._def.type)) &&
    node._def.innerType &&
    !visited.has(node)
  ) {
    visited.add(node);
    node = node._def.innerType;
  }
  return node?._def?.type === "object";
}

function analyzeConfig(input: NpPluginDefinitionContractInput): NpPluginDefinitionContractIssue[] {
  const issues: NpPluginDefinitionContractIssue[] = [];
  const hasSchema = input.configSchema !== undefined;
  if (
    hasSchema &&
    (!input.configSchema ||
      (typeof input.configSchema !== "object" && typeof input.configSchema !== "function") ||
      typeof (input.configSchema as { safeParse?: unknown }).safeParse !== "function")
  ) {
    issues.push(issue("config", "configSchema", "configSchema must be a Zod-compatible schema."));
  } else if (hasSchema && !isTopLevelZodObject(input.configSchema)) {
    issues.push(
      issue(
        "config",
        "configSchema",
        "configSchema must be a top-level Zod object (optionally wrapped by default, optional, or nullable).",
      ),
    );
  }
  if (
    input.configVersion !== undefined &&
    (typeof input.configVersion !== "number" ||
      !Number.isInteger(input.configVersion) ||
      input.configVersion < 1)
  ) {
    issues.push(issue("config", "configVersion", "configVersion must be a positive integer."));
  }
  if (input.configMigrate !== undefined && typeof input.configMigrate !== "function") {
    issues.push(issue("config", "configMigrate", "configMigrate must be a function."));
  }
  if (!hasSchema && (input.configVersion !== undefined || input.configMigrate !== undefined)) {
    issues.push(
      issue("config", "configSchema", "configVersion and configMigrate require configSchema."),
    );
  }
  if (
    hasSchema &&
    typeof input.configVersion === "number" &&
    input.configVersion > 1 &&
    input.configMigrate === undefined
  ) {
    issues.push(
      issue("config", "configMigrate", "configVersion greater than 1 requires configMigrate."),
    );
  }
  if (
    hasSchema &&
    input.configMigrate !== undefined &&
    (input.configVersion === undefined || input.configVersion === 1)
  ) {
    issues.push(
      issue("config", "configVersion", "configMigrate requires configVersion greater than 1."),
    );
  }
  return issues;
}

function analyzeLifecycle(
  input: NpPluginDefinitionContractInput,
): NpPluginDefinitionContractIssue[] {
  const issues: NpPluginDefinitionContractIssue[] = [];
  if (input.setup !== undefined && typeof input.setup !== "function") {
    issues.push(issue("lifecycle", "setup", "setup must be a function."));
  }
  if (input.teardown !== undefined && typeof input.teardown !== "function") {
    issues.push(issue("lifecycle", "teardown", "teardown must be a function."));
  }
  return issues;
}

export function npAnalyzePluginI18nBundles(value: unknown): NpPluginDefinitionContractIssue[] {
  if (!isRecord(value)) {
    return [issue("i18n", "i18n", "i18n must be a plain object keyed by locale.")];
  }
  const issues: NpPluginDefinitionContractIssue[] = [];
  for (const [locale, rawBundle] of Object.entries(value)) {
    let canonicalLocale: string | undefined;
    try {
      canonicalLocale = Intl.getCanonicalLocales(locale)[0];
    } catch {
      // Reported below.
    }
    if (!canonicalLocale || canonicalLocale !== locale) {
      issues.push(
        issue("i18n", `i18n.${locale}`, `locale "${locale}" must be a canonical BCP 47 tag.`),
      );
      continue;
    }
    if (!isRecord(rawBundle) || Object.keys(rawBundle).length === 0) {
      issues.push(
        issue("i18n", `i18n.${locale}`, `locale "${locale}" must contain at least one string.`),
      );
      continue;
    }
    for (const [key, message] of Object.entries(rawBundle)) {
      const location = `i18n.${locale}.${key}`;
      if (key.trim().length === 0 || key !== key.trim() || key.length > 256) {
        issues.push(
          issue(
            "i18n",
            location,
            "translation keys must be trimmed, non-empty, and 256 characters or fewer.",
          ),
        );
        continue;
      }
      if (typeof message !== "string") {
        issues.push(issue("i18n", location, `translation "${locale}:${key}" must be a string.`));
        continue;
      }
      try {
        new IntlMessageFormat(message, locale);
      } catch (error) {
        issues.push(
          issue(
            "i18n",
            location,
            `translation "${locale}:${key}" is invalid ICU MessageFormat: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    }
  }
  return issues;
}

export function npAnalyzePluginDefinitionContract(
  input: NpPluginDefinitionContractInput,
): NpPluginDefinitionContractIssue[] {
  return [
    ...analyzeManifest(input),
    ...analyzeConfig(input),
    ...analyzeLifecycle(input),
    ...(input.i18n === undefined ? [] : npAnalyzePluginI18nBundles(input.i18n)),
  ];
}

export function npValidatePluginVoidResult(
  lifecycle: "setup" | "teardown",
  result: unknown,
): { ok: true } | { ok: false; message: string } {
  return result === undefined
    ? { ok: true }
    : { ok: false, message: `${lifecycle} must resolve to void.` };
}

export function npPluginTranslationKeys(value: unknown): string[] {
  if (npAnalyzePluginI18nBundles(value).length > 0) return [];
  return Object.entries(value as Record<string, Record<string, string>>).flatMap(
    ([locale, bundle]) => Object.keys(bundle).map((key) => `${locale}:${key}`),
  );
}
