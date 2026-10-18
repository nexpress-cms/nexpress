import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  observe: vi.fn(),
  ensureFor: vi.fn(),
  resolveRequest: vi.fn(),
  requireStaff: vi.fn(),
  authenticate: vi.fn(),
  transport: vi.fn(),
}));
vi.mock("@nexpress/core/agents", () => ({
  getOptionalAgentStudioServerRuntimeV1: mocks.runtime,
}));
vi.mock("@nexpress/core/sites", () => ({ requireSiteId: () => Promise.resolve("default") }));
vi.mock("@nexpress/mcp/http", () => ({ handleAgentMcpHttpV1: mocks.transport }));
vi.mock("../../lib/init-core", () => ({ ensureFor: mocks.ensureFor }));
vi.mock("../../lib/agents/guardian-request-observer", () => ({
  resolveAuthRequestContext: mocks.resolveRequest,
}));
vi.mock("../../lib/agents/studio-admin", () => ({ requireAgentOauthStaff: mocks.requireStaff }));

import { GET as authorize } from "./authorize/route.js";
import { POST as token } from "./token/route.js";
import { GET as jwks } from "./jwks/route.js";
import {
  agentOauthAuthorizationServerMetadataGET,
  agentOauthProtectedResourceMetadataGET,
} from "./discovery.js";
import { GET as mcp, OPTIONS as mcpOptions } from "../mcp/route.js";

const request = (
  path: string,
  init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {},
) =>
  new NextRequest(`https://example.test${path}`, {
    ...init,
    headers: { "x-forwarded-for": "192.0.2.81", ...init.headers },
  });
const sourceOnly = () => ({ guardianHttp: { observe: mocks.observe } });
const machineSurface = () => ({
  ...sourceOnly(),
  mcp: {},
  oauth: {
    resourceFor: () => Promise.resolve("https://example.test/api/mcp"),
    authenticateRemoteBearer: mocks.authenticate,
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockReturnValue(sourceOnly());
  mocks.observe.mockResolvedValue({ disposition: "recorded", eventId: "event", incidentId: null });
  mocks.ensureFor.mockResolvedValue(undefined);
  mocks.resolveRequest.mockResolvedValue({ siteId: "default", networkAddress: "192.0.2.81" });
  mocks.requireStaff.mockRejectedValue(new Error("private staff failure"));
  mocks.authenticate.mockRejectedValue(new Error("private token failure"));
  mocks.transport.mockResolvedValue(new Response(null, { status: 200 }));
});

describe("actual OAuth and MCP final response observation", () => {
  it("records the actual absent OAuth 404 and final staff 401 without private authentication text", async () => {
    const missing = await token(request("/api/agent-oauth/token", { method: "POST" }));
    expect(missing.status).toBe(404);
    expect(missing.bodyUsed).toBe(false);
    expect(mocks.observe).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ siteId: "default", status: 404, routeFamily: "agent-oauth" }),
    );
    const denied = await authorize(request("/api/agent-oauth/authorize"));
    expect(denied.status).toBe(401);
    expect(mocks.observe).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 401, routeFamily: "agent-oauth" }),
    );
    expect(JSON.stringify(mocks.observe.mock.calls)).not.toContain("private");
    expect(JSON.stringify(mocks.observe.mock.calls)).not.toContain("token");
  });

  it("preserves MCP's invalid-token challenge and final 401 without invoking transport", async () => {
    mocks.runtime.mockReturnValue(machineSurface());
    const response = await mcp(request("/api/mcp"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(response.bodyUsed).toBe(false);
    expect(mocks.observe).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 401, routeFamily: "mcp" }),
    );
    expect(mocks.transport).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "invalid_token" });
  });

  it("observes an actual MCP origin 403 and skips successful preflight", async () => {
    mocks.runtime.mockReturnValue(machineSurface());
    const response = await mcp(request("/api/mcp", { headers: { origin: "https://other.test" } }));
    expect(response.status).toBe(403);
    expect(mocks.observe).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 403, routeFamily: "mcp" }),
    );
    expect((await mcpOptions(request("/api/mcp", { method: "OPTIONS" }))).status).toBe(200);
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("keeps discovery's no-argument compatibility and observes real Request 404s including JWKS", async () => {
    expect((await agentOauthAuthorizationServerMetadataGET()).status).toBe(404);
    expect((await agentOauthProtectedResourceMetadataGET()).status).toBe(404);
    expect((await jwks()).status).toBe(404);
    expect(mocks.observe).not.toHaveBeenCalled();
    for (const [handler, path] of [
      [agentOauthAuthorizationServerMetadataGET, "/.well-known/oauth-authorization-server"],
      [agentOauthProtectedResourceMetadataGET, "/.well-known/oauth-protected-resource/api/mcp"],
      [jwks, "/api/agent-oauth/jwks"],
    ] as const) {
      const response = await handler(request(path));
      expect(response.status).toBe(404);
      expect(response.bodyUsed).toBe(false);
    }
    expect(mocks.observe).toHaveBeenCalledTimes(3);
    expect(mocks.observe.mock.calls.every(([input]) => input.routeFamily === "agent-oauth")).toBe(
      true,
    );
  });
});
