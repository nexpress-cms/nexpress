import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  npRequireAgentChangeSetExecutionOutputV1,
  npRequireAgentChangeSetApplyCapabilityInputV1,
  npRequireAgentChangeSetScheduleCapabilityInputV1,
  npRequireAgentChangeSetRollbackCapabilityInputV1,
  npAgentChangeSetCapabilityIdsV1,
  npAgentInstalledCapabilityIdsV1,
  npAgentInstalledCapabilityDescriptorsV1,
  npBuildAgentChangeSetCapabilityDefinitionCanonicalV1,
  npRequireAgentInstalledCapabilityInputV1,
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  npRequireAgentInstalledCapabilityOutputV1,
  npRequireAgentChangeSetCapabilityInvocationResultV1,
} from "./installed-capability-contract.js";
import {
  npAgentReadCapabilityIdsV1,
  npAgentReadCapabilityDescriptorsV1,
} from "./read-capability-contract.js";
import { npAgentChangeSetWireIncludedKeysV1 } from "./changeset-wire-contract.js";
import {
  npAgentChangeSetExecutionPhasePoliciesV1,
  npAgentChangeSetRollbackModePoliciesV1,
  npAgentChangeSetWireSchemaV1,
} from "./changeset-capability-schema.js";
const id = "00000000-0000-4000-8000-000000000001";
const hash = `cj1:sha256:${"a".repeat(43)}`;
const list = {
  states: [],
  actorKinds: [],
  createdAfter: null,
  createdBefore: null,
  limit: 25,
  cursor: null,
};
describe("installed framework capability projection", () => {
  it("extends the locked reads with exactly eight ChangeSet descriptors", () => {
    expect(npAgentInstalledCapabilityIdsV1).toEqual([
      "changeset.apply",
      "changeset.create",
      "changeset.get",
      "changeset.list",
      "changeset.preview",
      "changeset.rollback",
      "changeset.schedule",
      "changeset.validate",
      "content.query",
      "schema.get",
      "site.inspect",
    ]);
    for (const id of npAgentReadCapabilityIdsV1)
      expect(npAgentInstalledCapabilityDescriptorsV1[id]).toBe(
        npAgentReadCapabilityDescriptorsV1[id],
      );
    for (const id of npAgentChangeSetCapabilityIdsV1) {
      const d = npAgentInstalledCapabilityDescriptorsV1[id];
      expect(Object.isFrozen(d)).toBe(true);
      expect(Object.isFrozen(d.inputSchema.properties)).toBe(true);
      expect(Object.isFrozen(d.outputSchema.$defs)).toBe(true);
      expect(
        npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(id).capabilities[0].descriptor,
      ).toEqual(d);
      expect(d).toMatchObject({
        approval: id === "changeset.apply" || id === "changeset.schedule" ? "human" : "none",
        scopeDerivation: "changeset-resources",
        gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
      });
      expect(d.idempotency).toBe(
        id === "changeset.get" || id === "changeset.list" ? "none" : "required",
      );
    }
    expect(npAgentInstalledCapabilityDescriptorsV1["changeset.validate"]).toMatchObject({
      risk: "read",
      execution: "either",
      effectProfiles: [{ id: "domain.read", kind: "read", minimumGatewayExposure: "propose" }],
    });
    expect(npAgentInstalledCapabilityDescriptorsV1["changeset.preview"]).toMatchObject({
      risk: "read",
      execution: "durable",
    });
    expect(
      createHash("sha256")
        .update(JSON.stringify(npAgentInstalledCapabilityDescriptorsV1))
        .digest("hex"),
    ).toMatchInlineSnapshot(`"d15e6aeb772154c92bda1248bb887e48d6bcfe07524418081cd473c0881440f9"`);
  });
  it("reuses the whole wire and closes every workflow object", () => {
    expect(Object.keys(npAgentChangeSetWireSchemaV1.properties as object)).toEqual(
      npAgentChangeSetWireIncludedKeysV1,
    );
    const visit = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) {
        v.forEach(visit);
        return;
      }
      const r = v as Record<string, unknown>;
      if (r.type === "object") expect(r.additionalProperties).toBe(false);
      Object.values(r).forEach(visit);
    };
    Object.values(npAgentInstalledCapabilityDescriptorsV1).forEach((d) => {
      visit(d.inputSchema);
      visit(d.outputSchema);
    });
  });
  it("requires exact immutable evidence, selector fields and external idempotency", () => {
    const inputs = {
      "changeset.apply": { changeSetId: id, planHash: hash, approvalId: null },
      "changeset.schedule": {
        changeSetId: id,
        planHash: hash,
        approvalId: null,
        scheduledFor: "2026-09-11T10:00:00.000Z",
      },
      "changeset.rollback": { mode: "prepare", changeSetId: id },
      "changeset.create": { title: "Draft", summary: null, operations: [] },
      "changeset.get": { changeSetId: id },
      "changeset.list": list,
      "changeset.validate": { changeSetId: id, draftVersion: 1, draftHash: hash },
      "changeset.preview": { changeSetId: id, planHash: hash },
    };
    for (const capabilityId of npAgentChangeSetCapabilityIdsV1) {
      const input = inputs[capabilityId];
      const idempotencyKey =
        capabilityId === "changeset.get" || capabilityId === "changeset.list" ? null : "stable-key";
      const request = {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId,
        arguments: { input, idempotencyKey },
      };
      expect(npRequireAgentInstalledCapabilityInvocationRequestV1(request)).toEqual(request);
      for (const extra of [
        { siteId: "other" },
        { credential: "secret" },
        { runId: id },
        { statementHash: hash },
      ])
        expect(() =>
          npRequireAgentInstalledCapabilityInvocationRequestV1({
            ...request,
            arguments: { ...request.arguments, input: { ...input, ...extra } },
          }),
        ).toThrow();
      expect(() =>
        npRequireAgentInstalledCapabilityInvocationRequestV1({
          ...request,
          arguments: { input, idempotencyKey: idempotencyKey === null ? "extra" : null },
        }),
      ).toThrow();
    }
    expect(() =>
      npRequireAgentInstalledCapabilityInputV1("changeset.list", {
        ...list,
        states: ["ready", "draft"],
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentInstalledCapabilityInputV1("changeset.list", {
        ...list,
        createdAfter: "2026-01-02T00:00:00.000Z",
        createdBefore: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });
  it("does not evaluate accessors and never exposes internal action/run evidence", () => {
    let calls = 0;
    const hostile = { changeSetId: id };
    Object.defineProperty(hostile, "planHash", {
      enumerable: true,
      get() {
        calls++;
        return hash;
      },
    });
    expect(() => npRequireAgentInstalledCapabilityInputV1("changeset.preview", hostile)).toThrow();
    expect(calls).toBe(0);
    const output = { schemaVersion: "np.agent-changeset-list.v1", items: [], nextCursor: null };
    expect(npRequireAgentInstalledCapabilityOutputV1("changeset.list", output)).toEqual(output);
    const result = {
      schemaVersion: "np.agent-changeset-invocation-result.v1",
      invocationId: id,
      capabilityId: "changeset.list",
      output,
    };
    expect(npRequireAgentChangeSetCapabilityInvocationResultV1(result)).toEqual(result);
    for (const extra of [
      { actionId: id },
      { runId: id },
      { locator: "private" },
      { canonicalInput: {} },
    ])
      expect(() =>
        npRequireAgentChangeSetCapabilityInvocationResultV1({ ...result, ...extra }),
      ).toThrow();
  });
});

describe("exact Gateway execution capability inputs", () => {
  const apply = { changeSetId: id, planHash: hash, approvalId: null };
  it("distinguishes approval requests from approved apply and schedule without duplicate idempotency", () => {
    expect(npRequireAgentChangeSetApplyCapabilityInputV1(apply)).toEqual(apply);
    expect(
      npRequireAgentChangeSetApplyCapabilityInputV1({ ...apply, approvalId: id }).approvalId,
    ).toBe(id);
    const scheduled = { ...apply, scheduledFor: "2026-09-11T10:00:00.000Z" };
    expect(npRequireAgentChangeSetScheduleCapabilityInputV1(scheduled)).toEqual(scheduled);
    for (const field of [
      "siteId",
      "idempotencyKey",
      "statementHash",
      "expectedDraftVersion",
      "scheduledFor",
    ])
      expect(() =>
        npRequireAgentChangeSetApplyCapabilityInputV1({ ...apply, [field]: id }),
      ).toThrow();
    expect(() => npRequireAgentChangeSetScheduleCapabilityInputV1(apply)).toThrow();
    expect(() =>
      npRequireAgentChangeSetScheduleCapabilityInputV1({
        ...scheduled,
        scheduledFor: "2026-09-11T19:00:00+09:00",
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentChangeSetApplyCapabilityInputV1({ changeSetId: id, planHash: hash }),
    ).toThrow();
  });
  it("closes every rollback mode and does not accept execution facts in preparation", () => {
    const prepare = { mode: "prepare", changeSetId: id };
    const request = {
      mode: "request_approval",
      changeSetId: id,
      rollbackPlanId: id,
      planHash: hash,
    };
    const execute = { ...request, mode: "execute_approved", approvalId: id };
    for (const value of [prepare, request, execute])
      expect(npRequireAgentChangeSetRollbackCapabilityInputV1(value)).toEqual(value);
    for (const value of [
      { ...prepare, approvalId: id },
      { ...prepare, planHash: hash },
      { ...request, approvalId: null },
      { ...execute, approvalId: null },
      { ...execute, mode: "execute" },
      { ...execute, statementHash: hash },
      { ...request, rollbackPlanId: undefined },
    ])
      expect(() => npRequireAgentChangeSetRollbackCapabilityInputV1(value)).toThrow();
  });
});

describe("client-safe execution capability results", () => {
  const at = "2026-09-08T00:00:00.000Z";
  const changeSet = {
    schemaVersion: "np.agent-changeset.v1",
    id,
    siteId: "default",
    title: "Draft",
    summary: null,
    state: "draft",
    actor: { id, kind: "external", name: "External" },
    agentId: null,
    agentVersionId: null,
    agentConfigHash: null,
    runId: null,
    planHash: null,
    baseFingerprint: null,
    draftVersion: 1,
    draftHash: hash,
    risk: null,
    operations: [],
    validation: null,
    preview: null,
    approval: null,
    schedule: null,
    execution: null,
    verification: null,
    rollback: null,
    createdAt: at,
    updatedAt: at,
    expiresAt: "2026-10-08T00:00:00.000Z",
  };
  const base = { schemaVersion: "np.agent-changeset-execution-result.v1", changeSet, runId: id };
  it("requires actual bounded run references and rejects hidden or mismatched fields", () => {
    const complete = { ...base, state: "completed" };
    const accepted = {
      ...base,
      state: "accepted",
      statusResource: `/api/agent/v1/runs/${id}`,
      pollAfterMs: 2000,
    };
    for (const value of [complete, accepted]) {
      expect(npRequireAgentChangeSetExecutionOutputV1(value)).toEqual(value);
      for (const key of ["credential", "locator", "canonicalInput", "internalError"])
        expect(() =>
          npRequireAgentChangeSetExecutionOutputV1({ ...value, [key]: "private" }),
        ).toThrow();
    }
    for (const value of [
      { ...complete, runId: null },
      { ...complete, pollAfterMs: 2000 },
      { ...accepted, pollAfterMs: 999 },
      { ...accepted, pollAfterMs: 10001 },
      { ...accepted, statusResource: "https://evil.invalid/" },
      {
        ...accepted,
        statusResource: `/api/agent/v1/runs/${"11111111-1111-4111-8111-111111111111"}`,
      },
    ])
      expect(() => npRequireAgentChangeSetExecutionOutputV1(value)).toThrow();
  });
  it("binds approval-required references to the projected target and exact Admin link", () => {
    const sealed = {
      ...changeSet,
      state: "approval_pending",
      planHash: hash,
      baseFingerprint: hash,
      risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
      validation: { state: "valid", generation: 1, issueCount: 0, digest: hash, completedAt: at },
      approval: {
        id,
        generation: 1,
        state: "pending",
        statementHash: hash,
        requiredHumanCapabilities: ["content.author"],
        requiredHumanPredicates: [],
        requestedAt: at,
        expiresAt: "2026-09-09T00:00:00.000Z",
        decidedAt: null,
      },
    };
    const result = {
      ...base,
      changeSet: sealed,
      state: "approval_required",
      actionId: id,
      approvalId: id,
      proposalHash: hash,
      approvalResource: `/admin/agents/approvals/${id}`,
      expiresAt: "2026-09-09T00:00:00.000Z",
    };
    expect(npRequireAgentChangeSetExecutionOutputV1(result)).toEqual(result);
    for (const value of [
      { ...result, actionId: null },
      { ...result, approvalResource: "https://evil.invalid" },
      { ...result, proposalHash: `cj1:sha256:${"b".repeat(43)}` },
      { ...result, changeSet },
    ])
      expect(() => npRequireAgentChangeSetExecutionOutputV1(value)).toThrow();
  });
});

it("locks execution policy floors and declared bookkeeping profiles", () => {
  for (const id of ["changeset.apply", "changeset.schedule"] as const) {
    expect(npAgentInstalledCapabilityDescriptorsV1[id]).toMatchObject({
      risk: "sensitive",
      approval: "human",
      execution: "durable",
      idempotency: "required",
      requiredScopes: ["changeset:apply"],
      effectProfiles: [
        {
          id,
          kind: "mutation",
          reversibility: "none",
          minimumGatewayExposure: "approved-execute",
          verifierId: "changeset.verify",
          compensatorId: null,
        },
        {
          id: "domain.read",
          kind: "read",
          minimumGatewayExposure: "propose",
          verifierId: null,
          compensatorId: null,
        },
      ],
    });
  }
  expect(npAgentInstalledCapabilityDescriptorsV1["changeset.rollback"]).toMatchObject({
    risk: "read",
    approval: "none",
    execution: "durable",
    requiredScopes: ["changeset:apply"],
    effectProfiles: [
      {
        id: "changeset.rollback-execute",
        kind: "mutation",
        minimumGatewayExposure: "approved-execute",
        verifierId: "changeset.verify",
        compensatorId: null,
      },
      {
        id: "domain.read",
        kind: "read",
        minimumGatewayExposure: "propose",
        verifierId: null,
        compensatorId: null,
      },
    ],
  });
});

it("declares every selected execution phase profile in its canonical definition", () => {
  const policies = {
    ...npAgentChangeSetExecutionPhasePoliciesV1,
    "changeset.rollback": npAgentChangeSetRollbackModePoliciesV1,
  };
  for (const id of ["changeset.apply", "changeset.schedule", "changeset.rollback"] as const) {
    const definition = npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(id);
    for (const policy of Object.values(policies[id])) {
      expect(definition.capabilities[0].effectProfiles).toContainEqual(
        expect.objectContaining({
          profileId: policy.effectProfileId,
          minimumGatewayExposure: policy.minimumGatewayExposure,
        }),
      );
      const descriptor = npAgentInstalledCapabilityDescriptorsV1[id];
      expect(descriptor.inputSchema.oneOf).toContainEqual(
        expect.objectContaining({
          "x-nexpress-effect-profile": policy.effectProfileId,
          "x-nexpress-risk": policy.risk,
          "x-nexpress-approval": policy.approval,
          "x-nexpress-minimum-gateway-exposure": policy.minimumGatewayExposure,
        }),
      );
    }
  }
});
