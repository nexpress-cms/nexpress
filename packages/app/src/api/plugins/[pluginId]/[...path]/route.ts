import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
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
  await ensureFor("plugins");
  const { pluginId, path } = await params;
  const routePath = `/${path.join("/")}`;
  const method = resolveRequestMethod(request.method);
  if (!method) {
    return NextResponse.json(
      {
        error: { code: "METHOD_NOT_ALLOWED", message: "Plugin route method not allowed" },
        status: 405,
      },
      { status: 405 },
    );
  }
  const registeredMethod = registeredMethodForRequest(method);

  const routes = getPluginRoutes();
  const matched = routes.find(
    (r) => r.pluginId === pluginId && r.method === registeredMethod && r.path === routePath,
  );

  if (!matched) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Plugin route not found" }, status: 404 },
      { status: 404 },
    );
  }

  // Toggle takes effect immediately: a disabled plugin's routes return 404
  // even though the dispatch table still holds them. Reads from the
  // short-TTL gate so a normal request adds at most one cached lookup, and a
  // POST /api/plugins/:id { enabled: false } invalidates the cache so the
  // very next request observes the new state.
  if (!(await isPluginEnabled(pluginId))) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Plugin route not found" }, status: 404 },
      { status: 404 },
    );
  }

  // Honor the route's `auth: true` declaration. Previously the flag
  // was accepted at registration but dropped in the dispatcher, so
  // plugins that put diagnostics, settings, or webhooks behind
  // `auth: true` were still publicly reachable. (#61)
  const sessionUser = await optionalAuth(request);
  if (matched.auth && !sessionUser) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" }, status: 401 },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  try {
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
