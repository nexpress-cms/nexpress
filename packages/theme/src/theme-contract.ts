import { npAnalyzeRegisteredThemeDefinition } from "@nexpress/core";
import { npIsCanonicalCollectionDocumentSlug } from "@nexpress/core/collection-contract";
import { npValidateRichTextContent } from "@nexpress/core/fields";
import { npAnalyzeNavigationItems } from "@nexpress/core/navigation";
import {
  getDefaultBlocks,
  npAnalyzeBlockContent,
  npAnalyzeBlockDefinitions,
  npAnalyzePatternDefinitions,
  npValidateBlockContent,
  type NpBlockDefinition,
  type NpPatternDefinition,
} from "@nexpress/blocks";

import type { NpTheme } from "./define-theme.js";

export interface NpThemeContractIssue {
  readonly code:
    | "definition"
    | "manifest"
    | "requirements"
    | "settings"
    | "implementation"
    | "routes"
    | "seed"
    | "blocks"
    | "patterns"
    | "seed-content";
  readonly location: string;
  readonly message: string;
}

export type NpThemeContractValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpThemeContractIssue };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function issue(
  code: NpThemeContractIssue["code"],
  location: string,
  message: string,
): NpThemeContractIssue {
  return { code, location, message };
}

function unsupportedKey(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  return Object.keys(value).find((key) => !allowed.has(key)) ?? null;
}

function unsupportedSeedField(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
): NpThemeContractIssue | null {
  const key = unsupportedKey(value, allowed);
  return key
    ? issue("seed-content", `${location}.${key}`, `unsupported seed field "${key}".`)
    : null;
}

function validateTopLevelSettingsSchema(theme: Record<string, unknown>): NpThemeContractIssue[] {
  if (!isRecord(theme.manifest) || theme.manifest.settingsSchema === undefined) return [];
  let node = theme.manifest.settingsSchema as {
    _def?: { type?: unknown; innerType?: unknown };
  };
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
  return node?._def?.type === "object"
    ? []
    : [
        issue(
          "settings",
          "manifest.settingsSchema",
          "settingsSchema must be a top-level Zod object (optionally wrapped by default, optional, or nullable).",
        ),
      ];
}

function validateThemeBlocks(theme: Record<string, unknown>): {
  issues: NpThemeContractIssue[];
  definitions: NpBlockDefinition[];
} {
  if (!isRecord(theme.impl) || theme.impl.blocks === undefined) {
    return { issues: [], definitions: [] };
  }
  const definitions = Array.isArray(theme.impl.blocks)
    ? (theme.impl.blocks as NpBlockDefinition[])
    : [];
  const issues = npAnalyzeBlockDefinitions(theme.impl.blocks).map((entry) =>
    issue("blocks", "impl.blocks", entry.message),
  );
  return { issues, definitions: issues.length === 0 ? definitions : [] };
}

function validateThemePatterns(
  theme: Record<string, unknown>,
  themeDefinitions: NpBlockDefinition[],
): NpThemeContractIssue[] {
  if (!isRecord(theme.impl) || theme.impl.patterns === undefined) return [];
  const shapeIssues = npAnalyzePatternDefinitions(theme.impl.patterns).map((entry) =>
    issue("patterns", "impl.patterns", entry.message),
  );
  if (shapeIssues.length > 0 || !Array.isArray(theme.impl.patterns)) return shapeIssues;
  const definitions = [...getDefaultBlocks(), ...themeDefinitions];
  const contentIssues: NpThemeContractIssue[] = [];
  for (const [index, pattern] of (theme.impl.patterns as NpPatternDefinition[]).entries()) {
    for (const blockIssue of npAnalyzeBlockContent(pattern.blocks, definitions)) {
      if (blockIssue.severity === "error") {
        contentIssues.push(
          issue(
            "patterns",
            `impl.patterns.${index.toString()}.blocks${blockIssue.path.length > 0 ? `.${blockIssue.path}` : ""}`,
            blockIssue.message,
          ),
        );
      }
    }
  }
  return contentIssues;
}

function validateString(
  value: unknown,
  location: string,
  required = true,
): NpThemeContractIssue | null {
  if (!required && value === undefined) return null;
  return typeof value === "string" && value.trim().length > 0 && value === value.trim()
    ? null
    : issue("seed-content", location, `${location} must be a trimmed, non-empty string.`);
}

function validateTerms(value: unknown, location: string): NpThemeContractIssue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [issue("seed-content", location, `${location} must be an array.`)];
  }
  const issues: NpThemeContractIssue[] = [];
  for (const [index, raw] of value.entries()) {
    const itemLocation = `${location}.${index.toString()}`;
    if (!isRecord(raw)) {
      issues.push(issue("seed-content", itemLocation, "seed terms must be plain objects."));
      continue;
    }
    const extra = unsupportedSeedField(raw, new Set(["name", "description"]), itemLocation);
    if (extra) issues.push(extra);
    const nameIssue = validateString(raw.name, `${itemLocation}.name`);
    if (nameIssue) issues.push(nameIssue);
    const descriptionIssue = validateString(raw.description, `${itemLocation}.description`, false);
    if (descriptionIssue) issues.push(descriptionIssue);
  }
  return issues;
}

function validateSeedPages(
  value: unknown,
  definitions: NpBlockDefinition[],
  templates: unknown,
): NpThemeContractIssue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [issue("seed-content", "impl.seedContent.pages", "seed pages must be an array.")];
  }
  const issues: NpThemeContractIssue[] = [];
  const pageTemplates = isRecord(templates) && isRecord(templates.pages) ? templates.pages : {};
  for (const [index, raw] of value.entries()) {
    const location = `impl.seedContent.pages.${index.toString()}`;
    if (!isRecord(raw)) {
      issues.push(issue("seed-content", location, "seed pages must be plain objects."));
      continue;
    }
    const extra = unsupportedSeedField(
      raw,
      new Set(["title", "slug", "seoDescription", "blocks", "template", "data"]),
      location,
    );
    if (extra) issues.push(extra);
    const titleIssue = validateString(raw.title, `${location}.title`);
    if (titleIssue) issues.push(titleIssue);
    const slugIssue = validateString(raw.slug, `${location}.slug`, false);
    if (slugIssue) issues.push(slugIssue);
    if (raw.slug !== undefined && !slugIssue && !npIsCanonicalCollectionDocumentSlug(raw.slug)) {
      issues.push(
        issue(
          "seed-content",
          `${location}.slug`,
          'seed page slug must be "/" or a canonical relative document path.',
        ),
      );
    }
    const seoIssue = validateString(raw.seoDescription, `${location}.seoDescription`, false);
    if (seoIssue) issues.push(seoIssue);
    if (raw.data !== undefined && !isRecord(raw.data)) {
      issues.push(
        issue("seed-content", `${location}.data`, "seed page data must be a plain object."),
      );
    }
    const structural = npValidateBlockContent(raw.blocks);
    if (!structural.ok) {
      issues.push(issue("seed-content", `${location}.blocks`, structural.message));
    } else {
      for (const blockIssue of npAnalyzeBlockContent(raw.blocks, definitions)) {
        if (blockIssue.severity === "error") {
          issues.push(
            issue(
              "seed-content",
              `${location}.blocks${blockIssue.path.length > 0 ? `.${blockIssue.path}` : ""}`,
              blockIssue.message,
            ),
          );
        }
      }
    }
    if (
      raw.template !== undefined &&
      (typeof raw.template !== "string" || !Object.hasOwn(pageTemplates, raw.template))
    ) {
      issues.push(
        issue(
          "seed-content",
          `${location}.template`,
          `seed page template "${typeof raw.template === "string" ? raw.template : "<non-string>"}" is not declared in impl.templates.pages.`,
        ),
      );
    }
  }
  return issues;
}

function validateSeedPosts(value: unknown): NpThemeContractIssue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [issue("seed-content", "impl.seedContent.posts", "seed posts must be an array.")];
  }
  const issues: NpThemeContractIssue[] = [];
  for (const [index, raw] of value.entries()) {
    const location = `impl.seedContent.posts.${index.toString()}`;
    if (!isRecord(raw)) {
      issues.push(issue("seed-content", location, "seed posts must be plain objects."));
      continue;
    }
    const extra = unsupportedSeedField(
      raw,
      new Set([
        "title",
        "slug",
        "excerpt",
        "content",
        "publishedAt",
        "status",
        "kind",
        "parentSlug",
        "order",
        "tagNames",
        "categoryNames",
        "data",
      ]),
      location,
    );
    if (extra) issues.push(extra);
    for (const key of ["title", "excerpt"] as const) {
      const stringIssue = validateString(raw[key], `${location}.${key}`);
      if (stringIssue) issues.push(stringIssue);
    }
    for (const key of ["slug", "kind", "parentSlug"] as const) {
      const stringIssue = validateString(raw[key], `${location}.${key}`, false);
      if (stringIssue) issues.push(stringIssue);
    }
    for (const key of ["slug", "parentSlug"] as const) {
      if (
        raw[key] !== undefined &&
        validateString(raw[key], `${location}.${key}`, false) === null &&
        !npIsCanonicalCollectionDocumentSlug(raw[key])
      ) {
        issues.push(
          issue(
            "seed-content",
            `${location}.${key}`,
            `seed post ${key} must be a canonical relative document path.`,
          ),
        );
      }
    }
    if (
      typeof raw.publishedAt !== "string" ||
      !Number.isFinite(Date.parse(raw.publishedAt)) ||
      new Date(raw.publishedAt).toISOString() !== raw.publishedAt
    ) {
      issues.push(
        issue(
          "seed-content",
          `${location}.publishedAt`,
          "seed post publishedAt must be a canonical ISO timestamp.",
        ),
      );
    }
    const richText = npValidateRichTextContent(raw.content);
    if (!richText.ok) {
      issues.push(issue("seed-content", `${location}.content`, richText.message));
    }
    if (raw.status !== undefined && raw.status !== "draft" && raw.status !== "published") {
      issues.push(
        issue(
          "seed-content",
          `${location}.status`,
          'seed post status must be "draft" or "published".',
        ),
      );
    }
    if (
      raw.order !== undefined &&
      (typeof raw.order !== "number" || !Number.isInteger(raw.order) || raw.order < 0)
    ) {
      issues.push(
        issue(
          "seed-content",
          `${location}.order`,
          "seed post order must be a non-negative integer.",
        ),
      );
    }
    for (const key of ["tagNames", "categoryNames"] as const) {
      if (
        raw[key] !== undefined &&
        (!Array.isArray(raw[key]) ||
          !(raw[key] as unknown[]).every((entry) =>
            typeof entry === "string" ? entry.length > 0 && entry === entry.trim() : false,
          ))
      ) {
        issues.push(
          issue(
            "seed-content",
            `${location}.${key}`,
            `${key} must be an array of trimmed, non-empty strings.`,
          ),
        );
      }
    }
    if (raw.data !== undefined && !isRecord(raw.data)) {
      issues.push(
        issue("seed-content", `${location}.data`, "seed post data must be a plain object."),
      );
    }
  }
  return issues;
}

function validateNavItems(value: unknown, location: string): NpThemeContractIssue[] {
  return npAnalyzeNavigationItems(value).map((entry) =>
    issue("seed-content", entry.path.replace(/^navigation\.items/u, location), entry.message),
  );
}

function validateSeedContent(
  theme: Record<string, unknown>,
  themeDefinitions: NpBlockDefinition[],
): NpThemeContractIssue[] {
  if (!isRecord(theme.impl) || theme.impl.seedContent === undefined) return [];
  if (!isRecord(theme.impl.seedContent)) return [];
  const seed = theme.impl.seedContent;
  const definitions = [...getDefaultBlocks(), ...themeDefinitions];
  const issues = [
    ...validateTerms(seed.tags, "impl.seedContent.tags"),
    ...validateTerms(seed.categories, "impl.seedContent.categories"),
    ...validateSeedPages(seed.pages, definitions, theme.impl.templates),
    ...validateSeedPosts(seed.posts),
  ];
  if (seed.navigation !== undefined && isRecord(seed.navigation)) {
    const extra = unsupportedSeedField(
      seed.navigation,
      new Set(["header", "footer"]),
      "impl.seedContent.navigation",
    );
    if (extra) issues.push(extra);
    for (const key of ["header", "footer"] as const) {
      if (seed.navigation[key] !== undefined) {
        issues.push(
          ...validateNavItems(seed.navigation[key], `impl.seedContent.navigation.${key}`),
        );
      }
    }
  }
  return issues;
}

export function npAnalyzeThemeDefinition(value: unknown): NpThemeContractIssue[] {
  const coreIssues = npAnalyzeRegisteredThemeDefinition(value) as NpThemeContractIssue[];
  if (!isRecord(value)) return coreIssues;
  const blockResult = validateThemeBlocks(value);
  return [
    ...coreIssues,
    ...validateTopLevelSettingsSchema(value),
    ...blockResult.issues,
    ...validateThemePatterns(value, blockResult.definitions),
    ...validateSeedContent(value, blockResult.definitions),
  ];
}

export function npValidateThemeDefinition(value: unknown): NpThemeContractValidationResult {
  const first = npAnalyzeThemeDefinition(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function npAssertThemeDefinition(value: unknown): asserts value is NpTheme {
  const validation = npValidateThemeDefinition(value);
  if (!validation.ok) {
    throw new Error(
      `Invalid theme definition at ${validation.issue.location}: ${validation.issue.message}`,
    );
  }
}
