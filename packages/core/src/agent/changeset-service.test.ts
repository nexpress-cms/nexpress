import { describe, expect, it, vi } from "vitest";
import { createAgentChangeSetServiceV1 } from "./changeset-service.js";
import { createAgentReadCapabilityRegistryV1 } from "./capability-registry.js";
import {
  npAgentReadCapabilityDescriptorsV1,
  npAgentReadCapabilityIdsV1,
} from "../agent-contract/read-capability-contract.js";
import * as definitionContract from "../agent-contract/canonical-capability-registry.js";
import * as db from "../db/runtime.js";

describe("ChangeSet service factory contract boundary", () => {
  it("validates its complete internal descriptor without requiring a database or adding execution services", () => {
    const getDb = vi.spyOn(db, "getDb");
    const validateDefinition = vi.spyOn(
      definitionContract,
      "npRequireAgentCapabilityRegistryCanonical",
    );
    try {
      const service = createAgentChangeSetServiceV1({ cursorKey: new Uint8Array(32).fill(41) });
      expect(Object.keys(service).sort()).toEqual([
        "artifacts",
        "create",
        "get",
        "getPreview",
        "list",
        "preview",
        "processPreview",
        "processValidation",
        "readPreviewArtifact",
        "reconcileExpired",
        "reconcilePreviews",
        "reconcileValidations",
        "renderPreview",
        "update",
        "validate",
        "withPreviewAuthority",
        "withPreviewViewer",
      ]);
      expect(getDb).not.toHaveBeenCalled();
      const invocation = validateDefinition.mock.calls.find(
        ([body]) => (body as { projection?: string }).projection === "definition",
      );
      expect(invocation).toBeDefined();
      const definition = definitionContract.npRequireAgentCapabilityRegistryCanonical(
        invocation![0],
      );
      expect(definition.capabilities).toHaveLength(1);
      expect(definition.capabilities[0]?.descriptor).toMatchObject({
        id: "changeset.create",
        requiredScopes: ["changeset:write"],
        scopeDerivation: "changeset-resources",
        execution: "inline",
        idempotency: "required",
        gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
        outputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          additionalProperties: false,
          properties: { changeSetId: { type: "string", format: "uuid", maxLength: 36 } },
          required: ["changeSetId"],
        },
      });
      expect(definition.capabilities[0]?.effectProfiles).toHaveLength(1);
      const validationCall = validateDefinition.mock.calls.find(
        ([body]) =>
          (body as { capabilities?: { descriptor: { id: string } }[] }).capabilities?.[0]
            ?.descriptor.id === "changeset.validate",
      );
      expect(validationCall).toBeDefined();
      const validation = definitionContract.npRequireAgentCapabilityRegistryCanonical(
        validationCall![0],
      );
      expect(validation.capabilities[0]?.descriptor).toMatchObject({
        id: "changeset.validate",
        requiredScopes: ["changeset:read"],
        inputSchema: {
          additionalProperties: false,
          required: ["idempotencyKey", "expectedVersion", "changeSetId"],
        },
      });
    } finally {
      validateDefinition.mockRestore();
      getDb.mockRestore();
    }
  });
  it("leaves the advertised read registry and descriptor inventory unchanged", async () => {
    const execute = vi.fn((): never => {
      throw new Error("Not executed by registry discovery");
    });
    const executors = { "content.query": execute, "schema.get": execute, "site.inspect": execute };
    const before = await createAgentReadCapabilityRegistryV1(executors);
    const descriptors = JSON.stringify(npAgentReadCapabilityDescriptorsV1);
    createAgentChangeSetServiceV1({ cursorKey: new Uint8Array(32).fill(42) });
    const after = await createAgentReadCapabilityRegistryV1(executors);
    expect(before.ids).toEqual(["content.query", "schema.get", "site.inspect"]);
    expect(after.ids).toEqual(npAgentReadCapabilityIdsV1);
    expect(after.registryFingerprint).toBe(before.registryFingerprint);
    expect(JSON.stringify(npAgentReadCapabilityDescriptorsV1)).toBe(descriptors);
    expect(() => after.get("changeset.create" as never)).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects invalid retention and cursor configuration before accepting work", () => {
    expect(() => createAgentChangeSetServiceV1({ cursorKey: new Uint8Array(31) })).toThrow();
    for (const eligibilitySeconds of [0, 59, 7776001, NaN, Infinity, 1.5])
      expect(() =>
        createAgentChangeSetServiceV1({ cursorKey: new Uint8Array(32), eligibilitySeconds }),
      ).toThrow();
    for (const value of [-1, Infinity, NaN, 1.5]) {
      for (const field of [
        "validationLifetimeSeconds",
        "inlineValidationOperationLimit",
        "rollbackWindowSeconds",
      ])
        expect(() =>
          createAgentChangeSetServiceV1({ cursorKey: new Uint8Array(32), [field]: value }),
        ).toThrow();
    }
    for (const eligibilitySeconds of [60, 7776000])
      expect(() =>
        createAgentChangeSetServiceV1({ cursorKey: new Uint8Array(32), eligibilitySeconds }),
      ).not.toThrow();
  });
});
