import { describe, expect, it } from "vitest";

import {
  npAgentGatewayAdminOperationIdsV1,
  npAgentServiceTokenLimits,
  npAnalyzeAgentGatewayAdminInputV1,
  npRequireAgentGatewayAdminInputV1,
} from "./index.js";

const IDEMPOTENCY_KEY = "gateway-admin:principal:1";

describe("Agent Gateway Admin input contract v1", () => {
  it("owns the exact AP-104 operation set and shared token limits", () => {
    expect(npAgentGatewayAdminOperationIdsV1).toEqual([
      "agents.gateway.oauth_clients.create",
      "agents.gateway.oauth_clients.revoke",
      "agents.gateway.principals.create",
      "agents.gateway.principals.update",
      "agents.gateway.principal_tokens.create",
      "agents.gateway.principal_tokens.rotate",
      "agents.gateway.principal_tokens.revoke",
      "agents.gateway.principals.suspend",
      "agents.gateway.principals.resume",
      "agents.gateway.principals.revoke",
    ]);
    expect(npAgentServiceTokenLimits).toEqual({
      productionMaxLifetimeSeconds: 7_776_000,
      developmentMaxLifetimeSeconds: 31_536_000,
      rotationOverlapDefaultSeconds: 900,
      rotationOverlapMaxSeconds: 3_600,
    });
  });

  it("validates exact registered public OAuth client inputs", () => {
    const create = {
      idempotencyKey: "gateway-admin:oauth-client:1",
      name: "Desktop MCP",
      redirectUris: ["http://127.0.0.1:43110/callback", "https://client.example/callback"],
      transports: ["agent-http", "mcp-http"],
    };
    expect(
      npRequireAgentGatewayAdminInputV1("agents.gateway.oauth_clients.create", create),
    ).toEqual(create);
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.oauth_clients.create", {
        ...create,
        redirectUris: ["https://client.example/callback", "http://127.0.0.1:43110/callback"],
      }),
    ).toMatchObject({ ok: false, issues: [{ path: expect.stringContaining("redirectUris") }] });
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.oauth_clients.create", {
        ...create,
        redirectUris: ["http://attacker.example/callback"],
      }),
    ).toMatchObject({ ok: false, issues: [{ path: expect.stringContaining("redirectUris") }] });
  });

  it("validates principal creation and update as separate exact bodies", () => {
    const create = {
      idempotencyKey: IDEMPOTENCY_KEY,
      name: "Editorial CLI",
      description: null,
      scopes: ["content:read", "site:read"],
    };
    expect(npRequireAgentGatewayAdminInputV1("agents.gateway.principals.create", create)).toEqual(
      create,
    );
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.principals.create", {
        ...create,
        scopes: ["content:read"],
      }),
    ).toMatchObject({ ok: false, issues: [{ path: expect.stringContaining("scopes") }] });

    const update = { ...create, expectedVersion: 2, scopes: ["content:read"] };
    expect(npRequireAgentGatewayAdminInputV1("agents.gateway.principals.update", update)).toEqual(
      update,
    );
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.principals.create", update),
    ).toMatchObject({ ok: false, issues: [{ code: "unknown-field" }] });
  });

  it("keeps token creation authority explicit and rotation authority immutable", () => {
    const create = {
      idempotencyKey: "gateway-admin:token:1",
      expectedVersion: 3,
      name: "CI publisher",
      scopes: ["content:read", "site:read"],
      transport: "mcp-http",
      exposure: "propose",
      expiresAt: "2026-09-01T00:00:00.000Z",
    };
    expect(
      npRequireAgentGatewayAdminInputV1("agents.gateway.principal_tokens.create", create),
    ).toEqual(create);
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.principal_tokens.create", {
        ...create,
        audience: "https://attacker.example/api/mcp",
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "unknown-field" }] });

    const rotate = {
      idempotencyKey: "gateway-admin:token:rotate:1",
      expectedVersion: 1,
      overlapSeconds: 900,
    };
    expect(
      npRequireAgentGatewayAdminInputV1("agents.gateway.principal_tokens.rotate", rotate),
    ).toEqual(rotate);
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.principal_tokens.rotate", {
        ...rotate,
        scopes: ["site:read"],
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "unknown-field" }] });
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.principal_tokens.rotate", {
        ...rotate,
        overlapSeconds: 3_601,
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "limit" }] });
  });

  it("rejects reordered scopes and hostile or inexact objects", () => {
    const input = {
      idempotencyKey: IDEMPOTENCY_KEY,
      name: "Editorial CLI",
      description: "Read access",
      scopes: ["site:read", "content:read"],
    };
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.principals.create", input),
    ).toMatchObject({ ok: false, issues: [{ code: "order" }] });

    const inherited = Object.create({ unexpected: true });
    Object.assign(inherited, { ...input, scopes: ["content:read", "site:read"] });
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.principals.create", inherited),
    ).toMatchObject({ ok: false, issues: [{ code: "shape" }] });

    const accessor = { ...input, scopes: ["content:read", "site:read"] };
    Object.defineProperty(accessor, "name", { enumerable: true, get: () => "unsafe" });
    expect(
      npAnalyzeAgentGatewayAdminInputV1("agents.gateway.principals.create", accessor),
    ).toMatchObject({ ok: false, issues: [{ code: "shape" }] });
  });
});
