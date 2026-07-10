import { NextResponse } from "next/server";
import { type NpPluginApiRouteRequestMethod, type NpPluginApiRouteResponse } from "@nexpress/core";

const nullBodyStatuses = new Set([204, 205, 304]);

export function npCreatePluginApiRouteResponse(
  result: NpPluginApiRouteResponse,
  requestMethod: NpPluginApiRouteRequestMethod,
): NextResponse {
  const init = { status: result.status, headers: { ...result.headers } };
  if (requestMethod === "HEAD" || nullBodyStatuses.has(result.status)) {
    return new NextResponse(null, init);
  }
  return NextResponse.json(result.body ?? null, init);
}
