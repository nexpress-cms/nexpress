import type {
  NpCustomRoute,
  NpCustomRouteContractIssue,
  NpCustomRouteDefinition,
  NpCustomRouteKind,
  NpCustomRoutesResponse,
  NpCustomRouteValidationResult,
} from "./types.js";

export const npCustomRouteKinds = ["static", "dynamic"] as const;

export const npCustomRouteContractLimits = {
  maxRoutes: 200,
  pathLength: 256,
  labelLength: 160,
  descriptionLength: 500,
  iconLength: 63,
  groupLength: 63,
  sourceLength: 128,
} as const;

export const npCustomRouteSourcePattern = "^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)*$";
export const npCustomRouteMetadataKeyPattern = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

const definitionKeys = new Set(["path", "label", "description", "icon", "group"]);
const routeKeys = new Set([...definitionKeys, "kind", "source"]);
const responseKeys = new Set(["routes"]);
const kindSet = new Set<string>(npCustomRouteKinds);
const sourcePattern = new RegExp(npCustomRouteSourcePattern, "u");
const metadataKeyPattern = new RegExp(npCustomRouteMetadataKeyPattern, "u");
const literalSegmentPattern = /^[\p{L}\p{N}._~-]+$/u;
const dynamicSegmentPattern = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/u;
const catchAllSegmentPattern = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/u;
const optionalCatchAllSegmentPattern = /^\[\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]\]$/u;

interface Parsed<T> {
  readonly issues: NpCustomRouteContractIssue[];
  readonly value: T | null;
}

interface InspectedRecord {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly keys: readonly string[];
}

interface ParsedPath {
  readonly kind: NpCustomRouteKind;
  readonly parameterNames: readonly string[];
}

export class NpCustomRouteContractError extends TypeError {
  readonly issues: readonly NpCustomRouteContractIssue[];

  constructor(message: string, issues: readonly NpCustomRouteContractIssue[]) {
    super(message);
    this.name = "NpCustomRouteContractError";
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function issue(
  code: NpCustomRouteContractIssue["code"],
  path: string,
  message: string,
): NpCustomRouteContractIssue {
  return { code, path, message };
}

function fail<T>(issues: NpCustomRouteContractIssue[]): Parsed<T> {
  return { issues, value: null };
}

function hasUnsafeControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function isTrimmedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !hasUnsafeControl(value)
  );
}

function inspectRecord(
  value: unknown,
  path: string,
  issues: NpCustomRouteContractIssue[],
): InspectedRecord | null {
  let arrayValue: boolean;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    issues.push(issue("shape", path, "custom route values must be inspectable plain objects."));
    return null;
  }
  if (typeof value !== "object" || value === null || arrayValue) {
    issues.push(issue("shape", path, "custom route values must be plain objects."));
    return null;
  }

  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    ownKeys = Reflect.ownKeys(value);
  } catch {
    issues.push(issue("shape", path, "custom route values must be inspectable plain objects."));
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    issues.push(issue("shape", path, "custom route values must be plain objects."));
    return null;
  }

  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const keys: string[] = [];
  for (const ownKey of ownKeys) {
    if (typeof ownKey !== "string") {
      issues.push(
        issue("unknown-field", path, "custom route values must not contain symbol keys."),
      );
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
    } catch {
      issues.push(
        issue("shape", `${path}.${ownKey}`, "custom route fields must be inspectable data values."),
      );
      continue;
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      issues.push(
        issue(
          "shape",
          `${path}.${ownKey}`,
          "custom route fields must be enumerable data properties; accessors are not supported.",
        ),
      );
      continue;
    }
    fields[ownKey] = descriptor.value;
    keys.push(ownKey);
  }
  return { fields, keys };
}

function inspectArray(
  value: unknown,
  path: string,
  issues: NpCustomRouteContractIssue[],
): readonly unknown[] | null {
  let arrayValue: boolean;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    issues.push(issue("shape", path, "custom route arrays must be inspectable."));
    return null;
  }
  if (!arrayValue) {
    issues.push(issue("shape", path, "custom routes must be an array."));
    return null;
  }
  const array = value as unknown[];

  let lengthDescriptor: PropertyDescriptor | undefined;
  let ownKeys: readonly PropertyKey[];
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(array, "length");
    ownKeys = Reflect.ownKeys(array);
  } catch {
    issues.push(issue("shape", path, "custom route arrays must be inspectable."));
    return null;
  }
  const lengthValue: unknown =
    lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
  if (typeof lengthValue !== "number" || !Number.isSafeInteger(lengthValue) || lengthValue < 0) {
    issues.push(issue("shape", path, "custom route arrays must expose a valid data length."));
    return null;
  }
  const length = lengthValue;
  if (length > npCustomRouteContractLimits.maxRoutes) {
    issues.push(
      issue(
        "max-items",
        path,
        `custom route catalogs may contain at most ${npCustomRouteContractLimits.maxRoutes.toString()} routes.`,
      ),
    );
  }

  for (const ownKey of ownKeys) {
    if (ownKey === "length") continue;
    const numericIndex = typeof ownKey === "string" ? Number(ownKey) : Number.NaN;
    if (
      typeof ownKey !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(ownKey) ||
      !Number.isSafeInteger(numericIndex) ||
      numericIndex >= length
    ) {
      issues.push(
        issue("unknown-field", path, "custom route arrays must not contain custom properties."),
      );
      break;
    }
  }

  const limit = Math.min(length, npCustomRouteContractLimits.maxRoutes);
  const result: unknown[] = new Array<unknown>(limit);
  for (let index = 0; index < limit; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(array, index.toString());
    } catch {
      issues.push(
        issue(
          "shape",
          `${path}.${index.toString()}`,
          "custom route entries must be inspectable data values.",
        ),
      );
      continue;
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      issues.push(
        issue(
          "shape",
          `${path}.${index.toString()}`,
          "custom route arrays must be dense and contain only data values.",
        ),
      );
      continue;
    }
    result[index] = descriptor.value;
  }
  return result;
}

function pushUnknownFields(
  inspected: InspectedRecord,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpCustomRouteContractIssue[],
): void {
  for (const key of inspected.keys) {
    if (!allowed.has(key)) {
      issues.push(
        issue("unknown-field", `${path}.${key}`, `unsupported custom route field "${key}".`),
      );
    }
  }
}

function parsePath(
  value: unknown,
  path: string,
  issues: NpCustomRouteContractIssue[],
): ParsedPath | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npCustomRouteContractLimits.pathLength ||
    !value.startsWith("/")
  ) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `custom route paths must start with "/" and contain at most ${npCustomRouteContractLimits.pathLength.toString()} characters.`,
      ),
    );
    return null;
  }
  if (value !== "/" && (value.endsWith("/") || value.includes("//"))) {
    issues.push(
      issue(
        "invalid-field",
        path,
        "custom route paths must use canonical segments without empty or trailing segments.",
      ),
    );
    return null;
  }

  const segments = value === "/" ? [] : value.slice(1).split("/");
  const parameterNames: string[] = [];
  let dynamic = false;
  for (const [index, segment] of segments.entries()) {
    if (segment === "." || segment === "..") {
      issues.push(
        issue("invalid-field", path, "custom route paths must not contain dot segments."),
      );
      continue;
    }
    if (literalSegmentPattern.test(segment)) continue;

    const dynamicMatch = dynamicSegmentPattern.exec(segment);
    const catchAllMatch = catchAllSegmentPattern.exec(segment);
    const optionalCatchAllMatch = optionalCatchAllSegmentPattern.exec(segment);
    const parameterName = dynamicMatch?.[1] ?? catchAllMatch?.[1] ?? optionalCatchAllMatch?.[1];
    if (!parameterName) {
      issues.push(
        issue(
          "invalid-field",
          path,
          "custom route segments must be URL-safe literals, [name], [...name], or [[...name]].",
        ),
      );
      continue;
    }
    dynamic = true;
    if ((catchAllMatch || optionalCatchAllMatch) && index !== segments.length - 1) {
      issues.push(
        issue(
          "invalid-field",
          path,
          "catch-all custom route parameters must be the final segment.",
        ),
      );
    }
    if (parameterNames.includes(parameterName)) {
      issues.push(
        issue(
          "duplicate-parameter",
          path,
          `custom route path repeats parameter name "${parameterName}".`,
        ),
      );
    } else {
      parameterNames.push(parameterName);
    }
  }

  return { kind: dynamic ? "dynamic" : "static", parameterNames };
}

function parseMetadataText(
  value: unknown,
  fieldPath: string,
  label: string,
  maxLength: number,
  issues: NpCustomRouteContractIssue[],
): string | null {
  if (!isTrimmedText(value, maxLength)) {
    issues.push(
      issue(
        "invalid-field",
        fieldPath,
        `${label} must be trimmed text of 1–${maxLength.toString()} characters without control characters.`,
      ),
    );
    return null;
  }
  return value;
}

function parseMetadataKey(
  value: unknown,
  fieldPath: string,
  label: string,
  maxLength: number,
  issues: NpCustomRouteContractIssue[],
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !metadataKeyPattern.test(value)
  ) {
    issues.push(
      issue(
        "invalid-field",
        fieldPath,
        `${label} must be lowercase kebab-case text of 1–${maxLength.toString()} characters.`,
      ),
    );
    return null;
  }
  return value;
}

function parseDefinition(
  value: unknown,
  path: string,
  issues: NpCustomRouteContractIssue[],
): NpCustomRouteDefinition | null {
  const issueCount = issues.length;
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return null;
  pushUnknownFields(inspected, definitionKeys, path, issues);

  const parsedPath = parsePath(inspected.fields.path, `${path}.path`, issues);
  const label = parseMetadataText(
    inspected.fields.label,
    `${path}.label`,
    "custom route labels",
    npCustomRouteContractLimits.labelLength,
    issues,
  );
  const result: {
    path?: string;
    label?: string;
    description?: string;
    icon?: string;
    group?: string;
  } = {};
  if (parsedPath && typeof inspected.fields.path === "string") result.path = inspected.fields.path;
  if (label) result.label = label;

  if (Object.hasOwn(inspected.fields, "description")) {
    const description = parseMetadataText(
      inspected.fields.description,
      `${path}.description`,
      "custom route descriptions",
      npCustomRouteContractLimits.descriptionLength,
      issues,
    );
    if (description) result.description = description;
  }
  if (Object.hasOwn(inspected.fields, "icon")) {
    const icon = parseMetadataKey(
      inspected.fields.icon,
      `${path}.icon`,
      "custom route icons",
      npCustomRouteContractLimits.iconLength,
      issues,
    );
    if (icon) result.icon = icon;
  }
  if (Object.hasOwn(inspected.fields, "group")) {
    const group = parseMetadataKey(
      inspected.fields.group,
      `${path}.group`,
      "custom route groups",
      npCustomRouteContractLimits.groupLength,
      issues,
    );
    if (group) result.group = group;
  }

  if (issues.length !== issueCount || !result.path || !result.label) return null;
  return Object.freeze(result) as NpCustomRouteDefinition;
}

function parseDefinitions(
  value: unknown,
  path = "customRoutes",
): Parsed<readonly NpCustomRouteDefinition[]> {
  const issues: NpCustomRouteContractIssue[] = [];
  const entries = inspectArray(value, path, issues);
  if (!entries) return fail(issues);
  const definitions: NpCustomRouteDefinition[] = [];
  const paths = new Map<string, string>();
  for (const [index, entry] of entries.entries()) {
    const entryPath = `${path}.${index.toString()}`;
    const definition = parseDefinition(entry, entryPath, issues);
    if (!definition) continue;
    const firstPath = paths.get(definition.path);
    if (firstPath) {
      issues.push(
        issue(
          "duplicate-path",
          `${entryPath}.path`,
          `custom route path "${definition.path}" duplicates ${firstPath}.`,
        ),
      );
      continue;
    }
    paths.set(definition.path, `${entryPath}.path`);
    definitions.push(definition);
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(definitions) };
}

function parseSource(
  value: unknown,
  path: string,
  issues: NpCustomRouteContractIssue[],
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npCustomRouteContractLimits.sourceLength ||
    !sourcePattern.test(value)
  ) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `custom route sources must be canonical colon-separated identifiers of 1–${npCustomRouteContractLimits.sourceLength.toString()} characters.`,
      ),
    );
    return null;
  }
  return value;
}

function parseRoute(
  value: unknown,
  path: string,
  issues: NpCustomRouteContractIssue[],
): NpCustomRoute | null {
  const issueCount = issues.length;
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return null;
  pushUnknownFields(inspected, routeKeys, path, issues);

  const definition = parseDefinition(
    Object.fromEntries(
      inspected.keys
        .filter((key) => definitionKeys.has(key))
        .map((key) => [key, inspected.fields[key]]),
    ),
    path,
    issues,
  );
  const parsedPath = parsePath(inspected.fields.path, `${path}.path`, []);
  const kind = inspected.fields.kind;
  if (typeof kind !== "string" || !kindSet.has(kind)) {
    issues.push(
      issue("invalid-field", `${path}.kind`, 'custom route kind must be "static" or "dynamic".'),
    );
  } else if (parsedPath && kind !== parsedPath.kind) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.kind`,
        `custom route kind must be "${parsedPath.kind}" for path "${String(inspected.fields.path)}".`,
      ),
    );
  }
  const source = parseSource(inspected.fields.source, `${path}.source`, issues);

  if (issues.length !== issueCount || !definition || !source || !parsedPath) return null;
  return Object.freeze({ ...definition, kind: parsedPath.kind, source });
}

function parseRoutes(
  value: unknown,
  path = "customRoutesResponse.routes",
): Parsed<readonly NpCustomRoute[]> {
  const issues: NpCustomRouteContractIssue[] = [];
  const entries = inspectArray(value, path, issues);
  if (!entries) return fail(issues);
  const routes: NpCustomRoute[] = [];
  const paths = new Map<string, string>();
  for (const [index, entry] of entries.entries()) {
    const entryPath = `${path}.${index.toString()}`;
    const route = parseRoute(entry, entryPath, issues);
    if (!route) continue;
    const firstPath = paths.get(route.path);
    if (firstPath) {
      issues.push(
        issue(
          "duplicate-path",
          `${entryPath}.path`,
          `custom route path "${route.path}" duplicates ${firstPath}.`,
        ),
      );
      continue;
    }
    paths.set(route.path, `${entryPath}.path`);
    routes.push(route);
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(routes) };
}

function throwContract(message: string, issues: readonly NpCustomRouteContractIssue[]): never {
  const first = issues[0];
  throw new NpCustomRouteContractError(
    first ? `${message}: ${first.path}: ${first.message}` : message,
    issues,
  );
}

export function npAnalyzeCustomRouteDefinitions(value: unknown): NpCustomRouteContractIssue[] {
  return parseDefinitions(value).issues;
}

export function npValidateCustomRouteDefinitions(value: unknown): NpCustomRouteValidationResult {
  const first = npAnalyzeCustomRouteDefinitions(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function npRequireCustomRouteDefinitions(
  value: unknown,
): readonly NpCustomRouteDefinition[] {
  const parsed = parseDefinitions(value);
  if (!parsed.value) throwContract("Invalid custom route definitions", parsed.issues);
  return parsed.value;
}

export function npDefineCustomRoutes(
  value: readonly NpCustomRouteDefinition[],
): readonly NpCustomRouteDefinition[] {
  return npRequireCustomRouteDefinitions(value);
}

export function npRequireCustomRouteSource(value: unknown): string {
  const issues: NpCustomRouteContractIssue[] = [];
  const source = parseSource(value, "customRouteSource", issues);
  if (!source) throwContract("Invalid custom route source", issues);
  return source;
}

export function npGetCustomRouteKind(path: unknown): NpCustomRouteKind {
  const issues: NpCustomRouteContractIssue[] = [];
  const parsed = parsePath(path, "customRoute.path", issues);
  if (!parsed || issues.length > 0) throwContract("Invalid custom route path", issues);
  return parsed.kind;
}

export function npAnalyzeCustomRoutesResponse(value: unknown): NpCustomRouteContractIssue[] {
  const issues: NpCustomRouteContractIssue[] = [];
  const inspected = inspectRecord(value, "customRoutesResponse", issues);
  if (!inspected) return issues;
  pushUnknownFields(inspected, responseKeys, "customRoutesResponse", issues);
  const parsedRoutes = parseRoutes(inspected.fields.routes);
  issues.push(...parsedRoutes.issues);
  return issues;
}

export function npRequireCustomRoutesResponse(value: unknown): NpCustomRoutesResponse {
  const issues: NpCustomRouteContractIssue[] = [];
  const inspected = inspectRecord(value, "customRoutesResponse", issues);
  if (inspected) {
    pushUnknownFields(inspected, responseKeys, "customRoutesResponse", issues);
    const parsedRoutes = parseRoutes(inspected.fields.routes);
    issues.push(...parsedRoutes.issues);
    if (issues.length === 0 && parsedRoutes.value) {
      return Object.freeze({ routes: parsedRoutes.value });
    }
  }
  throwContract("Invalid custom routes response", issues);
}

export function npCreateCustomRoutesResponse(
  routes: readonly NpCustomRoute[],
): NpCustomRoutesResponse {
  return npRequireCustomRoutesResponse({ routes });
}

export function isNpCustomRoutesResponse(value: unknown): value is NpCustomRoutesResponse {
  return npAnalyzeCustomRoutesResponse(value).length === 0;
}
