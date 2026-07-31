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
import { optionalMember } from "../../../../lib/member-auth-helpers";
import { npCreatePluginApiRouteResponse } from "../../plugin-route-response";
import { npReadPluginApiRawBody } from "../../plugin-route-request";

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
    const method = resolveRequestMethod(request.method);
    if (!method) {
      throw new NpMethodNotAllowedError("Plugin route method not allowed");
    }
    await ensureFor(method === "GET" || method === "HEAD" ? "plugins" : "write");
    const { pluginId, path } = await params;
    const routePath = `/${path.join("/")}`;
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
    const [sessionUser, member] = await Promise.all([
      optionalAuth(request),
      optionalMember(request),
    ]);
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
    let rawBody: Uint8Array | undefined;
    if (matched.bodyMode === "raw") {
      rawBody = await npReadPluginApiRawBody(request);
    } else if (matched.bodyMode === "json") {
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
      bodyMode: matched.bodyMode,
      body,
      rawBody,
      headers,
      user: sessionUser
        ? { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role }
        : undefined,
      member: member ? { id: member.id } : undefined,
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
