export const npPluginPageRouteSurfaces = ["site", "member"] as const;
export const npPluginPageRouteLocales = ["auto", "none"] as const;

export type NpPluginPageRouteSurface = (typeof npPluginPageRouteSurfaces)[number];
export type NpPluginPageRouteLocale = (typeof npPluginPageRouteLocales)[number];

export interface NpPluginPageRouteDefinition {
  readonly pattern: string;
  readonly component: unknown;
  readonly metadata?: unknown;
  readonly surface?: NpPluginPageRouteSurface;
  readonly locale?: NpPluginPageRouteLocale;
}

export type NpPluginPageRouteValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

interface LiteralSegment {
  readonly kind: "literal";
  readonly value: string;
}

interface ParameterSegment {
  readonly kind: "parameter";
  readonly name: string;
  readonly constraint?: RegExp;
}

type CompiledSegment = LiteralSegment | ParameterSegment;

export interface NpPluginPageRouteMatcher {
  readonly pattern: string;
  match(path: string): Readonly<Record<string, string>> | null;
}

const pageRouteDefinitionKeys = ["pattern", "component", "metadata", "surface", "locale"] as const;
const pageRouteSurfaceSet = new Set<string>(npPluginPageRouteSurfaces);
const pageRouteLocaleSet = new Set<string>(npPluginPageRouteLocales);
const literalSegmentPattern = /^[\p{L}\p{N}._~-]+$/u;
const parameterSegmentPattern = /^:([A-Za-z_][A-Za-z0-9_]*)(?:\((.+)\))?$/u;
const matcherCache = new Map<string, NpPluginPageRouteMatcher>();

function invalid(message: string): NpPluginPageRouteValidationResult {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function normalizePath(path: string): string {
  if (path === "") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function compileSegments(pattern: string):
  | { readonly ok: true; readonly segments: readonly CompiledSegment[] }
  | {
      readonly ok: false;
      readonly message: string;
    } {
  if (pattern === "/") return { ok: true, segments: [] };

  const names = new Set<string>();
  const segments: CompiledSegment[] = [];
  for (const segment of pattern.slice(1).split("/")) {
    if (!segment.startsWith(":")) {
      if (!literalSegmentPattern.test(segment)) {
        return {
          ok: false,
          message:
            "page route.pattern literal segments may contain only letters, numbers, dots, underscores, tildes, and hyphens.",
        };
      }
      segments.push({ kind: "literal", value: segment });
      continue;
    }

    const match = segment.match(parameterSegmentPattern);
    if (!match) {
      return {
        ok: false,
        message:
          'page route.pattern parameters must use ":name" or ":name(regex)" with an identifier name.',
      };
    }
    const name = match[1];
    if (!name) {
      return { ok: false, message: "page route.pattern parameter names must not be empty." };
    }
    if (names.has(name)) {
      return {
        ok: false,
        message: `page route.pattern must not repeat parameter name "${name}".`,
      };
    }
    names.add(name);

    const source = match[2];
    if (source === undefined) {
      segments.push({ kind: "parameter", name });
      continue;
    }
    try {
      segments.push({ kind: "parameter", name, constraint: new RegExp(`^(?:${source})$`, "u") });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `page route.pattern parameter "${name}" has an invalid regular expression: ${reason}`,
      };
    }
  }
  return { ok: true, segments };
}

export function npIsPluginPageRouteSurface(value: string): value is NpPluginPageRouteSurface {
  return pageRouteSurfaceSet.has(value);
}

export function npIsPluginPageRouteLocale(value: string): value is NpPluginPageRouteLocale {
  return pageRouteLocaleSet.has(value);
}

export function npValidatePluginPageRoutePattern(
  pattern: unknown,
): NpPluginPageRouteValidationResult {
  if (typeof pattern !== "string" || pattern.length === 0) {
    return invalid("page route.pattern must be a non-empty string.");
  }
  if (pattern.length > 256) {
    return invalid("page route.pattern must be 256 characters or fewer.");
  }
  if (!pattern.startsWith("/")) {
    return invalid('page route.pattern must start with "/".');
  }
  if (pattern !== "/" && (pattern.endsWith("/") || pattern.includes("//"))) {
    return invalid(
      "page route.pattern must use canonical segments without empty or trailing segments.",
    );
  }
  const segments = pattern === "/" ? [] : pattern.slice(1).split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return invalid("page route.pattern must not contain dot segments.");
  }
  const compiled = compileSegments(pattern);
  return compiled.ok ? { ok: true } : invalid(compiled.message);
}

export function npValidatePluginPageRouteDefinition(
  value: unknown,
): NpPluginPageRouteValidationResult {
  if (!isRecord(value) || !hasOnlyKeys(value, pageRouteDefinitionKeys)) {
    return invalid(
      "page route must contain only pattern, component, metadata, surface, and locale.",
    );
  }
  const patternValidation = npValidatePluginPageRoutePattern(value.pattern);
  if (!patternValidation.ok) return patternValidation;
  if (typeof value.component !== "function") {
    return invalid("page route.component must be a function.");
  }
  if (value.metadata !== undefined && typeof value.metadata !== "function") {
    return invalid("page route.metadata must be a function when provided.");
  }
  if (
    value.surface !== undefined &&
    (typeof value.surface !== "string" || !npIsPluginPageRouteSurface(value.surface))
  ) {
    return invalid(
      `page route.surface must be one of ${npPluginPageRouteSurfaces.map((surface) => `"${surface}"`).join(", ")}.`,
    );
  }
  if (
    value.locale !== undefined &&
    (typeof value.locale !== "string" || !npIsPluginPageRouteLocale(value.locale))
  ) {
    return invalid(
      `page route.locale must be one of ${npPluginPageRouteLocales.map((locale) => `"${locale}"`).join(", ")}.`,
    );
  }
  return { ok: true };
}

export function npCompilePluginPageRoutePattern(pattern: string): NpPluginPageRouteMatcher {
  const cached = matcherCache.get(pattern);
  if (cached) return cached;

  const validation = npValidatePluginPageRoutePattern(pattern);
  if (!validation.ok) throw new Error(validation.message);
  const compiled = compileSegments(pattern);
  if (!compiled.ok) throw new Error(compiled.message);

  const matcher: NpPluginPageRouteMatcher = Object.freeze({
    pattern,
    match(path: string): Readonly<Record<string, string>> | null {
      const normalized = normalizePath(path);
      const pathSegments = normalized === "/" ? [] : normalized.slice(1).split("/");
      if (compiled.segments.length !== pathSegments.length) return null;

      const params: Record<string, string> = {};
      for (const [index, segment] of compiled.segments.entries()) {
        const pathSegment = pathSegments[index];
        if (pathSegment === undefined || pathSegment.length === 0) return null;
        if (segment.kind === "literal") {
          if (segment.value !== pathSegment) return null;
          continue;
        }
        if (segment.constraint && !segment.constraint.test(pathSegment)) return null;
        params[segment.name] = pathSegment;
      }
      return params;
    },
  });
  matcherCache.set(pattern, matcher);
  return matcher;
}

export function npMatchPluginPageRoutePattern(
  pattern: string,
  path: string,
): Readonly<Record<string, string>> | null {
  try {
    return npCompilePluginPageRoutePattern(pattern).match(path);
  } catch {
    return null;
  }
}
