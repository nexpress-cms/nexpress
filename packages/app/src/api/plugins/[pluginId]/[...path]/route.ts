import type { NextRequest } from "next/server";
import {
  NpAuthError,
  NpMethodNotAllowedError,
  NpNotFoundError,
  getPluginRoutes,
  isPluginEnabled,
  type NpPluginApiRouteMethod,
  type NpPluginApiRouteRequestMethod,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { optionalAuth } from "../../../../lib/auth-helpers";
import { npErrorResponse } from "../../../../lib/api-response";
import { ensureFor } from "../../../../lib/init-core";
import { npCreatePluginApiRouteResponse } from "../../plugin-route-response";

export const dynamic = "force-dynamic";

function resolveRequestMethod(method: string): NpPluginApiRouteRequestMethod | null {
  switch (method) {
    case "GET":
    case "HEAD":
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
      return method;
    default:
      return null;
  }
}

function registeredMethodForRequest(method: NpPluginApiRouteRequestMethod): NpPluginApiRouteMethod {
  return method === "HEAD" ? "GET" : method;
}

async function handlePluginRoute(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string; path: string[] }> },
) {
  try {
    await ensureFor("plugins");
    const { pluginId, path } = await params;
    const routePath = `/${path.join("/")}`;
    const method = resolveRequestMethod(request.method);
    if (!method) {
      throw new NpMethodNotAllowedError("Plugin route method not allowed");
    }
    const registeredMethod = registeredMethodForRequest(method);

    const routes = getPluginRoutes();
    const matched = routes.find(
      (route) =>
        route.pluginId === pluginId &&
        route.method === registeredMethod &&
        route.path === routePath,
    );

    if (!matched || !(await isPluginEnabled(pluginId))) {
      throw new NpNotFoundError("plugin route", `${pluginId}${routePath}`);
    }

    // Honor the route's `auth: true` declaration. The plugin route itself may
    // apply stricter authorization inside its handler.
    const sessionUser = await optionalAuth(request);
    if (matched.auth && !sessionUser) {
      throw new NpAuthError("Authentication required");
    }

    const url = new URL(request.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    let body: unknown = undefined;
    if (method !== "GET" && method !== "HEAD") {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        body = await readJsonBody(request);
      }
    }

    const result = await matched.handler({
      method,
      path: routePath,
      params: { pluginId },
      query,
      body,
      headers,
      user: sessionUser
        ? { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role }
        : undefined,
    });

    return npCreatePluginApiRouteResponse(result, method);
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown plugin route error"),
    );
  }
}

export const GET = handlePluginRoute;
export const HEAD = handlePluginRoute;
export const POST = handlePluginRoute;
export const PUT = handlePluginRoute;
export const PATCH = handlePluginRoute;
export const DELETE = handlePluginRoute;
