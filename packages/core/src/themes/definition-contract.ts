import { npAnalyzePluginI18nBundles } from "../plugins/definition-contract.js";
import { npValidatePluginPageRoutePattern } from "../plugins/page-route-contract.js";
import { npAnalyzeNavigationLocation } from "../navigation/contract.js";
import { npAnalyzeThemeTokensOverlay } from "../theme/contract.js";

export type NpThemeDefinitionIssueCode =
  "definition" | "manifest" | "requirements" | "settings" | "implementation" | "routes" | "seed";

export interface NpThemeDefinitionIssue {
  readonly code: NpThemeDefinitionIssueCode;
  readonly location: string;
  readonly message: string;
}

export type NpThemeDefinitionValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpThemeDefinitionIssue };

const themeKeys = new Set(["manifest", "impl"]);
const manifestKeys = new Set([
  "id",
  "name",
  "version",
  "description",
  "author",
  "nexpress",
  "requires",
  "settingsSchema",
  "settingsVersion",
  "settingsMigrate",
]);
const implKeys = new Set([
  "shell",
  "slots",
  "templates",
  "tokens",
  "css",
  "i18n",
  "routes",
  "archives",
  "blocks",
  "patterns",
  "navLocations",
  "notFound",
  "error",
  "members",
  "seo",
  "seedContent",
]);
const slotKeys = new Set(["header", "footer", "nav", "sidebar", "beforeContent", "afterContent"]);
const memberTitleKeys = new Set([
  "login",
  "register",
  "forgotPassword",
  "resetPassword",
  "verify",
  "notifications",
]);
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const idPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const collectionSlugPattern = /^[a-z][a-z0-9-]{0,62}$/u;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const fieldTypes = new Set([
  "text",
  "textarea",
  "richText",
  "number",
  "checkbox",
  "date",
  "select",
  "upload",
  "relationship",
  "blocks",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function issue(
  code: NpThemeDefinitionIssueCode,
  location: string,
  message: string,
): NpThemeDefinitionIssue {
  return { code, location, message };
}

function unsupportedKey(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  return Object.keys(value).find((key) => !allowed.has(key)) ?? null;
}

function isTrimmedString(value: unknown, max: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length <= max &&
    (allowEmpty || value.length > 0)
  );
}

function validateOptionalString(
  value: unknown,
  location: string,
  max: number,
): NpThemeDefinitionIssue | null {
  return value === undefined || isTrimmedString(value, max)
    ? null
    : issue("definition", location, `${location} must be a trimmed, non-empty string.`);
}

function validateOptionalUrl(value: unknown, location: string): NpThemeDefinitionIssue | null {
  if (value === undefined) return null;
  if (!isTrimmedString(value, 2048)) {
    return issue("manifest", location, `${location} must be a valid URL.`);
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
  } catch {
    return issue("manifest", location, `${location} must be an http or https URL.`);
  }
  return null;
}

function validateSettings(manifest: Record<string, unknown>): NpThemeDefinitionIssue[] {
  const issues: NpThemeDefinitionIssue[] = [];
  const schema = manifest.settingsSchema;
  const hasSchema = schema !== undefined;
  if (
    hasSchema &&
    (!schema ||
      (typeof schema !== "object" && typeof schema !== "function") ||
      typeof (schema as { safeParse?: unknown }).safeParse !== "function")
  ) {
    issues.push(
      issue(
        "settings",
        "manifest.settingsSchema",
        "settingsSchema must be a Zod-compatible schema.",
      ),
    );
  }
  const version = manifest.settingsVersion;
  if (
    version !== undefined &&
    (typeof version !== "number" || !Number.isInteger(version) || version < 1)
  ) {
    issues.push(
      issue("settings", "manifest.settingsVersion", "settingsVersion must be a positive integer."),
    );
  }
  if (manifest.settingsMigrate !== undefined && typeof manifest.settingsMigrate !== "function") {
    issues.push(
      issue("settings", "manifest.settingsMigrate", "settingsMigrate must be a function."),
    );
  }
  if (!hasSchema && (version !== undefined || manifest.settingsMigrate !== undefined)) {
    issues.push(
      issue(
        "settings",
        "manifest.settingsSchema",
        "settingsVersion and settingsMigrate require settingsSchema.",
      ),
    );
  }
  if (hasSchema && typeof version === "number" && version > 1 && !manifest.settingsMigrate) {
    issues.push(
      issue(
        "settings",
        "manifest.settingsMigrate",
        "settingsVersion greater than 1 requires settingsMigrate.",
      ),
    );
  }
  if (hasSchema && manifest.settingsMigrate && (version === undefined || version === 1)) {
    issues.push(
      issue(
        "settings",
        "manifest.settingsVersion",
        "settingsMigrate requires settingsVersion greater than 1.",
      ),
    );
  }
  return issues;
}

function validateRequirements(value: unknown): NpThemeDefinitionIssue[] {
  if (value === undefined) return [];
  if (!isRecord(value) || unsupportedKey(value, new Set(["collections"]))) {
    return [
      issue(
        "requirements",
        "manifest.requires",
        "manifest.requires must contain only a collections object.",
      ),
    ];
  }
  if (value.collections === undefined) return [];
  if (!isRecord(value.collections)) {
    return [
      issue(
        "requirements",
        "manifest.requires.collections",
        "theme collection requirements must be a plain object.",
      ),
    ];
  }
  const issues: NpThemeDefinitionIssue[] = [];
  for (const [slug, rawCollection] of Object.entries(value.collections)) {
    const location = `manifest.requires.collections.${slug}`;
    if (!collectionSlugPattern.test(slug) || !isRecord(rawCollection)) {
      issues.push(
        issue(
          "requirements",
          location,
          "collection requirements need a safe slug and object value.",
        ),
      );
      continue;
    }
    const extra = unsupportedKey(
      rawCollection,
      new Set(["fields", "createIfAbsent", "kinds", "groupMeta"]),
    );
    if (extra) {
      issues.push(
        issue(
          "requirements",
          `${location}.${extra}`,
          `unsupported collection requirement field "${extra}".`,
        ),
      );
    }
    if (
      rawCollection.createIfAbsent !== undefined &&
      typeof rawCollection.createIfAbsent !== "boolean"
    ) {
      issues.push(
        issue("requirements", `${location}.createIfAbsent`, "createIfAbsent must be boolean."),
      );
    }
    if (rawCollection.fields !== undefined) {
      if (!isRecord(rawCollection.fields)) {
        issues.push(issue("requirements", `${location}.fields`, "fields must be a plain object."));
      } else {
        for (const [name, rawField] of Object.entries(rawCollection.fields)) {
          const fieldLocation = `${location}.fields.${name}`;
          if (
            !keyPattern.test(name) ||
            !isRecord(rawField) ||
            !fieldTypes.has(String(rawField.type))
          ) {
            issues.push(
              issue(
                "requirements",
                fieldLocation,
                "field requirements need a safe name and supported field type.",
              ),
            );
            continue;
          }
          const fieldExtra = unsupportedKey(
            rawField,
            new Set(["type", "relationTo", "hasMany", "required", "hard", "options", "admin"]),
          );
          if (fieldExtra) {
            issues.push(
              issue(
                "requirements",
                `${fieldLocation}.${fieldExtra}`,
                `unsupported field requirement property "${fieldExtra}".`,
              ),
            );
          }
          for (const booleanKey of ["hasMany", "required", "hard"] as const) {
            if (rawField[booleanKey] !== undefined && typeof rawField[booleanKey] !== "boolean") {
              issues.push(
                issue(
                  "requirements",
                  `${fieldLocation}.${booleanKey}`,
                  `${booleanKey} must be boolean.`,
                ),
              );
            }
          }
          if (
            rawField.relationTo !== undefined &&
            !(
              typeof rawField.relationTo === "string" &&
              collectionSlugPattern.test(rawField.relationTo)
            ) &&
            !(
              Array.isArray(rawField.relationTo) &&
              rawField.relationTo.length > 0 &&
              rawField.relationTo.every(
                (entry) => typeof entry === "string" && collectionSlugPattern.test(entry),
              )
            )
          ) {
            issues.push(
              issue(
                "requirements",
                `${fieldLocation}.relationTo`,
                "relationTo must be a collection slug or non-empty slug array.",
              ),
            );
          }
          if (
            rawField.relationTo !== undefined &&
            rawField.type !== "relationship" &&
            rawField.type !== "upload"
          ) {
            issues.push(
              issue(
                "requirements",
                `${fieldLocation}.relationTo`,
                "relationTo is supported only for relationship or upload fields.",
              ),
            );
          }
          if (rawField.type === "upload" && Array.isArray(rawField.relationTo)) {
            issues.push(
              issue(
                "requirements",
                `${fieldLocation}.relationTo`,
                "upload relationTo must be one collection slug.",
              ),
            );
          }
          if (
            rawField.hasMany !== undefined &&
            rawField.type !== "relationship" &&
            rawField.type !== "select"
          ) {
            issues.push(
              issue(
                "requirements",
                `${fieldLocation}.hasMany`,
                "hasMany is supported only for relationship or select fields.",
              ),
            );
          }
          if (rawField.options !== undefined) {
            if (rawField.type !== "select") {
              issues.push(
                issue(
                  "requirements",
                  `${fieldLocation}.options`,
                  "options are supported only for select fields.",
                ),
              );
            }
            if (!Array.isArray(rawField.options) || rawField.options.length === 0) {
              issues.push(
                issue(
                  "requirements",
                  `${fieldLocation}.options`,
                  "options must be a non-empty array.",
                ),
              );
            } else {
              const values = new Set<string>();
              for (const [index, rawOption] of rawField.options.entries()) {
                const optionLocation = `${fieldLocation}.options.${index.toString()}`;
                if (
                  !isRecord(rawOption) ||
                  !isTrimmedString(rawOption.label, 100) ||
                  !isTrimmedString(rawOption.value, 100)
                ) {
                  issues.push(
                    issue(
                      "requirements",
                      optionLocation,
                      "options require non-empty label and value strings.",
                    ),
                  );
                  continue;
                }
                if (values.has(rawOption.value)) {
                  issues.push(
                    issue(
                      "requirements",
                      optionLocation,
                      `duplicate option value "${rawOption.value}".`,
                    ),
                  );
                }
                values.add(rawOption.value);
              }
            }
          }
          if (rawField.admin !== undefined) {
            if (!isRecord(rawField.admin)) {
              issues.push(
                issue("requirements", `${fieldLocation}.admin`, "admin must be a plain object."),
              );
            } else {
              const adminExtra = unsupportedKey(
                rawField.admin,
                new Set(["group", "condition", "position"]),
              );
              if (adminExtra) {
                issues.push(
                  issue(
                    "requirements",
                    `${fieldLocation}.admin.${adminExtra}`,
                    `unsupported admin hint "${adminExtra}".`,
                  ),
                );
              }
              if (
                rawField.admin.group !== undefined &&
                !isTrimmedString(rawField.admin.group, 100)
              ) {
                issues.push(
                  issue(
                    "requirements",
                    `${fieldLocation}.admin.group`,
                    "admin.group must be a non-empty string.",
                  ),
                );
              }
              if (
                rawField.admin.position !== undefined &&
                rawField.admin.position !== "main" &&
                rawField.admin.position !== "sidebar"
              ) {
                issues.push(
                  issue(
                    "requirements",
                    `${fieldLocation}.admin.position`,
                    'admin.position must be "main" or "sidebar".',
                  ),
                );
              }
              if (
                rawField.admin.condition !== undefined &&
                typeof rawField.admin.condition !== "function" &&
                !isRecord(rawField.admin.condition)
              ) {
                issues.push(
                  issue(
                    "requirements",
                    `${fieldLocation}.admin.condition`,
                    "admin.condition must be a function or condition expression object.",
                  ),
                );
              }
            }
          }
        }
      }
    }
    if (rawCollection.kinds !== undefined) {
      if (!isRecord(rawCollection.kinds)) {
        issues.push(issue("requirements", `${location}.kinds`, "kinds must be a plain object."));
      } else {
        for (const [kind, rawKind] of Object.entries(rawCollection.kinds)) {
          const kindLocation = `${location}.kinds.${kind}`;
          if (
            !keyPattern.test(kind) ||
            !isRecord(rawKind) ||
            unsupportedKey(
              rawKind,
              new Set([
                "label",
                "labelPlural",
                "icon",
                "urlPattern",
                "hierarchical",
                "_themeOrigin",
              ]),
            )
          ) {
            issues.push(
              issue(
                "requirements",
                kindLocation,
                "collection kinds need a safe key and supported metadata fields.",
              ),
            );
            continue;
          }
          for (const labelKey of ["label", "labelPlural"] as const) {
            if (!isTrimmedString(rawKind[labelKey], 100)) {
              issues.push(
                issue(
                  "requirements",
                  `${kindLocation}.${labelKey}`,
                  `${labelKey} must be a non-empty string.`,
                ),
              );
            }
          }
          if (rawKind.icon !== undefined && !isTrimmedString(rawKind.icon, 100)) {
            issues.push(
              issue(
                "requirements",
                `${kindLocation}.icon`,
                "kind icon must be a non-empty string.",
              ),
            );
          }
          if (rawKind.urlPattern !== undefined) {
            const patternValidation = npValidatePluginPageRoutePattern(rawKind.urlPattern);
            const parameterSegments =
              typeof rawKind.urlPattern === "string"
                ? rawKind.urlPattern.split("/").filter((segment) => segment.startsWith(":"))
                : [];
            if (
              !patternValidation.ok ||
              parameterSegments.length !== 1 ||
              !parameterSegments[0]?.match(/^:slug(?:\(.+\))?$/u)
            ) {
              issues.push(
                issue(
                  "requirements",
                  `${kindLocation}.urlPattern`,
                  "kind urlPattern must be a canonical route pattern containing :slug.",
                ),
              );
            }
          }
          if (rawKind.hierarchical !== undefined && typeof rawKind.hierarchical !== "boolean") {
            issues.push(
              issue(
                "requirements",
                `${kindLocation}.hierarchical`,
                "hierarchical must be boolean.",
              ),
            );
          }
        }
      }
    }
    if (rawCollection.groupMeta !== undefined) {
      if (!isRecord(rawCollection.groupMeta)) {
        issues.push(
          issue("requirements", `${location}.groupMeta`, "groupMeta must be a plain object."),
        );
      } else {
        for (const [group, rawMeta] of Object.entries(rawCollection.groupMeta)) {
          const metaLocation = `${location}.groupMeta.${group}`;
          if (!isRecord(rawMeta) || unsupportedKey(rawMeta, new Set(["icon", "description"]))) {
            issues.push(
              issue(
                "requirements",
                metaLocation,
                "group metadata may contain only icon and description.",
              ),
            );
            continue;
          }
          for (const key of ["icon", "description"] as const) {
            if (rawMeta[key] !== undefined && !isTrimmedString(rawMeta[key], 500)) {
              issues.push(
                issue(
                  "requirements",
                  `${metaLocation}.${key}`,
                  `${key} must be a non-empty string.`,
                ),
              );
            }
          }
        }
      }
    }
  }
  return issues;
}

function validateManifest(value: unknown): NpThemeDefinitionIssue[] {
  if (!isRecord(value)) {
    return [issue("manifest", "manifest", "theme.manifest must be a plain object.")];
  }
  const issues: NpThemeDefinitionIssue[] = [];
  const extra = unsupportedKey(value, manifestKeys);
  if (extra)
    issues.push(issue("manifest", `manifest.${extra}`, `unsupported manifest field "${extra}".`));
  if (typeof value.id !== "string" || value.id.length > 128 || !idPattern.test(value.id)) {
    issues.push(
      issue(
        "manifest",
        "manifest.id",
        "manifest.id must start with a lowercase letter or number and use lowercase letters, numbers, dots, underscores, or hyphens.",
      ),
    );
  }
  if (!isTrimmedString(value.name, 100)) {
    issues.push(
      issue(
        "manifest",
        "manifest.name",
        "manifest.name must be a non-empty string up to 100 characters.",
      ),
    );
  }
  if (typeof value.version !== "string" || !semverPattern.test(value.version)) {
    issues.push(
      issue("manifest", "manifest.version", "manifest.version must be a semantic version."),
    );
  }
  const descriptionIssue = validateOptionalString(value.description, "manifest.description", 1000);
  if (descriptionIssue) issues.push({ ...descriptionIssue, code: "manifest" });
  if (value.author !== undefined) {
    if (!isRecord(value.author) || unsupportedKey(value.author, new Set(["name", "url"]))) {
      issues.push(
        issue(
          "manifest",
          "manifest.author",
          "manifest.author must contain only name and optional url.",
        ),
      );
    } else {
      if (!isTrimmedString(value.author.name, 100)) {
        issues.push(
          issue("manifest", "manifest.author.name", "manifest.author.name must be non-empty."),
        );
      }
      const urlIssue = validateOptionalUrl(value.author.url, "manifest.author.url");
      if (urlIssue) issues.push(urlIssue);
    }
  }
  if (value.nexpress !== undefined) {
    if (!isRecord(value.nexpress) || unsupportedKey(value.nexpress, new Set(["minVersion"]))) {
      issues.push(
        issue("manifest", "manifest.nexpress", "manifest.nexpress must contain only minVersion."),
      );
    } else if (
      value.nexpress.minVersion !== undefined &&
      (typeof value.nexpress.minVersion !== "string" ||
        !semverPattern.test(value.nexpress.minVersion))
    ) {
      issues.push(
        issue("manifest", "manifest.nexpress.minVersion", "minVersion must be a semantic version."),
      );
    }
  }
  issues.push(...validateRequirements(value.requires), ...validateSettings(value));
  return issues;
}

function validateFunctionMap(
  value: unknown,
  location: string,
  allowed: ReadonlySet<string>,
): NpThemeDefinitionIssue[] {
  if (!isRecord(value)) {
    return [issue("implementation", location, `${location} must be a plain object.`)];
  }
  const issues: NpThemeDefinitionIssue[] = [];
  const extra = unsupportedKey(value, allowed);
  if (extra)
    issues.push(issue("implementation", `${location}.${extra}`, `unsupported field "${extra}".`));
  for (const [key, entry] of Object.entries(value)) {
    if (allowed.has(key) && typeof entry !== "function") {
      issues.push(
        issue("implementation", `${location}.${key}`, `${location}.${key} must be a function.`),
      );
    }
  }
  return issues;
}

function validateTemplates(value: unknown): NpThemeDefinitionIssue[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [issue("implementation", "impl.templates", "impl.templates must be a plain object.")];
  }
  const issues: NpThemeDefinitionIssue[] = [];
  for (const [collection, rawTemplates] of Object.entries(value)) {
    const location = `impl.templates.${collection}`;
    if (
      !collectionSlugPattern.test(collection) ||
      !isRecord(rawTemplates) ||
      Object.keys(rawTemplates).length === 0
    ) {
      issues.push(
        issue(
          "implementation",
          location,
          "template collections need a safe slug and at least one template.",
        ),
      );
      continue;
    }
    for (const [id, rawTemplate] of Object.entries(rawTemplates)) {
      const templateLocation = `${location}.${id}`;
      if (
        !keyPattern.test(id) ||
        !isRecord(rawTemplate) ||
        unsupportedKey(rawTemplate, new Set(["label", "description", "component"]))
      ) {
        issues.push(
          issue(
            "implementation",
            templateLocation,
            "templates may contain only label, description, and component.",
          ),
        );
        continue;
      }
      if (!isTrimmedString(rawTemplate.label, 100)) {
        issues.push(
          issue(
            "implementation",
            `${templateLocation}.label`,
            "template labels must be non-empty.",
          ),
        );
      }
      const descriptionIssue = validateOptionalString(
        rawTemplate.description,
        `${templateLocation}.description`,
        500,
      );
      if (descriptionIssue) issues.push({ ...descriptionIssue, code: "implementation" });
      if (typeof rawTemplate.component !== "function") {
        issues.push(
          issue(
            "implementation",
            `${templateLocation}.component`,
            "template components must be functions.",
          ),
        );
      }
    }
  }
  return issues;
}

function validateTokens(value: unknown): NpThemeDefinitionIssue[] {
  if (value === undefined) return [];
  return npAnalyzeThemeTokensOverlay(value).map((tokenIssue) =>
    issue("implementation", tokenIssue.path.replace(/^theme/u, "impl.tokens"), tokenIssue.message),
  );
}

function validateRoute(
  value: unknown,
  location: string,
  date = false,
  patternRequired = false,
): NpThemeDefinitionIssue[] {
  if (!isRecord(value)) {
    return [issue("routes", location, "theme routes must be plain objects.")];
  }
  const allowed = new Set(
    date
      ? ["pattern", "component", "metadata", "granularity"]
      : ["pattern", "component", "metadata"],
  );
  const issues: NpThemeDefinitionIssue[] = [];
  const extra = unsupportedKey(value, allowed);
  if (extra)
    issues.push(issue("routes", `${location}.${extra}`, `unsupported route field "${extra}".`));
  if (patternRequired && value.pattern === undefined) {
    issues.push(issue("routes", `${location}.pattern`, "theme route.pattern is required."));
  } else if (value.pattern !== undefined) {
    const validation = npValidatePluginPageRoutePattern(value.pattern);
    if (!validation.ok)
      issues.push(
        issue(
          "routes",
          `${location}.pattern`,
          validation.message.replace("page route", "theme route"),
        ),
      );
  }
  if (typeof value.component !== "function") {
    issues.push(
      issue("routes", `${location}.component`, "theme route.component must be a function."),
    );
  }
  if (value.metadata !== undefined && typeof value.metadata !== "function") {
    issues.push(
      issue("routes", `${location}.metadata`, "theme route.metadata must be a function."),
    );
  }
  if (date && !["year", "month", "day"].includes(String(value.granularity))) {
    issues.push(
      issue(
        "routes",
        `${location}.granularity`,
        'date archive granularity must be "year", "month", or "day".',
      ),
    );
  }
  return issues;
}

function validateRoutes(impl: Record<string, unknown>): NpThemeDefinitionIssue[] {
  const issues: NpThemeDefinitionIssue[] = [];
  const patterns = new Set<string>();
  const addPattern = (pattern: unknown, location: string) => {
    if (typeof pattern !== "string") return;
    if (patterns.has(pattern))
      issues.push(issue("routes", location, `duplicate theme route pattern "${pattern}".`));
    patterns.add(pattern);
  };
  if (impl.routes !== undefined) {
    if (!Array.isArray(impl.routes)) {
      issues.push(issue("routes", "impl.routes", "impl.routes must be an array."));
    } else {
      for (const [index, route] of impl.routes.entries()) {
        const location = `impl.routes.${index.toString()}`;
        issues.push(...validateRoute(route, location, false, true));
        if (isRecord(route)) addPattern(route.pattern, `${location}.pattern`);
      }
    }
  }
  if (impl.archives !== undefined) {
    if (!isRecord(impl.archives)) {
      issues.push(issue("routes", "impl.archives", "impl.archives must be a plain object."));
    } else {
      const defaults: Record<string, string> = {
        byCategory: "/category/:slug",
        byTag: "/tag/:slug",
        byAuthor: "/author/:id",
        search: "/search",
      };
      for (const [collection, rawArchive] of Object.entries(impl.archives)) {
        const location = `impl.archives.${collection}`;
        if (!collectionSlugPattern.test(collection) || !isRecord(rawArchive)) {
          issues.push(
            issue(
              "routes",
              location,
              "archive entries need a safe collection slug and object value.",
            ),
          );
          continue;
        }
        const extra = unsupportedKey(
          rawArchive,
          new Set(["byCategory", "byTag", "byAuthor", "byDate", "search"]),
        );
        if (extra)
          issues.push(
            issue("routes", `${location}.${extra}`, `unsupported archive kind "${extra}".`),
          );
        for (const kind of ["byCategory", "byTag", "byAuthor", "search"] as const) {
          const entry = rawArchive[kind];
          if (entry === undefined) continue;
          const entryLocation = `${location}.${kind}`;
          issues.push(...validateRoute(entry, entryLocation));
          if (isRecord(entry))
            addPattern(entry.pattern ?? defaults[kind], `${entryLocation}.pattern`);
        }
        if (rawArchive.byDate !== undefined) {
          const entryLocation = `${location}.byDate`;
          issues.push(...validateRoute(rawArchive.byDate, entryLocation, true));
          if (isRecord(rawArchive.byDate)) {
            const dateDefaults: Record<string, string> = {
              year: "/:year(\\d{4})",
              month: "/:year(\\d{4})/:month(\\d{2})",
              day: "/:year(\\d{4})/:month(\\d{2})/:day(\\d{2})",
            };
            addPattern(
              rawArchive.byDate.pattern ?? dateDefaults[String(rawArchive.byDate.granularity)],
              `${entryLocation}.pattern`,
            );
          }
        }
      }
    }
  }
  return issues;
}

function validateNavLocations(value: unknown): NpThemeDefinitionIssue[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [
      issue("implementation", "impl.navLocations", "impl.navLocations must be a plain object."),
    ];
  }
  const issues: NpThemeDefinitionIssue[] = [];
  for (const [key, raw] of Object.entries(value)) {
    const location = `impl.navLocations.${key}`;
    if (
      npAnalyzeNavigationLocation(key).length > 0 ||
      !isRecord(raw) ||
      unsupportedKey(raw, new Set(["label", "description", "maxItems"]))
    ) {
      issues.push(
        issue(
          "implementation",
          location,
          "nav locations need a safe key and may contain label, description, and maxItems.",
        ),
      );
      continue;
    }
    if (!isTrimmedString(raw.label, 100))
      issues.push(
        issue("implementation", `${location}.label`, "nav location labels must be non-empty."),
      );
    const descriptionIssue = validateOptionalString(
      raw.description,
      `${location}.description`,
      500,
    );
    if (descriptionIssue) issues.push({ ...descriptionIssue, code: "implementation" });
    if (
      raw.maxItems !== undefined &&
      (typeof raw.maxItems !== "number" || !Number.isInteger(raw.maxItems) || raw.maxItems < 1)
    ) {
      issues.push(
        issue("implementation", `${location}.maxItems`, "maxItems must be a positive integer."),
      );
    }
  }
  return issues;
}

function validateMembers(value: unknown): NpThemeDefinitionIssue[] {
  if (value === undefined) return [];
  if (
    !isRecord(value) ||
    unsupportedKey(value, new Set(["shell", "pageTitle", "notFound", "error"]))
  ) {
    return [
      issue(
        "implementation",
        "impl.members",
        "impl.members may contain only shell, pageTitle, notFound, and error.",
      ),
    ];
  }
  const issues: NpThemeDefinitionIssue[] = [];
  for (const key of ["notFound", "error"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "function") {
      issues.push(
        issue("implementation", `impl.members.${key}`, `impl.members.${key} must be a function.`),
      );
    }
  }
  if (value.shell !== undefined && value.shell !== null && typeof value.shell !== "function") {
    issues.push(
      issue(
        "implementation",
        "impl.members.shell",
        "impl.members.shell must be a function or null.",
      ),
    );
  }
  if (value.pageTitle !== undefined) {
    if (!isRecord(value.pageTitle) || unsupportedKey(value.pageTitle, memberTitleKeys)) {
      issues.push(
        issue(
          "implementation",
          "impl.members.pageTitle",
          "impl.members.pageTitle contains an unsupported page key.",
        ),
      );
    } else {
      for (const [key, title] of Object.entries(value.pageTitle)) {
        if (!isTrimmedString(title, 200))
          issues.push(
            issue(
              "implementation",
              `impl.members.pageTitle.${key}`,
              "member page titles must be non-empty strings.",
            ),
          );
      }
    }
  }
  return issues;
}

function validateSeo(value: unknown): NpThemeDefinitionIssue[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [issue("implementation", "impl.seo", "impl.seo must be a plain object.")];
  }
  return validateFunctionMap(
    value,
    "impl.seo",
    new Set(["sitemapEntries", "feedEntries", "robotsTxt"]),
  ).map((entry) => ({ ...entry, code: "implementation" }));
}

function validateSeedShape(value: unknown): NpThemeDefinitionIssue[] {
  if (value === undefined) return [];
  if (
    !isRecord(value) ||
    unsupportedKey(value, new Set(["tags", "categories", "pages", "posts", "navigation"]))
  ) {
    return [
      issue(
        "seed",
        "impl.seedContent",
        "seedContent may contain only tags, categories, pages, posts, and navigation.",
      ),
    ];
  }
  const issues: NpThemeDefinitionIssue[] = [];
  for (const key of ["tags", "categories", "pages", "posts"] as const) {
    if (value[key] !== undefined && !Array.isArray(value[key])) {
      issues.push(
        issue("seed", `impl.seedContent.${key}`, `${key} seed content must be an array.`),
      );
    }
  }
  if (value.navigation !== undefined && !isRecord(value.navigation)) {
    issues.push(
      issue(
        "seed",
        "impl.seedContent.navigation",
        "navigation seed content must be a plain object.",
      ),
    );
  }
  return issues;
}

function validateImplementation(value: unknown): NpThemeDefinitionIssue[] {
  if (!isRecord(value)) {
    return [issue("implementation", "impl", "theme.impl must be a plain object.")];
  }
  const issues: NpThemeDefinitionIssue[] = [];
  const extra = unsupportedKey(value, implKeys);
  if (extra)
    issues.push(
      issue(
        "implementation",
        `impl.${extra}`,
        `unsupported theme implementation field "${extra}".`,
      ),
    );
  for (const key of ["shell", "notFound", "error"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "function") {
      issues.push(issue("implementation", `impl.${key}`, `impl.${key} must be a function.`));
    }
  }
  if (value.slots !== undefined)
    issues.push(...validateFunctionMap(value.slots, "impl.slots", slotKeys));
  if (value.css !== undefined && typeof value.css !== "string") {
    issues.push(issue("implementation", "impl.css", "impl.css must be a string."));
  }
  for (const key of ["blocks", "patterns"] as const) {
    if (value[key] !== undefined && !Array.isArray(value[key])) {
      issues.push(issue("implementation", `impl.${key}`, `impl.${key} must be an array.`));
    }
  }
  if (value.i18n !== undefined) {
    for (const entry of npAnalyzePluginI18nBundles(value.i18n)) {
      issues.push(issue("implementation", `impl.${entry.location}`, entry.message));
    }
  }
  issues.push(
    ...validateTemplates(value.templates),
    ...validateTokens(value.tokens),
    ...validateRoutes(value),
    ...validateNavLocations(value.navLocations),
    ...validateMembers(value.members),
    ...validateSeo(value.seo),
    ...validateSeedShape(value.seedContent),
  );
  return issues;
}

export function npAnalyzeRegisteredThemeDefinition(value: unknown): NpThemeDefinitionIssue[] {
  if (!isRecord(value)) {
    return [issue("definition", "theme", "theme definition must be a plain object.")];
  }
  const issues: NpThemeDefinitionIssue[] = [];
  const extra = unsupportedKey(value, themeKeys);
  if (extra)
    issues.push(issue("definition", extra, `unsupported theme definition field "${extra}".`));
  issues.push(...validateManifest(value.manifest), ...validateImplementation(value.impl));
  return issues;
}

export function npValidateRegisteredThemeDefinition(
  value: unknown,
): NpThemeDefinitionValidationResult {
  const first = npAnalyzeRegisteredThemeDefinition(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}
