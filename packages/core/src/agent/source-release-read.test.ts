import { beforeEach, describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import type {
  npAgentActions,
  npAgentInvocations,
  npAgentSourceReleases,
} from "../db/schema/agent.js";
import { npAgentReadCapabilityDescriptorsV1 } from "../agent-contract/read-capability-contract.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npDigestAgentAuthorizationContextCanonical } from "../agent-contract/canonical-authorization-context.js";
import { npDigestAgentInvocationRequestCanonical } from "../agent-contract/canonical-idempotency-request.js";
import {
  npDigestAgentRuntimeAdmissionKeyV1,
  npDigestAgentSourceReleaseV1,
} from "../agent-contract/source-release-contract.js";
import type {
  NpAgentCapabilityRegistryCanonicalV1,
  NpAgentSourceReleaseV1,
} from "../agent-contract/types.js";
import {
  npAgentReleaseActionDigestV1,
  npIsAgentRuntimeAdmissionKeyConsumedV1,
  npRequireAgentSourceReleaseRecordV1,
  npVerifyAgentReleaseReadAttributionV1,
  npResolveReleasedAgentActionPrincipalV1,
} from "./source-release-read.js";

type Action = typeof npAgentActions.$inferSelect;
type Invocation = typeof npAgentInvocations.$inferSelect;
type Release = typeof npAgentSourceReleases.$inferSelect;
const id = "11111111-1111-4111-8111-111111111111";
const invocationId = "22222222-2222-4222-8222-222222222222";
const principalId = "33333333-3333-4333-8333-333333333333";
const releaseId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const actionId = "66666666-6666-4666-8666-666666666666";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const siteId = "source-release-test";
const at = new Date("2026-01-01T00:00:00.000Z");
const deadlineAt = "2026-01-01T00:05:00.000Z";
const releasedAt = new Date("2026-09-01T00:00:00.000Z");

async function fixture() {
  const descriptor = npAgentReadCapabilityDescriptorsV1["site.inspect"];
  const profile = descriptor.effectProfiles[0];
  if (!profile) throw new Error("fixture requires a read effect profile");
  const definition: NpAgentCapabilityRegistryCanonicalV1 = {
    schemaVersion: "np.agent-capability-registry.v1",
    projection: "definition",
    capabilities: [
      {
        descriptor,
        implementationVersion: 1,
        effectProfiles: [
          {
            schemaVersion: "np.agent-effect-profile.v1",
            capabilityId: descriptor.id,
            capabilityContractVersion: descriptor.contractVersion,
            implementationVersion: 1,
            profileId: profile.id,
            kind: profile.kind,
            reversibility: profile.reversibility,
            minimumGatewayExposure: profile.minimumGatewayExposure,
            effectContractVersion: 1,
            verifierId: profile.verifierId,
            compensatorId: profile.compensatorId,
          },
        ],
      },
    ],
  };
  const capabilityFingerprint = await npDigestAgentCapabilityRegistryCanonical(
    definition,
    definition.capabilities,
  );
  const authorizationContextBody: Invocation["authorizationContextBody"] = {
    schemaVersion: "np.agent-authorization-context.v1",
    siteId,
    actor: { kind: "principal", principalId, actorFingerprint: "sha256:runtime-fixture" },
    transport: "runtime",
    gatewayExposure: null,
    authorityRef: {
      kind: "runtime-run",
      principalId,
      runId: id,
      agentVersionId: versionId,
      deadlineAt,
    },
  };
  const authorizationContextFingerprint =
    await npDigestAgentAuthorizationContextCanonical(authorizationContextBody);
  const requestBody: Invocation["requestBody"] = {
    schemaVersion: "np.agent-idempotency-request.v1",
    siteId,
    actorKind: "principal",
    actorFingerprint: "sha256:runtime-fixture",
    authorizationContextFingerprint,
    operationKind: "capability",
    operationId: "site.inspect",
    contractVersion: descriptor.contractVersion,
    contractFingerprint: capabilityFingerprint,
    effectProfile: { id: "domain.read", contractVersion: 1 },
    input: {},
  };
  const requestHash = await npDigestAgentInvocationRequestCanonical(requestBody);
  const invocation: Invocation = {
    id: invocationId,
    siteId,
    actorKind: "principal",
    principalId,
    staffUserId: null,
    actorFingerprint: "sha256:runtime-fixture",
    authorizationContextBody,
    authorizationContextFingerprint,
    authorityRef: { ...authorizationContextBody.authorityRef },
    actorDeletedAt: null,
    operationKind: "capability",
    operationId: "site.inspect",
    contractVersion: descriptor.contractVersion,
    contractFingerprint: capabilityFingerprint,
    capabilityDefinitionBody: definition,
    effectProfileId: "domain.read",
    effectContractVersion: 1,
    transport: "runtime",
    mcpExecutionMode: null,
    mcpRequestedTaskTtlMs: null,
    idempotencyKey: `runtime:${id}:1`,
    requestBody,
    requestHash,
    state: "completed",
    runId: null,
    resultKind: "action",
    resultId: actionId,
    outputRedacted: {},
    outputHash: digest,
    oneTimeValueIssued: false,
    oneTimeResourceId: null,
    oneTimeRecoveryOperationId: null,
    auditEventId: invocationId,
    errorCode: null,
    requestedAt: at,
    completedAt: at,
    expiresAt: new Date(deadlineAt),
  };
  const action: Action = {
    id: actionId,
    siteId,
    runId: id,
    runFingerprint: digest,
    runSourceReleaseId: null,
    invocationId,
    invocationFingerprint: requestHash,
    executionInvocationId: null,
    executionInvocationFingerprint: null,
    sequence: 1,
    capabilityId: "site.inspect",
    capabilityContractVersion: descriptor.contractVersion,
    capabilityFingerprint,
    capabilityDefinitionBody: definition,
    effectProfileId: "domain.read",
    effectContractVersion: 1,
    risk: "read",
    state: "succeeded",
    idempotencyKey: `runtime:${id}:1`,
    inputRedacted: {},
    inputCanonical: {},
    requiredScopes: ["site:read"],
    targetRefs: [],
    targetVersionFacts: [],
    inputHash: digest,
    outputRedacted: {},
    outputHash: digest,
    effectDigest: null,
    targetVersionDigest: null,
    verifierId: null,
    verificationState: null,
    verificationResultDigest: null,
    verificationEvidence: null,
    verifiedAt: null,
    undoRef: null,
    compensatorId: null,
    compensationResultDigest: null,
    compensationEvidence: null,
    compensatedAt: null,
    errorCode: null,
    approvalId: null,
    containmentId: null,
    enforcementAdapterId: null,
    enforcementAdapterContractVersion: null,
    enforcementAdapterFingerprint: null,
    compensatesActionId: null,
    auditEventId: null,
    startedAt: at,
    finishedAt: at,
    createdAt: at,
  };
  action.inputHash = await npAgentReleaseActionDigestV1(action);
  const body: NpAgentSourceReleaseV1 = {
    schemaVersion: "np.agent-source-release.v1",
    verifierVersion: 1,
    kind: "runtime-run",
    siteId,
    sourceId: id,
    releasedAt: releasedAt.toISOString(),
    principalId,
    agentId: id,
    agentVersionId: versionId,
    admissionFingerprint: digest,
    runLimitsHash: digest,
    budgetSnapshotHash: digest,
    state: "succeeded",
    finishedAt: at.toISOString(),
    deadlineAt,
    retentionEligibleAt: releasedAt.toISOString(),
    admissionKeyDigest: await npDigestAgentRuntimeAdmissionKeyV1({
      siteId,
      principalId,
      idempotencyKey: "run:1",
    }),
  };
  const release: Release = {
    id: releaseId,
    siteId,
    sourceKind: body.kind,
    sourceId: id,
    evidenceBody: body,
    evidenceDigest: await npDigestAgentSourceReleaseV1(body),
    releasedAt,
    principalId,
    admissionKeyDigest: body.admissionKeyDigest,
  };
  return {
    action,
    invocation,
    release,
    body,
    runId: id,
    runFingerprint: digest,
    principalId,
    agentVersionId: versionId,
    deadlineAt,
  };
}

const predicates: SQL[] = [];
let rows: unknown[][] = [];
const db = {
  select: () => ({
    from: () => ({
      where: (predicate: SQL) => {
        predicates.push(predicate);
        return { limit: () => Promise.resolve(rows.shift() ?? []) };
      },
    }),
  }),
} as unknown as ReturnType<typeof getDb>;
beforeEach(() => {
  rows = [];
  predicates.length = 0;
});

describe("source-release record and admission readers", () => {
  it("verifies receipt digest plus exact persisted identities and denormalized key", async () => {
    const f = await fixture();
    await expect(npRequireAgentSourceReleaseRecordV1(f.release)).resolves.toEqual(f.body);
    for (const changed of [
      { ...f.release, sourceId: actionId },
      { ...f.release, siteId: "other-site" },
      { ...f.release, sourceKind: "provider-call" },
      { ...f.release, principalId: actionId },
      { ...f.release, admissionKeyDigest: null },
      { ...f.release, releasedAt: at },
      { ...f.release, evidenceDigest: digest },
    ])
      await expect(npRequireAgentSourceReleaseRecordV1(changed)).rejects.toMatchObject({
        code: "RUNTIME_RELEASE_INVALID",
      });
  });

  it("queries consumed keys with the exact canonical scope without passing db into the pure helper", async () => {
    rows = [[{ id: releaseId }], []];
    const scope = { siteId, principalId, idempotencyKey: "run:1" };
    expect(await npIsAgentRuntimeAdmissionKeyConsumedV1({ db, ...scope })).toBe(true);
    expect(await npIsAgentRuntimeAdmissionKeyConsumedV1({ db, ...scope })).toBe(false);
    const predicate = predicates[0];
    if (!predicate) throw new Error("query absent");
    const query = new PgDialect().sqlToQuery(predicate);
    expect(query.params).toEqual([
      siteId,
      "runtime-run",
      principalId,
      await npDigestAgentRuntimeAdmissionKeyV1(scope),
    ]);
    expect(query.params).not.toContain(scope.idempotencyKey);
  });
});

describe("actual read attribution verifier", () => {
  it("preserves canonical action digest across live-to-released locator transition", async () => {
    const f = await fixture();
    const live = await npVerifyAgentReleaseReadAttributionV1(f);
    expect(live).not.toBeNull();
    const detached = { ...f.action, runId: null, runSourceReleaseId: releaseId };
    expect(await npAgentReleaseActionDigestV1(detached)).toBe(f.action.inputHash);
    expect(await npVerifyAgentReleaseReadAttributionV1({ ...f, action: detached })).toEqual(live);
  });

  it.each(["agentVersionId", "deadlineAt"] as const)(
    "rejects changed %s despite recomputed valid canonical hashes",
    async (key) => {
      const f = await fixture();
      const auth = f.invocation.authorizationContextBody;
      if (auth.authorityRef.kind !== "runtime-run") throw new Error("fixture authority");
      auth.authorityRef = {
        ...auth.authorityRef,
        [key]: key === "agentVersionId" ? actionId : "2026-01-01T00:06:00.000Z",
      };
      f.invocation.authorityRef = { ...auth.authorityRef };
      f.invocation.authorizationContextFingerprint =
        await npDigestAgentAuthorizationContextCanonical(auth);
      f.invocation.requestBody.authorizationContextFingerprint =
        f.invocation.authorizationContextFingerprint;
      f.invocation.requestHash = await npDigestAgentInvocationRequestCanonical(
        f.invocation.requestBody,
      );
      f.action.invocationFingerprint = f.invocation.requestHash;
      f.action.inputHash = await npAgentReleaseActionDigestV1(f.action);
      expect(await npVerifyAgentReleaseReadAttributionV1(f)).toBeNull();
    },
  );

  it.each(["site", "operation", "effect", "actor", "contract"] as const)(
    "rejects recomputed request with mismatched %s attribution",
    async (field) => {
      const f = await fixture();
      if (field === "site") f.invocation.requestBody.siteId = "other-site";
      if (field === "operation") f.invocation.requestBody.operationId = "schema.get";
      if (field === "effect")
        f.invocation.requestBody.effectProfile = { id: "other.read", contractVersion: 1 };
      if (field === "actor") f.invocation.requestBody.actorFingerprint = "sha256:other-actor";
      if (field === "contract") f.invocation.requestBody.contractFingerprint = digest;
      f.invocation.requestHash = await npDigestAgentInvocationRequestCanonical(
        f.invocation.requestBody,
      );
      f.action.invocationFingerprint = f.invocation.requestHash;
      f.action.inputHash = await npAgentReleaseActionDigestV1(f.action);
      expect(await npVerifyAgentReleaseReadAttributionV1(f)).toBeNull();
    },
  );

  it.each(["missing-selected-profile", "unsupported-profile-version"] as const)(
    "pins a canonical registry with %s despite self-consistent replacement digests",
    async (variant) => {
      const f = await fixture();
      const definition = structuredClone(f.action.capabilityDefinitionBody);
      const entry = definition.capabilities[0];
      const descriptorProfile = entry?.descriptor.effectProfiles[0];
      const canonicalProfile = entry?.effectProfiles[0];
      if (!entry || !descriptorProfile || !canonicalProfile)
        throw new Error("Missing profile fixture");
      if (variant === "missing-selected-profile") {
        // The registry is internally valid, but it no longer defines the profile selected by the action.
        descriptorProfile.id = "other.read";
        canonicalProfile.profileId = "other.read";
      } else {
        canonicalProfile.effectContractVersion = 2;
        f.action.effectContractVersion = 2;
        f.invocation.effectContractVersion = 2;
        f.invocation.requestBody.effectProfile = { id: "domain.read", contractVersion: 2 };
      }
      const capabilityFingerprint = await npDigestAgentCapabilityRegistryCanonical(
        definition,
        definition.capabilities,
      );
      f.action.capabilityDefinitionBody = definition;
      f.action.capabilityFingerprint = capabilityFingerprint;
      f.invocation.capabilityDefinitionBody = definition;
      f.invocation.contractFingerprint = capabilityFingerprint;
      f.invocation.requestBody.contractFingerprint = capabilityFingerprint;
      f.invocation.authorizationContextFingerprint =
        await npDigestAgentAuthorizationContextCanonical(f.invocation.authorizationContextBody);
      f.invocation.requestBody.authorizationContextFingerprint =
        f.invocation.authorizationContextFingerprint;
      f.invocation.requestHash = await npDigestAgentInvocationRequestCanonical(
        f.invocation.requestBody,
      );
      f.action.invocationFingerprint = f.invocation.requestHash;
      f.action.inputHash = await npAgentReleaseActionDigestV1(f.action);
      expect(await npVerifyAgentReleaseReadAttributionV1(f)).toBeNull();
    },
  );

  it.each(["action", "invocation"] as const)(
    "pins a noncanonical %s runtime idempotency key",
    async (owner) => {
      const f = await fixture();
      f[owner].idempotencyKey = `runtime:${id}:1:extra`;
      expect(await npVerifyAgentReleaseReadAttributionV1(f)).toBeNull();
    },
  );

  it("pins mismatched, active and mutation evidence", async () => {
    const f = await fixture();
    for (const action of [
      { ...f.action, inputHash: digest },
      { ...f.action, invocationId: actionId },
      { ...f.action, runFingerprint: null },
      { ...f.action, state: "running" },
      { ...f.action, finishedAt: null },
      { ...f.action, effectProfileId: "changeset.apply.direct" },
      { ...f.action, risk: "reversible" },
    ])
      expect(await npVerifyAgentReleaseReadAttributionV1({ ...f, action })).toBeNull();
    for (const invocation of [
      { ...f.invocation, requestHash: digest },
      { ...f.invocation, principalId: actionId },
      { ...f.invocation, siteId: "other-site" },
      { ...f.invocation, runId: id },
      { ...f.invocation, state: "started" },
      { ...f.invocation, completedAt: null },
      { ...f.invocation, transport: "agent-api" },
    ])
      expect(await npVerifyAgentReleaseReadAttributionV1({ ...f, invocation })).toBeNull();
  });

  it("requires both exact retained edges for released Activity attribution", async () => {
    const f = await fixture();
    const action = { ...f.action, runId: null, runSourceReleaseId: releaseId };
    const proof = await npVerifyAgentReleaseReadAttributionV1({ ...f, action });
    if (!proof) throw new Error("fixture proof");
    const edgeBase = { siteId, sourceReleaseId: releaseId, verifierVersion: 1, releasedAt };
    const edges = [
      {
        ...edgeBase,
        id,
        ownerKind: "read-action",
        ownerId: actionId,
        edgeCode: "action-run",
        ownerEvidenceDigest: proof.actionDigest,
      },
      {
        ...edgeBase,
        id: invocationId,
        ownerKind: "read-invocation",
        ownerId: invocationId,
        edgeCode: "invocation-authority-run",
        ownerEvidenceDigest: proof.invocationDigest,
      },
    ];
    rows = [[f.release], [f.invocation], edges];
    expect(await npResolveReleasedAgentActionPrincipalV1({ db, action })).toBe(principalId);
    for (const badEdges of [
      edges.slice(0, 1),
      edges.map((e) => ({ ...e, verifierVersion: 2 })),
      edges.map((e) => ({ ...e, ownerEvidenceDigest: digest })),
      edges.map((e) => ({ ...e, releasedAt: at })),
    ]) {
      rows = [[f.release], [f.invocation], badEdges];
      expect(await npResolveReleasedAgentActionPrincipalV1({ db, action })).toBeNull();
    }
    rows = [[{ ...f.release, evidenceDigest: digest }]];
    expect(await npResolveReleasedAgentActionPrincipalV1({ db, action })).toBeNull();
  });
});
