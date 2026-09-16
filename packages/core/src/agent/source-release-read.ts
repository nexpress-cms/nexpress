import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  type npAgentActions,
  npAgentInvocations,
  npAgentSourceReleases,
  npAgentSourceReleaseEdges,
} from "../db/schema/agent.js";
import {
  npRequireAgentSourceReleaseV1,
  npDigestAgentSourceReleaseV1,
  npDigestAgentRuntimeAdmissionKeyV1,
} from "../agent-contract/source-release-contract.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npDigestAgentActionCanonical } from "../agent-contract/canonical-action.js";
import { npDigestAgentAuthorizationContextCanonical } from "../agent-contract/canonical-authorization-context.js";
import { npDigestAgentInvocationRequestCanonical } from "../agent-contract/canonical-idempotency-request.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { NpAgentGatewayError } from "./admin-admission.js";

type Db = ReturnType<typeof getDb>;
type Action = typeof npAgentActions.$inferSelect;
type Invocation = typeof npAgentInvocations.$inferSelect;
type Release = typeof npAgentSourceReleases.$inferSelect;

export function npSourceReleaseOwnerDigestV1(value: unknown): string {
  return `cj1:sha256:${createHash("sha256")
    .update("np.agent-source-release-owner.v1\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
}

export async function npRequireAgentSourceReleaseRecordV1(row: Release) {
  const body = npRequireAgentSourceReleaseV1(row.evidenceBody);
  if (
    body.siteId !== row.siteId ||
    body.sourceId !== row.sourceId ||
    body.kind !== row.sourceKind ||
    body.releasedAt !== row.releasedAt.toISOString() ||
    (await npDigestAgentSourceReleaseV1(body)) !== row.evidenceDigest ||
    (body.kind === "runtime-run"
      ? row.principalId !== body.principalId || row.admissionKeyDigest !== body.admissionKeyDigest
      : row.principalId !== null || row.admissionKeyDigest !== null)
  )
    throw new NpAgentGatewayError("RUNTIME_RELEASE_INVALID", 409, "Agent history is unavailable.");
  return body;
}

/** A retained key only denies admission; it never grants a successful replay. */
export async function npIsAgentRuntimeAdmissionKeyConsumedV1(input: {
  db: Db;
  siteId: string;
  principalId: string;
  idempotencyKey: string;
}): Promise<boolean> {
  const digest = await npDigestAgentRuntimeAdmissionKeyV1({
    siteId: input.siteId,
    principalId: input.principalId,
    idempotencyKey: input.idempotencyKey,
  });
  const rows = await input.db
    .select({ id: npAgentSourceReleases.id })
    .from(npAgentSourceReleases)
    .where(
      and(
        eq(npAgentSourceReleases.siteId, input.siteId),
        eq(npAgentSourceReleases.sourceKind, "runtime-run"),
        eq(npAgentSourceReleases.principalId, input.principalId),
        eq(npAgentSourceReleases.admissionKeyDigest, digest),
      ),
    )
    .limit(1);
  return rows.length !== 0;
}

export async function npAgentReleaseActionDigestV1(row: Action): Promise<string> {
  return npDigestAgentActionCanonical({
    schemaVersion: "np.agent-action.v1",
    siteId: row.siteId,
    actionId: row.id,
    invocationFingerprint: row.invocationFingerprint,
    runFingerprint: row.runFingerprint,
    sequence: row.sequence,
    capabilityId: row.capabilityId,
    capabilityContractVersion: row.capabilityContractVersion,
    capabilityFingerprint: row.capabilityFingerprint,
    effectProfile: { id: row.effectProfileId, contractVersion: row.effectContractVersion },
    risk: row.risk,
    requiredScopes: row.requiredScopes,
    targetRefs: row.targetRefs,
    targetVersionFacts: row.targetVersionFacts,
    input: row.inputCanonical,
  });
}

/** Verify unchanged canonical attribution, independently of live/released locator state. */
export async function npVerifyAgentReleaseReadAttributionV1(input: {
  action: Action;
  invocation: Invocation;
  runId: string;
  runFingerprint: string;
  principalId: string;
  agentVersionId: string;
  deadlineAt: string;
}): Promise<{ actionDigest: string; invocationDigest: string } | null> {
  const { action: a, invocation: i } = input;
  try {
    const definition = a.capabilityDefinitionBody.capabilities;
    const capability = definition.find((c) => c.descriptor.id === a.capabilityId);
    const profile = capability?.effectProfiles.find(
      (candidate) => candidate.profileId === a.effectProfileId,
    );
    if (
      !capability ||
      !profile ||
      profile.profileId !== "domain.read" ||
      profile.effectContractVersion !== 1 ||
      profile.effectContractVersion !== a.effectContractVersion ||
      profile.kind !== "read" ||
      profile.reversibility !== "none" ||
      profile.capabilityId !== a.capabilityId ||
      profile.capabilityContractVersion !== a.capabilityContractVersion ||
      definition.length !== 1 ||
      a.siteId !== i.siteId ||
      a.invocationId !== i.id ||
      a.effectProfileId !== "domain.read" ||
      a.risk !== "read" ||
      !["succeeded", "failed", "policy_blocked"].includes(a.state) ||
      !a.finishedAt ||
      a.idempotencyKey !== `runtime:${input.runId}:${a.sequence.toString()}` ||
      i.idempotencyKey !== a.idempotencyKey ||
      !["completed", "failed"].includes(i.state) ||
      !i.completedAt ||
      i.transport !== "runtime" ||
      i.runId !== null ||
      i.operationKind !== "capability" ||
      i.actorKind !== "principal" ||
      i.authorizationContextBody.actor.kind !== "principal" ||
      i.authorizationContextBody.actor.principalId !== input.principalId ||
      i.actorFingerprint !== i.authorizationContextBody.actor.actorFingerprint ||
      i.requestBody.siteId !== i.siteId ||
      i.requestBody.actorKind !== i.actorKind ||
      i.requestBody.actorFingerprint !== i.actorFingerprint ||
      i.requestBody.operationKind !== i.operationKind ||
      i.requestBody.operationId !== i.operationId ||
      i.requestBody.contractVersion !== i.contractVersion ||
      i.requestBody.contractFingerprint !== i.contractFingerprint ||
      i.requestBody.effectProfile?.id !== i.effectProfileId ||
      i.requestBody.effectProfile?.contractVersion !== i.effectContractVersion ||
      i.contractVersion !== a.capabilityContractVersion ||
      i.contractFingerprint !== a.capabilityFingerprint ||
      i.effectProfileId !== a.effectProfileId ||
      i.effectContractVersion !== a.effectContractVersion ||
      capability.descriptor.id !== a.capabilityId ||
      capability.descriptor.contractVersion !== a.capabilityContractVersion ||
      capability.descriptor.risk !== a.risk ||
      (await npDigestAgentCapabilityRegistryCanonical(a.capabilityDefinitionBody, definition)) !==
        a.capabilityFingerprint ||
      i.operationId !== a.capabilityId ||
      i.principalId !== input.principalId ||
      a.runFingerprint !== input.runFingerprint ||
      a.invocationFingerprint !== i.requestHash ||
      i.authorizationContextBody.authorityRef.kind !== "runtime-run" ||
      i.authorizationContextBody.authorityRef.runId !== input.runId ||
      i.authorizationContextBody.authorityRef.principalId !== input.principalId ||
      i.authorizationContextBody.authorityRef.agentVersionId !== input.agentVersionId ||
      i.authorizationContextBody.authorityRef.deadlineAt !== input.deadlineAt ||
      i.authorizationContextBody.siteId !== a.siteId ||
      serializeAgentCanonicalJson(i.authorityRef) !==
        serializeAgentCanonicalJson(i.authorizationContextBody.authorityRef) ||
      (await npDigestAgentInvocationRequestCanonical(i.requestBody)) !== i.requestHash ||
      (await npDigestAgentAuthorizationContextCanonical(i.authorizationContextBody)) !==
        i.authorizationContextFingerprint ||
      i.requestBody.authorizationContextFingerprint !== i.authorizationContextFingerprint ||
      serializeAgentCanonicalJson(i.requestBody.input) !==
        serializeAgentCanonicalJson(a.inputCanonical) ||
      serializeAgentCanonicalJson(i.capabilityDefinitionBody) !==
        serializeAgentCanonicalJson(a.capabilityDefinitionBody) ||
      (await npAgentReleaseActionDigestV1(a)) !== a.inputHash
    )
      return null;
    return {
      actionDigest: npSourceReleaseOwnerDigestV1({
        siteId: a.siteId,
        id: a.id,
        inputHash: a.inputHash,
        invocationId: a.invocationId,
        invocationFingerprint: a.invocationFingerprint,
        runFingerprint: a.runFingerprint,
        idempotencyKey: a.idempotencyKey,
      }),
      invocationDigest: npSourceReleaseOwnerDigestV1({
        siteId: i.siteId,
        id: i.id,
        principalId: i.principalId,
        requestHash: i.requestHash,
        authorizationContextFingerprint: i.authorizationContextFingerprint,
        authorityRef: i.authorityRef,
        idempotencyKey: i.idempotencyKey,
      }),
    };
  } catch {
    return null;
  }
}

export async function npResolveReleasedAgentActionPrincipalV1(input: {
  db: Db;
  action: Action;
}): Promise<string | null> {
  const a = input.action;
  if (a.runId !== null || !a.runFingerprint || !a.runSourceReleaseId || !a.invocationId)
    return null;
  try {
    const [release] = await input.db
      .select()
      .from(npAgentSourceReleases)
      .where(
        and(
          eq(npAgentSourceReleases.siteId, a.siteId),
          eq(npAgentSourceReleases.id, a.runSourceReleaseId),
        ),
      )
      .limit(1);
    if (!release) return null;
    const body = await npRequireAgentSourceReleaseRecordV1(release);
    if (body.kind !== "runtime-run" || body.admissionFingerprint !== a.runFingerprint) return null;
    const [invocation] = await input.db
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, a.siteId), eq(npAgentInvocations.id, a.invocationId)),
      )
      .limit(1);
    if (!invocation) return null;
    const proof = await npVerifyAgentReleaseReadAttributionV1({
      action: a,
      invocation,
      runId: body.sourceId,
      runFingerprint: body.admissionFingerprint,
      principalId: body.principalId,
      agentVersionId: body.agentVersionId,
      deadlineAt: body.deadlineAt,
    });
    if (!proof) return null;
    const edges = await input.db
      .select()
      .from(npAgentSourceReleaseEdges)
      .where(
        and(
          eq(npAgentSourceReleaseEdges.siteId, a.siteId),
          eq(npAgentSourceReleaseEdges.sourceReleaseId, release.id),
          or(
            and(
              eq(npAgentSourceReleaseEdges.ownerKind, "read-action"),
              eq(npAgentSourceReleaseEdges.ownerId, a.id),
              eq(npAgentSourceReleaseEdges.edgeCode, "action-run"),
            ),
            and(
              eq(npAgentSourceReleaseEdges.ownerKind, "read-invocation"),
              eq(npAgentSourceReleaseEdges.ownerId, invocation.id),
              eq(npAgentSourceReleaseEdges.edgeCode, "invocation-authority-run"),
            ),
          ),
        ),
      )
      .limit(3);
    const matches = (kind: string, id: string, code: string, digest: string) =>
      edges.filter(
        (e) =>
          e.ownerKind === kind &&
          e.ownerId === id &&
          e.edgeCode === code &&
          e.ownerEvidenceDigest === digest &&
          e.verifierVersion === 1 &&
          e.releasedAt.getTime() === release.releasedAt.getTime(),
      ).length === 1;
    if (
      !matches("read-action", a.id, "action-run", proof.actionDigest) ||
      !matches("read-invocation", invocation.id, "invocation-authority-run", proof.invocationDigest)
    )
      return null;
    return body.principalId;
  } catch {
    return null;
  }
}
