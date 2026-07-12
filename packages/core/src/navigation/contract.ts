import type { NpNavigationItems } from "./types.js";

export const npNavigationItemTypes = ["link", "collection", "page"] as const;
export type NpNavigationItemType = (typeof npNavigationItemTypes)[number];

export const npNavigationLimits = {
  maxDepth: 2,
  maxItems: 200,
  itemIdLength: 128,
  labelLength: 200,
  urlLength: 2048,
  locationLength: 63,
  collectionSlugLength: 63,
} as const;

/** Top-level item + one nested child level, matching the Admin editor. */
export const npNavigationMaxDepth = npNavigationLimits.maxDepth;

/** Hard safety bound for one location's complete recursive tree. */
export const npNavigationMaxItems = npNavigationLimits.maxItems;

export const npNavigationItemIdPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";
export const npNavigationCollectionSlugPattern = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$";
export const npNavigationLocationPattern = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

export type NpNavigationContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "duplicate-id" | "max-depth" | "max-items";

export interface NpNavigationContractIssue {
  readonly code: NpNavigationContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export type NpNavigationValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpNavigationContractIssue };

const itemTypeSet = new Set<string>(npNavigationItemTypes);
const baseKeys = ["id", "label", "type", "children"] as const;
const allItemKeys = new Set([...baseKeys, "url", "collection", "collectionSlug", "pageId"]);
const typeKeys: Record<NpNavigationItemType, ReadonlySet<string>> = {
  link: new Set([...baseKeys, "url"]),
  collection: new Set([...baseKeys, "collection"]),
  page: new Set([...baseKeys, "pageId", "collectionSlug"]),
};
const safeIdPattern = new RegExp(npNavigationItemIdPattern, "u");
const collectionSlugPattern = new RegExp(npNavigationCollectionSlugPattern, "u");
const locationPattern = new RegExp(npNavigationLocationPattern, "u");
const allowedAbsoluteSchemes = new Set(["http", "https", "mailto", "tel"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function issue(
  code: NpNavigationContractIssueCode,
  path: string,
  message: string,
): NpNavigationContractIssue {
  return { code, path, message };
}

function isTrimmedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function validateSafeId(
  value: unknown,
  path: string,
  label: string,
): NpNavigationContractIssue | null {
  return typeof value === "string" && safeIdPattern.test(value)
    ? null
    : issue(
        "invalid-field",
        path,
        `${label} must start with a letter or number and use at most ${npNavigationLimits.itemIdLength.toString()} letters, numbers, dots, underscores, colons, or hyphens.`,
      );
}

function validateLabel(value: unknown, path: string): NpNavigationContractIssue | null {
  return isTrimmedString(value, npNavigationLimits.labelLength)
    ? null
    : issue(
        "invalid-field",
        path,
        `navigation item labels must be trimmed strings of 1–${npNavigationLimits.labelLength.toString()} characters.`,
      );
}

function validateCollectionSlug(
  value: unknown,
  path: string,
  label: string,
): NpNavigationContractIssue | null {
  return typeof value === "string" &&
    value.length <= npNavigationLimits.collectionSlugLength &&
    collectionSlugPattern.test(value)
    ? null
    : issue(
        "invalid-field",
        path,
        `${label} must be a lowercase kebab-case collection slug of 1–${npNavigationLimits.collectionSlugLength.toString()} characters.`,
      );
}

function validateLinkUrl(value: unknown, path: string): NpNavigationContractIssue | null {
  if (!isTrimmedString(value, npNavigationLimits.urlLength) || /\s|\\/u.test(value)) {
    return issue(
      "invalid-field",
      path,
      `navigation link URLs must be trimmed, whitespace-free strings of 1–${npNavigationLimits.urlLength.toString()} characters.`,
    );
  }
  if (value.startsWith("//")) {
    return issue("invalid-field", path, "protocol-relative navigation URLs are not supported.");
  }
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(value)?.[1]?.toLowerCase();
  if (scheme && !allowedAbsoluteSchemes.has(scheme)) {
    return issue(
      "invalid-field",
      path,
      'absolute navigation URLs must use "http", "https", "mailto", or "tel".',
    );
  }
  return null;
}

interface AnalysisState {
  readonly issues: NpNavigationContractIssue[];
  readonly idPaths: Map<string, string>;
  readonly ancestors: Set<object>;
  count: number;
  sizeReported: boolean;
}

function analyzeItem(value: unknown, path: string, depth: number, state: AnalysisState): void {
  state.count += 1;
  if (state.count > npNavigationMaxItems && !state.sizeReported) {
    state.sizeReported = true;
    state.issues.push(
      issue(
        "max-items",
        "navigation.items",
        `navigation trees may contain at most ${npNavigationMaxItems.toString()} items.`,
      ),
    );
  }
  if (state.count > npNavigationMaxItems) return;

  if (!isPlainRecord(value)) {
    state.issues.push(issue("shape", path, "navigation items must be plain objects."));
    return;
  }
  if (state.ancestors.has(value)) {
    state.issues.push(issue("shape", path, "navigation trees must not contain circular items."));
    return;
  }
  state.ancestors.add(value);

  const rawType = value.type;
  const itemType =
    typeof rawType === "string" && itemTypeSet.has(rawType)
      ? (rawType as NpNavigationItemType)
      : null;
  if (!itemType) {
    state.issues.push(
      issue(
        "invalid-field",
        `${path}.type`,
        'navigation item type must be "link", "collection", or "page".',
      ),
    );
  }

  const allowedKeys = itemType ? typeKeys[itemType] : allItemKeys;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      state.issues.push(
        issue(
          "unknown-field",
          `${path}.${key}`,
          itemType
            ? `navigation ${itemType} items do not support field "${key}".`
            : `unsupported navigation item field "${key}".`,
        ),
      );
    }
  }

  const idIssue = validateSafeId(value.id, `${path}.id`, "navigation item ids");
  if (idIssue) {
    state.issues.push(idIssue);
  } else {
    const id = value.id as string;
    const firstPath = state.idPaths.get(id);
    if (firstPath) {
      state.issues.push(
        issue("duplicate-id", `${path}.id`, `navigation item id "${id}" duplicates ${firstPath}.`),
      );
    } else {
      state.idPaths.set(id, `${path}.id`);
    }
  }

  const labelIssue = validateLabel(value.label, `${path}.label`);
  if (labelIssue) state.issues.push(labelIssue);

  if (itemType === "link") {
    const urlIssue = validateLinkUrl(value.url, `${path}.url`);
    if (urlIssue) state.issues.push(urlIssue);
  } else if (itemType === "collection") {
    const collectionIssue = validateCollectionSlug(
      value.collection,
      `${path}.collection`,
      "navigation collection references",
    );
    if (collectionIssue) state.issues.push(collectionIssue);
  } else if (itemType === "page") {
    const pageIssue = validateSafeId(value.pageId, `${path}.pageId`, "navigation page references");
    if (pageIssue) state.issues.push(pageIssue);
    if (value.collectionSlug !== undefined || Object.hasOwn(value, "collectionSlug")) {
      const collectionSlugIssue = validateCollectionSlug(
        value.collectionSlug,
        `${path}.collectionSlug`,
        "navigation page collectionSlug values",
      );
      if (collectionSlugIssue) state.issues.push(collectionSlugIssue);
    }
  }

  if (value.children !== undefined || Object.hasOwn(value, "children")) {
    if (!Array.isArray(value.children)) {
      state.issues.push(
        issue("shape", `${path}.children`, "navigation item children must be an array."),
      );
    } else if (value.children.length > 0 && depth >= npNavigationMaxDepth) {
      state.issues.push(
        issue(
          "max-depth",
          `${path}.children`,
          `navigation trees support at most ${npNavigationMaxDepth.toString()} item levels.`,
        ),
      );
    } else {
      for (const [index, child] of value.children.entries()) {
        analyzeItem(child, `${path}.children.${index.toString()}`, depth + 1, state);
      }
    }
  }

  state.ancestors.delete(value);
}

export function npAnalyzeNavigationItems(value: unknown): NpNavigationContractIssue[] {
  if (!Array.isArray(value)) {
    return [issue("shape", "navigation.items", "navigation items must be an array.")];
  }
  const state: AnalysisState = {
    issues: [],
    idPaths: new Map(),
    ancestors: new Set(),
    count: 0,
    sizeReported: false,
  };
  for (const [index, item] of value.entries()) {
    analyzeItem(item, `navigation.items.${index.toString()}`, 1, state);
    if (state.sizeReported) break;
  }
  return state.issues;
}

export function npValidateNavigationItems(value: unknown): NpNavigationValidationResult {
  const issue = npAnalyzeNavigationItems(value)[0];
  return issue ? { ok: false, issue } : { ok: true };
}

export function isNpNavigationItems(value: unknown): value is NpNavigationItems {
  return npValidateNavigationItems(value).ok;
}

export function npAnalyzeNavigationLocation(value: unknown): NpNavigationContractIssue[] {
  if (
    typeof value === "string" &&
    value.length <= npNavigationLimits.locationLength &&
    locationPattern.test(value)
  ) {
    return [];
  }
  return [
    issue(
      "invalid-field",
      "navigation.location",
      `navigation locations must be lowercase kebab-case slugs of 1–${npNavigationLimits.locationLength.toString()} letters, numbers, or hyphens.`,
    ),
  ];
}

export function npValidateNavigationLocation(value: unknown): NpNavigationValidationResult {
  const issue = npAnalyzeNavigationLocation(value)[0];
  return issue ? { ok: false, issue } : { ok: true };
}

export function isNpNavigationLocation(value: unknown): value is string {
  return npValidateNavigationLocation(value).ok;
}
