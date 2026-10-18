import { npRequireAgentProviderSchemaValueV1 } from "./provider-auth-contract.js";
import { describe, expect, it } from "vitest";
import { previewFixture } from "./changeset-preview-test-fixture.js";
import { withAgentChangeSetPreview } from "./changeset-preview-overlay.js";
import { createAgentGuardianSessionServiceV1 } from "./guardian-session-service.js";
import { createAgentGuardianSessionObservationServiceV1 } from "./guardian-session-observation.js";
import { npGuardianSessionCapabilityDefinitionV1 } from "./guardian-session-capability.js";

describe("Guardian exact session execution boundaries", () => {
  it("blocks planning, execution and source collection before inputs, authority or a database during preview", async () => {
    const untouched = () => {
      throw new Error("Preview reached a host service");
    };
    const effect = createAgentGuardianSessionServiceV1({
      reads: { get: untouched, list: untouched, authorize: untouched },
      events: { record: untouched },
      resolveApprovals: untouched,
      resolvePolicy: untouched,
      canReviewIncidentAsStaffUser: untouched,
    });
    const source = createAgentGuardianSessionObservationServiceV1({
      actorKey: { id: "preview-session-key", bytes: new Uint8Array(32).fill(71) },
      isInstalledSite: untouched,
      authorize: untouched,
      events: { record: untouched },
    });
    const poison = new Proxy(
      {},
      {
        get() {
          throw new Error("Preview read an effect input");
        },
      },
    );
    await withAgentChangeSetPreview(await previewFixture(), async () => {
      for (const method of [
        effect.plan.bind(effect),
        effect.execute.bind(effect),
        source.observe.bind(source),
      ])
        await expect(
          Promise.resolve().then(() => Reflect.apply(method, undefined, [poison])),
        ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    });
  });
  it("advertises a sensitive non-reversible human action with no Gateway or compensator", async () => {
    const definition = await npGuardianSessionCapabilityDefinitionV1();
    const id = "00000000-0000-4000-8000-000000000001",
      hash = `cj1:sha256:${"A".repeat(43)}`;
    const command = {
      schemaVersion: "np.agent-guardian-session-plan-input.v1",
      expectedVersion: 1,
      expectedTargetVersionDigest: hash,
      idempotencyKey: "schema-test",
    };
    const canonical = {
      schemaVersion: "np.agent-guardian-session-action-input.v1",
      command,
      family: { actorKind: "staff", principalId: id, sessionFamilyId: id },
      target: {
        actorKind: "staff",
        sessionFamilyId: id,
        createdAt: "2026-10-18T00:00:00.000Z",
        impact: "deployment",
        affectedSiteCount: 1,
        impactDigest: hash,
      },
      sourceDigest: hash,
      policyDigest: hash,
    };
    expect(() =>
      npRequireAgentProviderSchemaValueV1(definition.descriptor.inputSchema, canonical),
    ).not.toThrow();
    expect(() =>
      npRequireAgentProviderSchemaValueV1(definition.descriptor.inputSchema, command),
    ).toThrow();
    expect(() =>
      npRequireAgentProviderSchemaValueV1(definition.descriptor.inputSchema, {
        ...canonical,
        family: { ...canonical.family, accessToken: "private" },
      }),
    ).toThrow();
    expect(definition.descriptor).toMatchObject({
      id: "security.revokeSessions",
      risk: "sensitive",
      approval: "human",
      gateway: null,
      idempotency: "required",
      effectProfiles: [{ id: "sessions.revoke", reversibility: "none", compensatorId: null }],
    });
  });
});
