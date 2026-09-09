import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
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
import { npAgentChangeSetWireSchemaV1 } from "./changeset-capability-schema.js";
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
  it("extends the locked reads with exactly five ChangeSet descriptors", () => {
    expect(npAgentInstalledCapabilityIdsV1).toEqual([
      "changeset.create",
      "changeset.get",
      "changeset.list",
      "changeset.preview",
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
        approval: "none",
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
    ).toMatchInlineSnapshot(`"d28efc8e6d75b5c007e37d2a61ec55f73b71a803218a5b83d78e415c9634111c"`);
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
        { approvalId: id },
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
