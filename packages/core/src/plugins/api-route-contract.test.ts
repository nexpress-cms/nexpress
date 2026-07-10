import { describe, expect, expectTypeOf, it } from "vitest";

import {
  npIsPluginApiRouteMethod,
  npPluginApiRouteKey,
  npPluginApiRouteMethods,
  npValidatePluginApiRouteDefinition,
  npValidatePluginApiRoutePath,
  npValidatePluginApiRouteResponse,
  type NpPluginApiRouteMethod,
} from "./api-route-contract.js";

describe("plugin API route contract", () => {
  it("keeps the runtime method inventory aligned with the method type", () => {
    expect(npPluginApiRouteMethods).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    expectTypeOf<
      (typeof npPluginApiRouteMethods)[number]
    >().toEqualTypeOf<NpPluginApiRouteMethod>();
    expect(npIsPluginApiRouteMethod("PATCH")).toBe(true);
    expect(npIsPluginApiRouteMethod("HEAD")).toBe(false);
    expect(npIsPluginApiRouteMethod("get")).toBe(false);
  });

  it.each(["/health", "/v1/health-check", "/.well-known/status", "/under_score/~user"])(
    "accepts canonical static path %s",
    (path) => {
      expect(npValidatePluginApiRoutePath(path)).toEqual({ ok: true });
    },
  );

  it.each([
    ["/", /at least one segment/],
    ["health", /start with/],
    ["/health/", /trailing/],
    ["/health//ready", /empty/],
    ["/../ready", /dot segments/],
    ["/users/:id", /only letters/],
    ["/hello world", /only letters/],
    ["/health?full=1", /only letters/],
  ])("rejects non-canonical path %s", (path, message) => {
    const result = npValidatePluginApiRoutePath(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("validates one complete definition and builds its stable key", () => {
    const route = {
      method: "GET" as const,
      path: "/health",
      handler: () => ({ status: 200 }),
      description: "Liveness probe.",
      auth: true,
    };

    expect(npValidatePluginApiRouteDefinition(route)).toEqual({ ok: true });
    expect(npPluginApiRouteKey(route)).toBe("GET /health");
  });

  it.each([
    [{ method: "get", path: "/health", handler: () => ({ status: 200 }) }, /method/],
    [{ method: "GET", path: "/health", handler: "./handler.js" }, /handler/],
    [{ method: "GET", path: "/health", handler: () => ({ status: 200 }), auth: "yes" }, /auth/],
    [
      { method: "GET", path: "/health", handler: () => ({ status: 200 }), description: "" },
      /description/,
    ],
    [
      { method: "GET", path: "/health", handler: () => ({ status: 200 }), timeoutMs: 10 },
      /only method/,
    ],
  ])("rejects malformed route definition %#", (definition, message) => {
    const result = npValidatePluginApiRouteDefinition(definition);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it.each([
    { status: 200, body: { ok: true } },
    { status: 202, headers: { "x-request-id": "request-1" } },
    { status: 204 },
    { status: 304, headers: { etag: '"v1"' } },
    { status: 599, body: null },
  ])("accepts canonical response %#", (response) => {
    expect(npValidatePluginApiRouteResponse(response)).toEqual({ ok: true });
  });

  it.each([
    [undefined, /contain only/],
    [{ status: 199 }, /between 200 and 599/],
    [{ status: 600 }, /between 200 and 599/],
    [{ status: 200.5 }, /integer/],
    [{ status: 204, body: null }, /must not include a body/],
    [{ status: 304, body: "cached" }, /must not include a body/],
    [{ status: 200, headers: { retry: 2 } }, /string values/],
    [{ status: 200, cookies: [] }, /contain only/],
  ])("rejects malformed response %#", (response, message) => {
    const result = npValidatePluginApiRouteResponse(response);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
});
