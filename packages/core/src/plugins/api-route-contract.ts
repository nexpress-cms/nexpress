import { type NpPluginUser } from "./hook-contract.js";

export const npPluginApiRouteMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type NpPluginApiRouteMethod = (typeof npPluginApiRouteMethods)[number];
export type NpPluginApiRouteRequestMethod = NpPluginApiRouteMethod | "HEAD";

export type NpPluginApiRouteUser = NpPluginUser;

export interface NpPluginApiRouteRequest {
  readonly method: NpPluginApiRouteRequestMethod;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly user?: NpPluginApiRouteUser;
}

export interface NpPluginApiRouteResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export type NpPluginApiRouteValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

const routeMethodSet = new Set<string>(npPluginApiRouteMethods);
const routeDefinitionKeys = ["method", "path", "handler", "description", "auth"] as const;
const routeResponseKeys = ["status", "body", "headers"] as const;
const nullBodyStatuses = new Set([204, 205, 304]);
const routeSegmentPattern = /^[A-Za-z0-9._~-]+$/;

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
    return invalid("route must contain only method, path, handler, description, and auth.");
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
  return { ok: true };
}

export function npValidatePluginApiRouteResponse(value: unknown): NpPluginApiRouteValidationResult {
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
    for (const [name, headerValue] of Object.entries(value.headers)) {
      if (name.length === 0 || typeof headerValue !== "string") {
        return invalid("route response.headers must contain non-empty names and string values.");
      }
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
