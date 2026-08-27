import { describe, expect, it, vi } from "vitest";

import {
  npAgentAdminOperationIdsV1,
  npAgentAdminOperationRouteInventoryV1,
  npAgentAdminOperationRegistryV1,
  npAgentAdminOperationsV1,
  npAnalyzeAgentAdminOperationContractV1,
  npAnalyzeAgentAdminOperationRegistryV1,
  npAnalyzeAgentEffectProfileDescriptor,
  npAnalyzeAgentInvocationRequestCanonical,
  npDigestAgentAdminOperationContractV1,
  npDigestAgentAdminOperationRegistryV1,
  npGetAgentAdminOperationV1,
  npRequireAgentAdminOperationContractV1,
  npRequireAgentAdminOperationRegistryV1,
  npResolveAgentAdminOperationFingerprintsV1,
  type NpAgentAdminOperationContractV1,
} from "./index.js";

const expectedOperationIds = [
  "agents.connections.create",
  "agents.connections.update",
  "agents.connections.oauth_start",
  "agents.connections.test",
  "agents.connections.rotate",
  "agents.connections.disable",
  "agents.connections.enable",
  "agents.connections.revoke",
  "agents.gateway.settings.update",
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
  "agents.configurations.create",
  "agents.configurations.update",
  "agents.configurations.activate",
  "agents.configurations.pause",
  "agents.configurations.resume",
  "agents.configurations.run",
  "agents.configurations.archive",
  "agents.policies.create",
  "agents.policies.update",
  "agents.policies.validate",
  "agents.policies.simulate",
  "agents.policies.activate",
  "agents.activity.cancel",
  "agents.activity.retry_plan",
  "agents.approvals.decision_challenge",
  "agents.approvals.approve",
  "agents.approvals.reject",
  "agents.approvals.revoke",
  "agents.changesets.create",
  "agents.changesets.update",
  "agents.changesets.validate",
  "agents.changesets.preview",
  "agents.changesets.preview_launch",
  "agents.changesets.request_approval",
  "agents.changesets.cancel",
  "agents.changesets.schedule",
  "agents.changesets.apply",
  "agents.changesets.rollback_plans.create",
  "agents.changesets.rollback_plans.request_approval",
  "agents.changesets.rollback_plans.execute",
  "agents.incidents.transition",
  "agents.incidents.response_plan",
  "agents.incidents.restore",
  "agents.budgets.update",
  "agents.runtime.pause",
  "agents.runtime.resume",
] as const;

function cloneRegistry(): NpAgentAdminOperationContractV1[] {
  return structuredClone([...npAgentAdminOperationRegistryV1]);
}

function adminInvocation(operationId: string) {
  return {
    schemaVersion: "np.agent-idempotency-request.v1",
    siteId: "docs-site",
    actorKind: "staff",
    actorFingerprint: "sha256:staff-actor-v1",
    authorizationContextFingerprint: "cj1:sha256:vYfQk83RNi-TVzHbdfwd-UbSoeJEj8pwk0iDT2qZC4c",
    operationKind: "admin",
    operationId,
    contractVersion: 1,
    contractFingerprint: "cj1:sha256:Nmsm86_pWg0eajtQDgFXhMSmJLUkr9rysW2BexPsQx8",
    effectProfile: null,
    input: { idempotencyKey: "admin:operation:1" },
  };
}

describe("Agent Admin operation registry v1", () => {
  it("locks all 55 Agent Studio mutation rows in product order", () => {
    expect(npAgentAdminOperationIdsV1).toEqual(expectedOperationIds);
    expect(npAgentAdminOperationRegistryV1).toHaveLength(55);
    expect(Object.keys(npAgentAdminOperationsV1)).toEqual(expectedOperationIds);
    expect(new Set(npAgentAdminOperationIdsV1).size).toBe(55);
    expect(Object.isFrozen(npAgentAdminOperationIdsV1)).toBe(true);
    expect(Object.isFrozen(npAgentAdminOperationRouteInventoryV1)).toBe(true);
    expect(Object.isFrozen(npAgentAdminOperationRouteInventoryV1[0])).toBe(true);

    const routeKeys = npAgentAdminOperationRegistryV1.map(
      ({ method, pathTemplate }) => `${method} ${pathTemplate}`,
    );
    expect(new Set(routeKeys).size).toBe(55);
    expect(routeKeys.every((route) => route.includes(" /api/admin/agents/"))).toBe(true);
  });

  it("round-trips the exhaustive registry and returns independent exact copies", () => {
    const parsed = npRequireAgentAdminOperationRegistryV1(npAgentAdminOperationRegistryV1);
    expect(parsed).toEqual(npAgentAdminOperationRegistryV1);
    expect(parsed).not.toBe(npAgentAdminOperationRegistryV1);
    expect(parsed[0]).not.toBe(npAgentAdminOperationRegistryV1[0]);
    expect(parsed[0]?.schemas.input.schema).not.toBe(
      npAgentAdminOperationRegistryV1[0]?.schemas.input.schema,
    );
    expect(Object.isFrozen(npAgentAdminOperationRegistryV1)).toBe(true);
    expect(Object.isFrozen(npAgentAdminOperationRegistryV1[0]?.schemas.input.schema)).toBe(true);

    const first = npRequireAgentAdminOperationContractV1(npAgentAdminOperationRegistryV1[0]);
    expect(first).toEqual(npAgentAdminOperationRegistryV1[0]);
    expect(npGetAgentAdminOperationV1(first.id)).toBe(npAgentAdminOperationsV1[first.id]);
  });

  it("reuses exact JSON schemas, staff capabilities, and shared effect-profile invariants", () => {
    for (const operation of npAgentAdminOperationRegistryV1) {
      expect(operation.schemas.input.name).toBe(`np.agent-admin.${operation.id}.input`);
      expect(operation.schemas.output.name).toBe(`np.agent-admin.${operation.id}.output`);
      expect(operation.schemas.error.name).toBe(`np.agent-admin.${operation.id}.error`);
      expect(operation.schemas.input.schema).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
      });
      expect(operation.schemas.output.schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(operation.schemas.error.schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(operation.schemas.input.schema.required).toContain("idempotencyKey");
      for (const precondition of operation.preconditions) {
        expect(operation.schemas.input.schema.required).toContain(precondition.field);
      }
      expect([
        "site.access",
        "content.publish",
        "content.author",
        "community.moderate",
        "admin.manage",
      ]).toContain(operation.requiredCapability);
      expect(npAnalyzeAgentEffectProfileDescriptor(operation.effect)).toMatchObject({ ok: true });
      expect(operation.effect).toMatchObject({
        kind: "mutation",
        minimumGatewayExposure: null,
      });
      expect(operation.effect.verifierId).not.toBeNull();
    }
  });

  it("locks secret bodies and all four explicit one-time output exceptions", () => {
    expect(
      npAgentAdminOperationRegistryV1
        .filter(({ secretBody }) => secretBody === "write-only")
        .map(({ id }) => id),
    ).toEqual(["agents.connections.create", "agents.connections.rotate"]);
    expect(
      npAgentAdminOperationsV1["agents.connections.create"].schemas.input.schema.required,
    ).toEqual(
      expect.arrayContaining([
        "credential",
        "definitionHash",
        "definitionJson",
        "vaultOperationId",
      ]),
    );

    const oneTime = npAgentAdminOperationRegistryV1.filter(
      ({ idempotency }) => idempotency.oneTimeOutput,
    );
    expect(oneTime.map(({ id }) => id)).toEqual([
      "agents.gateway.principal_tokens.create",
      "agents.gateway.principal_tokens.rotate",
      "agents.approvals.decision_challenge",
      "agents.changesets.preview_launch",
    ]);
    for (const operation of oneTime) {
      expect(operation.idempotency).toMatchObject({
        retryErrorCode: "ONE_TIME_VALUE_ALREADY_ISSUED",
      });
      expect(operation.idempotency.recoveryOperationId).not.toBeNull();
      expect(operation.audit.responseRedaction).toBe("one-time-values");
      expect(operation.openApi.oneTimeOutputExtension).toBe(true);
      expect(operation.errorResponses).toContainEqual({
        code: "ONE_TIME_VALUE_ALREADY_ISSUED",
        status: 409,
      });
    }
  });

  it("locks approval, reauthentication, compensation, audit, and OpenAPI floors", () => {
    for (const operation of npAgentAdminOperationRegistryV1) {
      if (operation.approval.risk === "sensitive" || operation.approval.risk === "destructive") {
        expect(operation.approval).toMatchObject({
          mode: "human",
          reauthenticationFloor: "recent-staff-primary",
        });
      }
      if (operation.effect.reversibility === "compensatable") {
        expect(operation.effect.compensatorId).not.toBeNull();
      } else {
        expect(operation.effect.compensatorId).toBeNull();
      }
      expect(operation.audit).toMatchObject({
        eventId: operation.id,
        include: ["idempotencyFingerprint", "operationId", "outcome", "siteId", "staffUserId"],
      });
      expect(operation.openApi).toMatchObject({
        tag: "Agent Studio",
        idempotencyExtension: true,
      });
    }
    expect(
      npAgentAdminOperationsV1["agents.changesets.preview_launch"].openApi.responseMediaType,
    ).toBe("text/html");
    expect(
      npAgentAdminOperationRegistryV1
        .filter(({ id }) => id !== "agents.changesets.preview_launch")
        .every(({ openApi }) => openApi.responseMediaType === "application/json"),
    ).toBe(true);
  });

  it("binds stable operation and aggregate golden fingerprints", async () => {
    await expect(
      npDigestAgentAdminOperationContractV1(npAgentAdminOperationRegistryV1[0]),
    ).resolves.toBe("cj1:sha256:5w3d7O1UDEv24p5vldtmuR6qREV8Q6UU4hYYp6aE1nA");
    await expect(npDigestAgentAdminOperationRegistryV1()).resolves.toBe(
      "cj1:sha256:vFzeLUsGdCmY_RMDgUtX4Yvy8fDahDS-tcS4SuLiUWA",
    );

    await expect(
      npResolveAgentAdminOperationFingerprintsV1(npAgentAdminOperationRegistryV1[0]),
    ).resolves.toEqual({
      contract: "cj1:sha256:5w3d7O1UDEv24p5vldtmuR6qREV8Q6UU4hYYp6aE1nA",
      input: "cj1:sha256:7HkwtlbRWtkcmmIPYl0F2Mohk376BEWbeZVTfJxmyeY",
      output: "cj1:sha256:OboNGHvvTIBai7uDWIGNEcR1f4DcYIwtstRq2UmSe0I",
      error: "cj1:sha256:Fyel0xT3mvhp3oAQpe9LROm8DRFJCahG_YIyFHy2s7c",
      effect: "cj1:sha256:r38s9DvF2Y47sSYbei437lmMflaqBUa-Ab_GVJcvvxc",
    });

    const changed = structuredClone(npAgentAdminOperationRegistryV1[0]);
    changed.contractVersion = 2;
    await expect(npDigestAgentAdminOperationContractV1(changed)).rejects.toThrow(
      /must match the locked route/u,
    );
  });

  it("fails closed on incomplete, reordered, unmapped, or internally inconsistent registries", () => {
    const incomplete = cloneRegistry();
    incomplete.pop();
    expect(npAnalyzeAgentAdminOperationRegistryV1(incomplete)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.adminOperationRegistry" }],
    });

    const reordered = cloneRegistry();
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    expect(npAnalyzeAgentAdminOperationRegistryV1(reordered)).toMatchObject({
      ok: false,
      issues: [{ code: "order", path: "agent.adminOperationRegistry[0].id" }],
    });

    const outsidePath = cloneRegistry();
    outsidePath[0].pathTemplate = "/api/admin/connections";
    expect(npAnalyzeAgentAdminOperationRegistryV1(outsidePath)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.adminOperationRegistry[0].pathTemplate" }],
    });

    const missingIdempotency = cloneRegistry();
    const required = missingIdempotency[0].schemas.input.schema.required;
    if (Array.isArray(required)) {
      missingIdempotency[0].schemas.input.schema.required = required.filter(
        (field) => field !== "idempotencyKey",
      );
    }
    expect(npAnalyzeAgentAdminOperationRegistryV1(missingIdempotency)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.adminOperationRegistry[0].schemas.input.schema.required" }],
    });

    const loweredApproval = cloneRegistry();
    loweredApproval[0].approval.reauthenticationFloor = "none";
    expect(npAnalyzeAgentAdminOperationRegistryV1(loweredApproval)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.adminOperationRegistry[0].approval" }],
    });

    const swappedSchema = cloneRegistry();
    swappedSchema[0].schemas.output.schema = swappedSchema[3].schemas.output.schema;
    expect(npAnalyzeAgentAdminOperationRegistryV1(swappedSchema)).toMatchObject({
      ok: false,
      issues: [
        {
          code: "invalid-field",
          path: "agent.adminOperationRegistry[0]",
        },
      ],
    });

    const replayableSecret = cloneRegistry();
    replayableSecret[13].idempotency.oneTimeOutput = false;
    expect(npAnalyzeAgentAdminOperationRegistryV1(replayableSecret)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.adminOperationRegistry[13].idempotency" }],
    });
  });

  it("rejects hostile shapes without invoking accessors", () => {
    const hostile = structuredClone(npAgentAdminOperationRegistryV1[0]) as unknown as Record<
      string,
      unknown
    >;
    const getter = vi.fn(() => "POST");
    Object.defineProperty(hostile, "method", { enumerable: true, get: getter });
    expect(npAnalyzeAgentAdminOperationContractV1(hostile)).toMatchObject({
      ok: false,
      issues: [{ code: "shape", path: "agent.adminOperation.method" }],
    });
    expect(getter).not.toHaveBeenCalled();

    expect(npAnalyzeAgentAdminOperationContractV1(Object.create(null))).toMatchObject({
      ok: false,
      issues: [{ code: "shape", path: "agent.adminOperation" }],
    });
  });

  it("closes canonical Admin idempotency requests over the same operation inventory", () => {
    expect(
      npAnalyzeAgentInvocationRequestCanonical(adminInvocation("agents.connections.create")),
    ).toMatchObject({
      ok: true,
      value: { operationId: "agents.connections.create", operationKind: "admin" },
    });
    expect(
      npAnalyzeAgentInvocationRequestCanonical(adminInvocation("agents.connections.missing")),
    ).toMatchObject({
      ok: false,
      issues: [
        {
          code: "invalid-field",
          path: "agent.canonical.idempotencyRequest.operationId",
        },
      ],
    });
  });
});
