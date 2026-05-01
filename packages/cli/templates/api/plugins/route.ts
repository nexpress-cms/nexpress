import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getPluginRoutes } from "@nexpress/core";

import { ensureFor } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string; path: string[] }> },
) {
  await ensureFor("plugins");
  const { pluginId, path } = await params;
  const routePath = `/${path.join("/")}`;
  const method = request.method;

  const matched = getPluginRoutes().find(
    (r) => r.pluginId === pluginId && r.method === method && r.path === routePath,
  );
  if (!matched) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Plugin route not found" }, status: 404 },
      { status: 404 },
    );
  }

  const query: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  let body: unknown = undefined;
  if (method !== "GET" && method !== "HEAD") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await request.json();
    }
  }

  const result = await matched.handler({
    method,
    path: routePath,
    params: { pluginId },
    query,
    body,
    headers,
  });

  return NextResponse.json(result.body ?? null, { status: result.status, headers: result.headers });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
