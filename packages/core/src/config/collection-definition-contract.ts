import type { NpCollectionConfig, NpFieldConfig } from "./types.js";
import { collectionConfigSchema } from "./validation.js";
import { npAnalyzeMediaProcessingOptions } from "../media-contract/contract.js";

export type NpCollectionDefinitionIssueCode = "shape" | "field" | "reference";

export interface NpCollectionDefinitionIssue {
  readonly code: NpCollectionDefinitionIssueCode;
  readonly location: string;
  readonly message: string;
}

export type NpCollectionDefinitionValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpCollectionDefinitionIssue };

const fieldNamePattern = /^[a-z][A-Za-z0-9]*$/u;
const collectionSlugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const reservedFieldNames = new Set([
  "id",
  "status",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "visibility",
  "siteId",
  "memberAuthorId",
  "locale",
  "translationGroupId",
  "searchVector",
  "_status",
]);
const builtinRelationshipTargets = new Set(["media", "users"]);
const reservedReportTargets = new Set(["comment", "member"]);
const reservedFollowTargets = new Set(["member"]);

function issue(
  code: NpCollectionDefinitionIssueCode,
  location: string,
  message: string,
): NpCollectionDefinitionIssue {
  return { code, location, message };
}

function pathOf(parts: readonly PropertyKey[]): string {
  return parts.map(String).join(".");
}

function addDuplicateValues(
  values: readonly string[],
  location: string,
  label: string,
  issues: NpCollectionDefinitionIssue[],
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      issues.push(
        issue("field", `${location}.${index.toString()}`, `duplicate ${label} "${value}".`),
      );
    }
    seen.add(value);
  }
}

function validateBounds(
  minimum: number | undefined,
  maximum: number | undefined,
  location: string,
  issues: NpCollectionDefinitionIssue[],
): void {
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    issues.push(issue("field", location, "minimum must not exceed maximum."));
  }
}

function validateNamedField(
  field: Exclude<NpFieldConfig, { type: "row" | "collapsible" }>,
  location: string,
  issues: NpCollectionDefinitionIssue[],
  nestedRecord: boolean,
): void {
  if (!fieldNamePattern.test(field.name)) {
    issues.push(
      issue(
        "field",
        `${location}.name`,
        "field names must use lower camelCase letters and numbers.",
      ),
    );
  }
  if (reservedFieldNames.has(field.name)) {
    issues.push(
      issue("field", `${location}.name`, `field name "${field.name}" is framework-reserved.`),
    );
  }
  if (nestedRecord && field.name === "publishedAt") {
    issues.push(
      issue(
        "field",
        `${location}.name`,
        '"publishedAt" must be a top-level field because scheduled publishing reads the generated top-level column.',
      ),
    );
  }

  switch (field.type) {
    case "text":
    case "textarea":
      validateBounds(field.minLength, field.maxLength, location, issues);
      break;
    case "number":
      validateBounds(field.min, field.max, location, issues);
      break;
    case "blocks":
      validateBounds(field.minRows, field.maxRows, location, issues);
      if (field.allowedBlocks) {
        addDuplicateValues(field.allowedBlocks, `${location}.allowedBlocks`, "block type", issues);
      }
      break;
    case "array":
      validateBounds(field.minRows, field.maxRows, location, issues);
      if (nestedRecord) {
        issues.push(
          issue(
            "field",
            location,
            "array fields cannot be nested inside group or array storage records.",
          ),
        );
      }
      break;
    case "select":
      if (field.hasMany) {
        issues.push(
          issue(
            "field",
            `${location}.hasMany`,
            "select fields do not support hasMany persistence.",
          ),
        );
      }
      addDuplicateValues(
        field.options.map((option) => option.value),
        `${location}.options`,
        "option value",
        issues,
      );
      break;
    case "radio":
      addDuplicateValues(
        field.options.map((option) => option.value),
        `${location}.options`,
        "option value",
        issues,
      );
      break;
    case "relationship": {
      const targets = Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo];
      if (Array.isArray(field.relationTo)) {
        issues.push(
          issue(
            "field",
            `${location}.relationTo`,
            "polymorphic relationship targets are not supported by collection persistence.",
          ),
        );
      }
      if (nestedRecord && field.hasMany) {
        issues.push(
          issue(
            "field",
            `${location}.hasMany`,
            "hasMany relationships cannot be nested inside group or array storage records.",
          ),
        );
      }
      for (const [index, target] of targets.entries()) {
        if (!collectionSlugPattern.test(target)) {
          issues.push(
            issue(
              "reference",
              `${location}.relationTo${targets.length > 1 ? `.${index.toString()}` : ""}`,
              `relationship target "${target}" must be a lowercase collection slug.`,
            ),
          );
        }
      }
      addDuplicateValues(targets, `${location}.relationTo`, "relationship target", issues);
      break;
    }
    case "upload":
      if (field.relationTo !== "media") {
        issues.push(
          issue(
            "reference",
            `${location}.relationTo`,
            'upload fields must target the framework "media" collection.',
          ),
        );
      }
      break;
    default:
      break;
  }
}

function validateFieldList(
  fields: NpFieldConfig[],
  location: string,
  issues: NpCollectionDefinitionIssue[],
  sharedNames = new Map<string, string>(),
  nestedRecord = false,
): void {
  for (const [index, field] of fields.entries()) {
    const fieldLocation = `${location}.${index.toString()}`;
    if (field.type === "row" || field.type === "collapsible") {
      validateFieldList(field.fields, `${fieldLocation}.fields`, issues, sharedNames, nestedRecord);
      continue;
    }

    const previous = sharedNames.get(field.name);
    if (previous) {
      issues.push(
        issue(
          "field",
          `${fieldLocation}.name`,
          `duplicate field name "${field.name}"; first declared at ${previous}.`,
        ),
      );
    } else {
      sharedNames.set(field.name, `${fieldLocation}.name`);
    }
    validateNamedField(field, fieldLocation, issues, nestedRecord);

    if (field.type === "group" || field.type === "array") {
      validateFieldList(
        field.fields,
        `${fieldLocation}.fields`,
        issues,
        new Map<string, string>(),
        true,
      );
    }
  }
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hasTopLevelFieldName(fields: NpFieldConfig[], name: string): boolean {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      if (hasTopLevelFieldName(field.fields, name)) return true;
    } else if (field.name === name) {
      return true;
    }
  }
  return false;
}

function validateStorageNames(
  fields: NpFieldConfig[],
  location: string,
  issues: NpCollectionDefinitionIssue[],
  prefix: string[] = [],
  seen = new Map<string, string>(),
): void {
  for (const [index, field] of fields.entries()) {
    const fieldLocation = `${location}.${index.toString()}`;
    if (field.type === "row" || field.type === "collapsible") {
      validateStorageNames(field.fields, `${fieldLocation}.fields`, issues, prefix, seen);
      continue;
    }
    if (field.type === "group") {
      validateStorageNames(
        field.fields,
        `${fieldLocation}.fields`,
        issues,
        [...prefix, field.name],
        seen,
      );
      continue;
    }
    if (field.type === "array") {
      const nestedSeen = new Map<string, string>([
        ["id", "nested table system column"],
        ["parentId", "nested table system column"],
        ["order", "nested table system column"],
      ]);
      validateStorageNames(field.fields, `${fieldLocation}.fields`, issues, [], nestedSeen);
      continue;
    }
    if (field.type === "relationship" && field.hasMany) {
      continue;
    }

    const storageName =
      prefix.length === 0
        ? field.name
        : `${prefix[0]}${prefix.slice(1).map(upperFirst).join("")}${upperFirst(field.name)}`;
    const previous = seen.get(storageName);
    if (previous) {
      issues.push(
        issue(
          "field",
          `${fieldLocation}.name`,
          `generated storage field "${storageName}" collides with ${previous}.`,
        ),
      );
    } else {
      seen.set(storageName, `${fieldLocation}.name`);
    }
  }
}

function semanticIssues(config: NpCollectionConfig): NpCollectionDefinitionIssue[] {
  const issues: NpCollectionDefinitionIssue[] = [];
  if (builtinRelationshipTargets.has(config.slug)) {
    issues.push(
      issue(
        "field",
        "slug",
        `collection slug "${config.slug}" is reserved for a framework relation target.`,
      ),
    );
  }
  if (config.community?.reports === true && reservedReportTargets.has(config.slug)) {
    issues.push(
      issue(
        "reference",
        "community.reports",
        `collection slug "${config.slug}" is a reserved report target and cannot enable document reports.`,
      ),
    );
  }
  if (config.community?.follows === true && reservedFollowTargets.has(config.slug)) {
    issues.push(
      issue(
        "reference",
        "community.follows",
        `collection slug "${config.slug}" is a reserved follow target and cannot enable document follows.`,
      ),
    );
  }
  if (config.community?.follows === true && typeof config.seo?.urlPath !== "function") {
    issues.push(
      issue(
        "reference",
        "community.follows",
        "document follows require seo.urlPath so every subscription can resolve a public destination.",
      ),
    );
  }
  const profileActivity = config.community?.profileActivity;
  if (profileActivity && profileActivity.documents !== true && profileActivity.comments !== true) {
    issues.push(
      issue(
        "reference",
        "community.profileActivity",
        "profile activity must enable documents, comments, or both.",
      ),
    );
  }
  if (profileActivity?.documents === true && config.community?.memberWrite?.create !== true) {
    issues.push(
      issue(
        "reference",
        "community.profileActivity.documents",
        "document profile activity requires community.memberWrite.create=true.",
      ),
    );
  }
  if (profileActivity?.comments === true && config.community?.comments !== true) {
    issues.push(
      issue(
        "reference",
        "community.profileActivity.comments",
        "comment profile activity requires community.comments=true.",
      ),
    );
  }
  if (
    (profileActivity?.documents === true || profileActivity?.comments === true) &&
    typeof config.seo?.urlPath !== "function"
  ) {
    issues.push(
      issue(
        "reference",
        "community.profileActivity",
        "public profile activity requires seo.urlPath for target destinations.",
      ),
    );
  }
  if (
    (profileActivity?.documents === true || profileActivity?.comments === true) &&
    config.timestamps === false
  ) {
    issues.push(
      issue(
        "reference",
        "community.profileActivity",
        "public profile activity requires collection timestamps.",
      ),
    );
  }
  validateFieldList(config.fields, "fields", issues);
  const topLevelStorageNames = new Map<string, string>();
  for (const name of reservedFieldNames) {
    topLevelStorageNames.set(name, "a framework system column");
  }
  if (config.slugField) topLevelStorageNames.set("slug", "the generated slug column");
  if (config.versions?.drafts && !hasTopLevelFieldName(config.fields, "publishedAt")) {
    topLevelStorageNames.set("publishedAt", "the generated scheduled-publishing column");
  }
  validateStorageNames(config.fields, "fields", issues, [], topLevelStorageNames);

  const topLevelFields = new Map<string, NpFieldConfig>();
  const collectTopLevel = (fields: NpFieldConfig[]): void => {
    for (const field of fields) {
      if (field.type === "row" || field.type === "collapsible") collectTopLevel(field.fields);
      else topLevelFields.set(field.name, field);
    }
  };
  collectTopLevel(config.fields);
  const topLevelNames = new Set(topLevelFields.keys());
  const memberWrite = config.community?.memberWrite;
  const moderation = config.community?.moderation;
  if (moderation) {
    const mappedStateFields = [
      moderation.hiddenField,
      moderation.lockField,
      moderation.pinField,
    ].filter((field): field is string => field !== undefined);
    if (new Set(mappedStateFields).size !== mappedStateFields.length) {
      issues.push(
        issue(
          "reference",
          "community.moderation",
          "hiddenField, lockField, and pinField must name distinct checkbox fields.",
        ),
      );
    }
    if (!config.versions?.drafts) {
      issues.push(
        issue(
          "reference",
          "community.moderation",
          "thread moderation requires versions.drafts so hide and restore status transitions stay private.",
        ),
      );
    }
    for (const operation of ["update", "delete"] as const) {
      if (memberWrite?.[operation] !== true) {
        issues.push(
          issue(
            "reference",
            "community.moderation",
            `thread moderation requires community.memberWrite.${operation}=true for its complete capability contract.`,
          ),
        );
      }
    }
    if (moderation.categoryField) {
      const field = topLevelFields.get(moderation.categoryField);
      if (!field) {
        issues.push(
          issue(
            "reference",
            "community.moderation.categoryField",
            `category field "${moderation.categoryField}" is not a top-level collection field.`,
          ),
        );
      } else if (
        field.type !== "relationship" ||
        field.hasMany === true ||
        typeof field.relationTo !== "string" ||
        field.required !== true
      ) {
        issues.push(
          issue(
            "reference",
            "community.moderation.categoryField",
            "category field must be a required, single, non-polymorphic relationship so scope ids stay stable and discoverable.",
          ),
        );
      }
    }
    for (const [key, fieldName] of [
      ["hiddenField", moderation.hiddenField],
      ["lockField", moderation.lockField],
      ["pinField", moderation.pinField],
    ] as const) {
      if (!fieldName) continue;
      const field = topLevelFields.get(fieldName);
      if (!field) {
        issues.push(
          issue(
            "reference",
            `community.moderation.${key}`,
            `${key === "hiddenField" ? "hidden-state" : key === "lockField" ? "lock" : "pin"} field "${fieldName}" is not a top-level collection field.`,
          ),
        );
      } else if (field.type !== "checkbox") {
        issues.push(
          issue(
            "reference",
            `community.moderation.${key}`,
            `${key === "hiddenField" ? "hidden-state" : key === "lockField" ? "lock" : "pin"} field must be a checkbox.`,
          ),
        );
      } else if (
        key === "hiddenField" &&
        (field.required !== true || field.defaultValue !== false)
      ) {
        issues.push(
          issue(
            "field",
            "community.moderation.hiddenField",
            "hidden-state field must be required and default to false so first approval and moderation restore remain distinguishable.",
          ),
        );
      }
    }
    if (!memberWrite?.writableFields) {
      issues.push(
        issue(
          "reference",
          "community.moderation",
          "thread moderation requires an explicit community.memberWrite.writableFields allow-list that excludes moderation state.",
        ),
      );
    } else {
      for (const [key, fieldName] of [
        ["hiddenField", moderation.hiddenField],
        ["lockField", moderation.lockField],
        ["pinField", moderation.pinField],
      ] as const) {
        if (fieldName && memberWrite.writableFields.includes(fieldName)) {
          issues.push(
            issue(
              "reference",
              "community.memberWrite.writableFields",
              `moderation ${key} "${fieldName}" must remain operator-only.`,
            ),
          );
        }
      }
    }
  }
  if (memberWrite?.writableFields) {
    addDuplicateValues(
      memberWrite.writableFields,
      "community.memberWrite.writableFields",
      "writable field",
      issues,
    );
    for (const [index, name] of memberWrite.writableFields.entries()) {
      if (!topLevelNames.has(name)) {
        issues.push(
          issue(
            "reference",
            `community.memberWrite.writableFields.${index.toString()}`,
            `member writable field "${name}" is not a top-level collection field.`,
          ),
        );
      }
    }
  }
  for (const operation of ["create", "update", "delete"] as const) {
    if (memberWrite?.access?.[operation] && memberWrite[operation] !== true) {
      issues.push(
        issue(
          "reference",
          `community.memberWrite.access.${operation}`,
          `member ${operation} access requires community.memberWrite.${operation}=true.`,
        ),
      );
    }
  }
  if (memberWrite?.resolveCreateStatus && memberWrite.create !== true) {
    issues.push(
      issue(
        "reference",
        "community.memberWrite.resolveCreateStatus",
        "member create status resolution requires community.memberWrite.create=true.",
      ),
    );
  }
  const publishedAtField = topLevelFields.get("publishedAt");
  if (publishedAtField && publishedAtField.type !== "date") {
    issues.push(
      issue(
        "field",
        "fields",
        'top-level field "publishedAt" must use type "date" for scheduled publishing.',
      ),
    );
  }
  const systemFields = new Set([
    "id",
    "status",
    "createdBy",
    "updatedBy",
    "visibility",
    "siteId",
    "searchVector",
  ]);
  if (config.timestamps !== false) {
    systemFields.add("createdAt");
    systemFields.add("updatedAt");
  }
  if (config.slugField !== undefined && config.slugField !== false) systemFields.add("slug");
  if (config.i18n) {
    systemFields.add("locale");
    systemFields.add("translationGroupId");
  }
  if (config.community?.memberWrite?.create) systemFields.add("memberAuthorId");
  if (config.versions?.drafts) {
    systemFields.add("publishedAt");
  }

  if (config.slugField) {
    const source =
      typeof config.slugField === "object" ? (config.slugField.useField ?? "title") : "title";
    if (!topLevelNames.has(source)) {
      issues.push(
        issue(
          "reference",
          "slugField.useField",
          `slugField source "${source}" is not a top-level collection field.`,
        ),
      );
    } else {
      const sourceField = topLevelFields.get(source);
      if (
        sourceField &&
        !["text", "textarea", "email", "select", "radio"].includes(sourceField.type)
      ) {
        issues.push(
          issue(
            "reference",
            "slugField.useField",
            `slugField source "${source}" must be a top-level string field.`,
          ),
        );
      }
    }
    if (topLevelNames.has("slug")) {
      issues.push(
        issue("field", "fields", 'field name "slug" collides with the generated slug column.'),
      );
    }
  }

  if (config.admin?.listColumns) {
    addDuplicateValues(config.admin.listColumns, "admin.listColumns", "list column", issues);
    for (const [index, column] of config.admin.listColumns.entries()) {
      if (!topLevelNames.has(column) && !systemFields.has(column)) {
        issues.push(
          issue(
            "reference",
            `admin.listColumns.${index.toString()}`,
            `list column "${column}" is not a top-level or framework field.`,
          ),
        );
      }
    }
  }
  if (config.admin?.defaultSort) {
    const field = config.admin.defaultSort.replace(/^-/, "");
    const sortableFields = new Set<string>();
    const collectSortable = (fields: NpFieldConfig[]): void => {
      for (const candidate of fields) {
        if (candidate.type === "row" || candidate.type === "collapsible") {
          collectSortable(candidate.fields);
        } else if (
          candidate.type !== "group" &&
          candidate.type !== "array" &&
          !(candidate.type === "relationship" && candidate.hasMany)
        ) {
          sortableFields.add(candidate.name);
        }
      }
    };
    collectSortable(config.fields);
    if (!sortableFields.has(field) && !systemFields.has(field)) {
      issues.push(
        issue(
          "reference",
          "admin.defaultSort",
          `default sort field "${field}" is not a top-level or framework field.`,
        ),
      );
    }
  }

  if (config.upload?.imageSizes) {
    addDuplicateValues(
      config.upload.imageSizes.map((size) => size.name),
      "upload.imageSizes",
      "image size name",
      issues,
    );
    for (const mediaIssue of npAnalyzeMediaProcessingOptions({
      sizes: config.upload.imageSizes,
    })) {
      issues.push(
        issue(
          "shape",
          mediaIssue.path.replace(/^media\.processing\.sizes/u, "upload.imageSizes"),
          mediaIssue.message,
        ),
      );
    }
  }
  return issues;
}

export function npAnalyzeCollectionDefinition(value: unknown): NpCollectionDefinitionIssue[] {
  const parsed = collectionConfigSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((entry) => issue("shape", pathOf(entry.path), entry.message));
  }
  return semanticIssues(parsed.data as NpCollectionConfig);
}

export function npValidateCollectionDefinition(
  value: unknown,
): NpCollectionDefinitionValidationResult {
  const first = npAnalyzeCollectionDefinition(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function npAssertCollectionDefinition(value: unknown): asserts value is NpCollectionConfig {
  const validation = npValidateCollectionDefinition(value);
  if (!validation.ok) {
    throw new Error(
      `Invalid collection definition at ${validation.issue.location || "collection"}: ${validation.issue.message}`,
    );
  }
}

function visitRelationshipTargets(
  fields: NpFieldConfig[],
  location: string,
  visit: (target: string, location: string) => void,
): void {
  for (const [index, field] of fields.entries()) {
    const fieldLocation = `${location}.${index.toString()}`;
    if (
      field.type === "row" ||
      field.type === "collapsible" ||
      field.type === "group" ||
      field.type === "array"
    ) {
      visitRelationshipTargets(field.fields, `${fieldLocation}.fields`, visit);
    } else if (field.type === "relationship") {
      const targets = Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo];
      for (const [targetIndex, target] of targets.entries()) {
        visit(
          target,
          `${fieldLocation}.relationTo${targets.length > 1 ? `.${targetIndex.toString()}` : ""}`,
        );
      }
    }
  }
}

export function npAnalyzeCollectionDefinitions(value: unknown): NpCollectionDefinitionIssue[] {
  if (!Array.isArray(value)) {
    return [issue("shape", "collections", "collection definitions must be an array.")];
  }

  const issues: NpCollectionDefinitionIssue[] = [];
  const validCollections: Array<{ index: number; config: NpCollectionConfig }> = [];
  for (const [index, entry] of value.entries()) {
    const entryIssues = npAnalyzeCollectionDefinition(entry);
    issues.push(
      ...entryIssues.map((entryIssue) => ({
        ...entryIssue,
        location: `${index.toString()}${entryIssue.location ? `.${entryIssue.location}` : ""}`,
      })),
    );
    const parsed = collectionConfigSchema.safeParse(entry);
    if (parsed.success) {
      validCollections.push({ index, config: parsed.data as NpCollectionConfig });
    }
  }

  const slugLocations = new Map<string, number>();
  for (const { index, config } of validCollections) {
    const previous = slugLocations.get(config.slug);
    if (previous !== undefined) {
      issues.push(
        issue(
          "reference",
          `${index.toString()}.slug`,
          `duplicate collection slug "${config.slug}"; first declared at ${previous.toString()}.slug.`,
        ),
      );
    } else {
      slugLocations.set(config.slug, index);
    }
  }

  const availableTargets = new Set([...builtinRelationshipTargets, ...slugLocations.keys()]);
  for (const { index, config } of validCollections) {
    visitRelationshipTargets(config.fields, `${index.toString()}.fields`, (target, location) => {
      if (!availableTargets.has(target)) {
        issues.push(
          issue(
            "reference",
            location,
            `relationship target "${target}" is not a declared collection or framework target.`,
          ),
        );
      }
    });
  }
  return issues;
}

export function npValidateCollectionDefinitions(
  value: unknown,
): NpCollectionDefinitionValidationResult {
  const first = npAnalyzeCollectionDefinitions(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function npAssertCollectionDefinitions(
  value: unknown,
): asserts value is NpCollectionConfig[] {
  const validation = npValidateCollectionDefinitions(value);
  if (!validation.ok) {
    throw new Error(
      `Invalid collection definitions at ${validation.issue.location}: ${validation.issue.message}`,
    );
  }
}
