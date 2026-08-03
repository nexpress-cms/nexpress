import { type NpPluginUser } from "./hook-contract.js";

export const npPluginApiRouteMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const npPluginApiRouteBodyModes = ["json", "raw"] as const;
export const npPluginApiRouteResponseModes = ["json", "binary"] as const;
export const npPluginApiRouteLimits = Object.freeze({
  rawBodyBytes: 1024 * 1024,
  binaryResponseBytes: 8 * 1024 * 1024,
});

export type NpPluginApiRouteMethod = (typeof npPluginApiRouteMethods)[number];
export type NpPluginApiRouteRequestMethod = NpPluginApiRouteMethod | "HEAD";
export type NpPluginApiRouteBodyMode = (typeof npPluginApiRouteBodyModes)[number];
export type NpPluginApiRouteResolvedBodyMode = NpPluginApiRouteBodyMode | "none";
export type NpPluginApiRouteResponseMode = (typeof npPluginApiRouteResponseModes)[number];

export type NpPluginApiRouteUser = NpPluginUser;

/** Active public member identity, when the request carries a valid member session. */
export interface NpPluginApiRouteMember {
  readonly id: string;
}

export interface NpPluginApiRouteRequest {
  readonly method: NpPluginApiRouteRequestMethod;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  /**
   * How the framework projected the incoming body. GET/HEAD requests use
   * `none`; mutating routes default to `json` unless they opt into `raw`.
   */
  readonly bodyMode: NpPluginApiRouteResolvedBodyMode;
  /** Parsed JSON in `json` mode; otherwise `undefined`. */
  readonly body: unknown;
  /** Exact bounded request bytes in `raw` mode; otherwise `undefined`. */
  readonly rawBody: Uint8Array | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly user?: NpPluginApiRouteUser;
  readonly member?: NpPluginApiRouteMember;
}

export interface NpPluginApiRouteResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export type NpPluginApiRouteValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

const routeMethodSet = new Set<string>(npPluginApiRouteMethods);
const routeBodyModeSet = new Set<string>(npPluginApiRouteBodyModes);
const routeResponseModeSet = new Set<string>(npPluginApiRouteResponseModes);
const routeDefinitionKeys = [
  "method",
  "path",
  "handler",
  "description",
  "auth",
  "bodyMode",
  "responseMode",
] as const;
const routeResponseKeys = ["status", "body", "headers"] as const;
const nullBodyStatuses = new Set([204, 205, 304]);
const routeSegmentPattern = /^[A-Za-z0-9._~-]+$/;
const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

function invalid(message: string): NpPluginApiRouteValidationResult {
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

export function npIsPluginApiRouteMethod(value: string): value is NpPluginApiRouteMethod {
  return routeMethodSet.has(value);
}

export function npIsPluginApiRouteBodyMode(value: string): value is NpPluginApiRouteBodyMode {
  return routeBodyModeSet.has(value);
}

export function npIsPluginApiRouteResponseMode(
  value: string,
): value is NpPluginApiRouteResponseMode {
  return routeResponseModeSet.has(value);
}

export function npValidatePluginApiRoutePath(path: unknown): NpPluginApiRouteValidationResult {
  if (typeof path !== "string" || path.length === 0) {
    return invalid("route.path must be a non-empty string.");
  }
  if (path.length > 256) {
    return invalid("route.path must be 256 characters or fewer.");
  }
  if (!path.startsWith("/") || path === "/") {
    return invalid('route.path must start with "/" and contain at least one segment.');
  }
  if (path.endsWith("/") || path.includes("//")) {
    return invalid("route.path must use canonical segments without empty or trailing segments.");
  }
  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return invalid("route.path must not contain dot segments.");
  }
  if (segments.some((segment) => !routeSegmentPattern.test(segment))) {
    return invalid(
      "route.path segments may contain only letters, numbers, dots, underscores, tildes, and hyphens.",
    );
  }
  return { ok: true };
}

export function npValidatePluginApiRouteDefinition(
  value: unknown,
): NpPluginApiRouteValidationResult {
  if (!isRecord(value) || !hasOnlyKeys(value, routeDefinitionKeys)) {
    return invalid(
      "route must contain only method, path, handler, description, auth, bodyMode, and responseMode.",
    );
  }
  if (typeof value.method !== "string" || !npIsPluginApiRouteMethod(value.method)) {
    return invalid(
      `route.method must be one of ${npPluginApiRouteMethods.map((method) => `"${method}"`).join(", ")}.`,
    );
  }
  const pathValidation = npValidatePluginApiRoutePath(value.path);
  if (!pathValidation.ok) return pathValidation;
  if (typeof value.handler !== "function") {
    return invalid("route.handler must be a function.");
  }
  if (
    value.description !== undefined &&
    (typeof value.description !== "string" || value.description.trim().length === 0)
  ) {
    return invalid("route.description must be a non-empty string when provided.");
  }
  if (value.auth !== undefined && typeof value.auth !== "boolean") {
    return invalid("route.auth must be a boolean when provided.");
  }
  if (
    value.bodyMode !== undefined &&
    (typeof value.bodyMode !== "string" || !npIsPluginApiRouteBodyMode(value.bodyMode))
  ) {
    return invalid('route.bodyMode must be either "json" or "raw" when provided.');
  }
  if (value.method === "GET" && value.bodyMode !== undefined) {
    return invalid("route.bodyMode may be declared only for mutating routes.");
  }
  if (
    value.responseMode !== undefined &&
    (typeof value.responseMode !== "string" || !npIsPluginApiRouteResponseMode(value.responseMode))
  ) {
    return invalid('route.responseMode must be either "json" or "binary" when provided.');
  }
  return { ok: true };
}

export function npValidatePluginApiRouteResponse(
  value: unknown,
  responseMode: NpPluginApiRouteResponseMode = "json",
): NpPluginApiRouteValidationResult {
  if (!isRecord(value) || !hasOnlyKeys(value, routeResponseKeys)) {
    return invalid("route response must contain only status, body, and headers.");
  }
  if (
    typeof value.status !== "number" ||
    !Number.isInteger(value.status) ||
    value.status < 200 ||
    value.status > 599
  ) {
    return invalid("route response.status must be an integer between 200 and 599.");
  }
  if (
    nullBodyStatuses.has(value.status) &&
    Object.hasOwn(value, "body") &&
    value.body !== undefined
  ) {
    return invalid(`route response status ${value.status.toString()} must not include a body.`);
  }
  if (value.headers !== undefined) {
    if (!isRecord(value.headers)) {
      return invalid("route response.headers must be a string record when provided.");
    }
    const normalizedNames = new Set<string>();
    for (const [name, headerValue] of Object.entries(value.headers)) {
      if (!headerNamePattern.test(name) || typeof headerValue !== "string") {
        return invalid("route response.headers must contain valid names and string values.");
      }
      if (headerValue.includes("\0") || headerValue.includes("\r") || headerValue.includes("\n")) {
        return invalid("route response.headers must not contain null bytes or line breaks.");
      }
      const normalizedName = name.toLowerCase();
      if (normalizedNames.has(normalizedName)) {
        return invalid("route response.headers must not repeat names with different casing.");
      }
      normalizedNames.add(normalizedName);
    }
  }
  if (responseMode === "json" && value.body instanceof Uint8Array) {
    return invalid('route response.body is binary; declare responseMode: "binary" on the route.');
  }
  if (!nullBodyStatuses.has(value.status) && responseMode === "binary") {
    if (!(value.body instanceof Uint8Array)) {
      return invalid("binary route response.body must be a Uint8Array.");
    }
    if (value.body.byteLength < 1) {
      return invalid("binary route response.body must not be empty.");
    }
    if (value.body.byteLength > npPluginApiRouteLimits.binaryResponseBytes) {
      return invalid(
        `binary route response.body must be at most ${npPluginApiRouteLimits.binaryResponseBytes.toString()} bytes.`,
      );
    }
    const contentType = Object.entries(value.headers ?? {}).find(
      ([name]) => name.toLowerCase() === "content-type",
    )?.[1];
    if (typeof contentType !== "string" || contentType.trim().length === 0) {
      return invalid("binary route responses require a Content-Type header.");
    }
    const binaryHeaderNames = new Set(
      Object.keys(value.headers ?? {}).map((name) => name.toLowerCase()),
    );
    if (binaryHeaderNames.has("content-length") || binaryHeaderNames.has("transfer-encoding")) {
      return invalid(
        "binary route responses must let the framework set Content-Length and Transfer-Encoding.",
      );
    }
  }
  return { ok: true };
}

export function npPluginApiRouteKey(route: {
  readonly method: NpPluginApiRouteMethod;
  readonly path: string;
}): string {
  return `${route.method} ${route.path}`;
}
