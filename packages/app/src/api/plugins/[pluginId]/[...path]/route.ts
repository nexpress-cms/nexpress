import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getPluginRoutes, isPluginEnabled } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { optionalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

export const dynamic = "force-dynamic";

async function handlePluginRoute(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string; path: string[] }> },
) {
  await ensureFor("plugins");
  const { pluginId, path } = await params;
  const routePath = `/${path.join("/")}`;
  const method = request.method;

  const routes = getPluginRoutes();
  const matched = routes.find(
    (r) =>
      r.pluginId === pluginId &&
      r.method === method &&
      r.path === routePath,
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
  url.searchParams.forEach((v, k) => { query[k] = v; });

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });

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

  return NextResponse.json(result.body ?? null, {
    status: result.status,
    headers: result.headers,
  });
}

export const GET = handlePluginRoute;
export const POST = handlePluginRoute;
export const PUT = handlePluginRoute;
export const PATCH = handlePluginRoute;
export const DELETE = handlePluginRoute;
