import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentAuthorizationContextCanonical } from "../agent-contract/canonical-authorization-context.js";
import { npDigestAgentInvocationRequestCanonical } from "../agent-contract/canonical-idempotency-request.js";
import {
  npGetAgentAdminOperationV1,
  npResolveAgentAdminOperationFingerprintsV1,
} from "../agent-contract/admin-operation-registry.js";
import { npVerifyAgentReleaseStudioAttributionV1 } from "./studio-source-release.js";

type Input = Parameters<typeof npVerifyAgentReleaseStudioAttributionV1>[0];
const runId = "11111111-1111-4111-8111-111111111111";
const invocationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const agentId = "44444444-4444-4444-8444-444444444444";
const triggerId = "55555555-5555-4555-8555-555555555555";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const at = new Date("2026-01-01T00:00:00.000Z");
const siteId = "studio-release-test";
function hash(domain: string, value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}
async function fixture(): Promise<Input> {
  const operation = npGetAgentAdminOperationV1("agents.configurations.run");
  const { contract } = await npResolveAgentAdminOperationFingerprintsV1(operation);
  const actorFingerprint = hash("np.agent-staff-actor.v1", { siteId, userId });
  const authorizationContextBody: Input["invocation"]["authorizationContextBody"] = {
    schemaVersion: "np.agent-authorization-context.v1",
    siteId,
    actor: { kind: "staff", userId, actorFingerprint },
    transport: "admin",
    gatewayExposure: null,
    authorityRef: {
      kind: "staff-session",
      userId,
      sessionId: userId,
      userTokenVersion: 1,
      siteAuthorizationDigest: digest,
    },
  };
  const authorizationContextFingerprint =
    await npDigestAgentAuthorizationContextCanonical(authorizationContextBody);
  const requestBody: Input["invocation"]["requestBody"] = {
    schemaVersion: "np.agent-idempotency-request.v1",
    siteId,
    actorKind: "staff",
    actorFingerprint,
    authorizationContextFingerprint,
    operationKind: "admin",
    operationId: operation.id,
    contractVersion: operation.contractVersion,
    contractFingerprint: contract,
    effectProfile: null,
    input: {
      idempotencyKey: "studio-key",
      expectedVersion: 1,
      configHash: digest,
      triggerId,
      parentTargetId: null,
      targetId: agentId,
      manualInputRequestDigest: digest,
    },
  };
  const requestHash = await npDigestAgentInvocationRequestCanonical(requestBody);
  const outputRedacted = { id: runId, runId, state: "queued" };
  const invocation: Input["invocation"] = {
    id: invocationId,
    siteId,
    actorKind: "staff",
    principalId: null,
    staffUserId: userId,
    actorFingerprint,
    authorizationContextBody,
    authorizationContextFingerprint,
    authorityRef: { ...authorizationContextBody.authorityRef },
    actorDeletedAt: null,
    operationKind: "admin",
    operationId: operation.id,
    contractVersion: operation.contractVersion,
    contractFingerprint: contract,
    capabilityDefinitionBody: null,
    effectProfileId: null,
    effectContractVersion: null,
    transport: "admin",
    mcpExecutionMode: null,
    mcpRequestedTaskTtlMs: null,
    idempotencyKey: "studio-key",
    requestBody,
    requestHash,
    state: "completed",
    runId: null,
    resultKind: "admin_resource",
    resultId: runId,
    outputRedacted,
    outputHash: hash("np.agent-admin-output.v1", outputRedacted),
    oneTimeValueIssued: false,
    oneTimeResourceId: null,
    oneTimeRecoveryOperationId: null,
    auditEventId: invocationId,
    errorCode: null,
    requestedAt: at,
    completedAt: at,
    expiresAt: new Date("2026-01-02T00:00:00.000Z"),
  };
  const audit: Input["audit"] = {
    id: invocationId,
    siteId,
    actorKind: "staff",
    actorUserId: userId,
    actorMemberId: null,
    action: operation.audit.eventId,
    targetType: "agent-runtime",
    targetId: runId,
    payload: {
      operationId: operation.id,
      outcome: "completed",
      siteId,
      staffUserId: userId,
      idempotencyFingerprint: requestHash,
    },
    createdAt: at,
  };
  // The caller owns full Run integrity. This fixture provides precisely the
  // linked fields consumed by this verifier, independently of DB/bootstrap.
  const run: Input["run"] = {
    id: runId,
    siteId,
    origin: "runtime",
    agentId,
    triggerId,
    idempotencyKey: invocationId,
    state: "succeeded",
    finishedAt: new Date("2026-01-01T00:05:00.000Z"),
    queuedAt: at,
    agentConfigHash: digest,
    manualInput: { title: "private" },
    manualInputDigest: digest,
    recipeId: "content-assistant",
    goal: "Help with content",
  };
  return { run, invocation, audit, releasedAt: new Date("2026-09-01T00:00:00.000Z") };
}

describe("Studio source release attribution", () => {
  it("attests an expired linked structured admission without copying source input", async () => {
    const input = await fixture();
    const proof = await npVerifyAgentReleaseStudioAttributionV1(input);
    expect(proof).toEqual({
      auditDigest: expect.stringMatching(/^cj1:sha256:/u),
      invocationDigest: expect.stringMatching(/^cj1:sha256:/u),
    });
    expect(JSON.stringify(proof)).not.toContain("private");
  });
  it("ignores nullable staff FK metadata while binding the durable identity", async () => {
    const input = await fixture();
    const proof = await npVerifyAgentReleaseStudioAttributionV1(input);
    input.invocation.staffUserId = null;
    input.invocation.actorDeletedAt = new Date("2026-02-01T00:00:00.000Z");
    input.audit.actorUserId = null;
    expect(await npVerifyAgentReleaseStudioAttributionV1(input)).toEqual(proof);
  });
  it.each<[string, (input: Input) => void]>([
    [
      "unexpired replay",
      (x) => {
        x.invocation.expiresAt = new Date("2027-01-01T00:00:00.000Z");
      },
    ],
    [
      "wrong Run key",
      (x) => {
        x.run.idempotencyKey = userId;
      },
    ],
    [
      "cross-site audit",
      (x) => {
        x.audit.siteId = "other";
      },
    ],
    [
      "wrong audit link",
      (x) => {
        x.invocation.auditEventId = userId;
      },
    ],
    [
      "wrong audit fingerprint",
      (x) => {
        x.audit.payload.idempotencyFingerprint = digest;
      },
    ],
    [
      "unknown audit payload",
      (x) => {
        x.audit.payload.extra = runId;
      },
    ],
    [
      "wrong request hash",
      (x) => {
        x.invocation.requestHash = digest;
      },
    ],
    [
      "wrong authorization fingerprint",
      (x) => {
        x.invocation.authorizationContextFingerprint = digest;
      },
    ],
    [
      "wrong contract fingerprint",
      (x) => {
        x.invocation.contractFingerprint = digest;
      },
    ],
    [
      "wrong output hash",
      (x) => {
        x.invocation.outputHash = digest;
      },
    ],
    [
      "wrong staff",
      (x) => {
        x.invocation.staffUserId = agentId;
      },
    ],
    [
      "unfinished invocation",
      (x) => {
        x.invocation.state = "started";
      },
    ],
    [
      "one-time result",
      (x) => {
        x.invocation.oneTimeValueIssued = true;
      },
    ],
    [
      "invalid dates",
      (x) => {
        x.invocation.expiresAt = new Date("invalid");
      },
    ],
    [
      "active Run",
      (x) => {
        x.run.state = "running";
      },
    ],
  ])("rejects %s", async (_name, change) => {
    const input = await fixture();
    change(input);
    expect(await npVerifyAgentReleaseStudioAttributionV1(input)).toBeNull();
  });
  it.each(["targetId", "triggerId", "configHash", "idempotencyKey", "parentTargetId"])(
    "rejects a rehashed mismatched %s",
    async (key) => {
      const input = await fixture();
      input.invocation.requestBody.input[key] = userId;
      input.invocation.requestHash = await npDigestAgentInvocationRequestCanonical(
        input.invocation.requestBody,
      );
      input.audit.payload.idempotencyFingerprint = input.invocation.requestHash;
      expect(await npVerifyAgentReleaseStudioAttributionV1(input)).toBeNull();
    },
  );
  it("accepts exact legacy input and rejects a rehashed different recipe", async () => {
    const input = await fixture();
    input.run.manualInput = null;
    input.run.manualInputDigest = null;
    const p = input.invocation.requestBody.input;
    delete p.manualInputRequestDigest;
    p.inputJson = JSON.stringify({ recipeId: input.run.recipeId, goal: input.run.goal });
    input.invocation.requestHash = await npDigestAgentInvocationRequestCanonical(
      input.invocation.requestBody,
    );
    input.audit.payload.idempotencyFingerprint = input.invocation.requestHash;
    expect(await npVerifyAgentReleaseStudioAttributionV1(input)).not.toBeNull();
    p.inputJson = JSON.stringify({ recipeId: "other", goal: input.run.goal });
    input.invocation.requestHash = await npDigestAgentInvocationRequestCanonical(
      input.invocation.requestBody,
    );
    input.audit.payload.idempotencyFingerprint = input.invocation.requestHash;
    expect(await npVerifyAgentReleaseStudioAttributionV1(input)).toBeNull();
  });
});
