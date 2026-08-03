import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  ensureFor: vi.fn(),
  handler: vi.fn(),
  optionalAuth: vi.fn(),
  optionalMember: vi.fn(),
  readJsonBody: vi.fn((request: NextRequest) => request.json()),
}));

vi.mock("@nexpress/core", () => ({
  NpAuthError: class NpAuthError extends Error {},
  NpMethodNotAllowedError: class NpMethodNotAllowedError extends Error {},
  NpNotFoundError: class NpNotFoundError extends Error {},
  NpValidationError: class NpValidationError extends Error {},
  npPluginApiRouteLimits: { rawBodyBytes: 1024 * 1024 },
  getPluginRoutes: () => [
    {
      pluginId: "shop",
      method: "GET",
      path: "/cart",
      auth: false,
      bodyMode: "none",
      responseMode: "json",
      handler: runtime.handler,
    },
    {
      pluginId: "shop",
      method: "POST",
      path: "/cart",
      auth: false,
      bodyMode: "json",
      responseMode: "json",
      handler: runtime.handler,
    },
    {
      pluginId: "shop",
      method: "POST",
      path: "/webhook",
      auth: false,
      bodyMode: "raw",
      responseMode: "json",
      handler: runtime.handler,
    },
    {
      pluginId: "shop",
      method: "GET",
      path: "/label",
      auth: false,
      bodyMode: "none",
      responseMode: "binary",
      handler: runtime.handler,
    },
  ],
  isPluginEnabled: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@nexpress/next", () => ({
  readJsonBody: runtime.readJsonBody,
}));

vi.mock("../../../../lib/auth-helpers", () => ({
  optionalAuth: runtime.optionalAuth,
}));

vi.mock("../../../../lib/member-auth-helpers", () => ({
  optionalMember: runtime.optionalMember,
}));

vi.mock("../../../../lib/init-core", () => ({
  ensureFor: runtime.ensureFor,
}));

import { GET, POST } from "./route.js";

const params = { params: Promise.resolve({ pluginId: "shop", path: ["cart"] }) };
const webhookParams = {
  params: Promise.resolve({ pluginId: "shop", path: ["webhook"] }),
};
const labelParams = { params: Promise.resolve({ pluginId: "shop", path: ["label"] }) };

beforeEach(() => {
  runtime.ensureFor.mockReset().mockResolvedValue(undefined);
  runtime.handler.mockReset().mockResolvedValue({ status: 200, body: { ok: true } });
  runtime.optionalAuth.mockReset().mockResolvedValue(null);
  runtime.optionalMember.mockReset().mockResolvedValue({
    id: "123e4567-e89b-42d3-a456-426614174000",
  });
  runtime.readJsonBody.mockClear();
});

describe("plugin API route member projection", () => {
  it("keeps reads on plugin bootstrap and passes the active member summary", async () => {
    const response = await GET(new NextRequest("http://localhost/api/plugins/shop/cart"), params);

    expect(response.status).toBe(200);
    expect(runtime.ensureFor).toHaveBeenCalledWith("plugins");
    expect(runtime.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        bodyMode: "none",
        rawBody: undefined,
        member: { id: "123e4567-e89b-42d3-a456-426614174000" },
      }),
    );
  });

  it("initializes write services before a mutating plugin route", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/plugins/shop/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: 0 }),
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(runtime.ensureFor).toHaveBeenCalledWith("write");
    expect(runtime.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        bodyMode: "json",
        body: { expectedRevision: 0 },
        rawBody: undefined,
        member: { id: "123e4567-e89b-42d3-a456-426614174000" },
      }),
    );
  });

  it("preserves exact bytes for a raw-body route without invoking JSON parsing", async () => {
    const source = '{ "event": "paid", "id": 7 }\n';
    const response = await POST(
      new NextRequest("http://localhost/api/plugins/shop/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": new TextEncoder().encode(source).byteLength.toString(),
        },
        body: source,
      }),
      webhookParams,
    );

    expect(response.status).toBe(200);
    expect(runtime.readJsonBody).not.toHaveBeenCalled();
    expect(runtime.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        bodyMode: "raw",
        body: undefined,
        rawBody: new TextEncoder().encode(source),
      }),
    );
  });

  it("uses the matched route response mode for bounded binary delivery", async () => {
    runtime.handler.mockResolvedValueOnce({
      status: 200,
      body: new Uint8Array([1, 2, 3]),
      headers: { "Content-Type": "application/octet-stream" },
    });
    const response = await GET(
      new NextRequest("http://localhost/api/plugins/shop/label"),
      labelParams,
    );

    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
