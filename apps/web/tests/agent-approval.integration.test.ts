/* eslint-disable import-x/no-relative-packages */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { grantSiteMembership, npSessions, npUsers, npAuditEvents } from "@nexpress/core";
import {
  npAgentApprovals,
  npAgentChangesets,
  npAgentInvocations,
  npAgentChangesetOperations,
  npAgentPrincipals,
  npAgentServiceTokens,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  createAgentChangeSetServiceV1,
  type NpAgentChangeSetServiceOptionsV1,
} from "../../../packages/core/src/agent/changeset-service.js";
import type {
  NpAgentCapabilityRegistryCanonicalV1,
  NpAgentCapabilityDescriptor,
} from "../../../packages/core/src/agent-contract/types.js";
import type {
  NpAgentApprovalDetailV1,
  NpAgentApprovalChallengeOutputV1,
} from "../../../packages/core/src/agent-contract/approval-contract.js";
import {
  fixture,
  previewConfiguration,
  principalFixture,
  previewStorageFixture,
  readyPreview,
  siteId,
} from "./agent-changeset-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
  seedUser,
} from "./harness.js";
import { postsTable } from "../src/db/generated/collections.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const integrityKey = {
  owner: "approval-integrity" as const,
  id: "approval-a",
  bytes: new Uint8Array(32).fill(71),
};
function binding(operation: "apply" | "schedule"): NpAgentCapabilityRegistryCanonicalV1 {
  const descriptor: NpAgentCapabilityDescriptor = {
    schemaVersion: "np.agent-capability.v1",
    id: `changeset.${operation}`,
    contractVersion: 1,
    source: "core",
    title: "Reviewed execution",
    description: "Fixture execution binding; no executor installed.",
    requiredScopes: ["changeset:apply"],
    scopeDerivation: "changeset-resources",
    risk: "sensitive",
    approval: "human",
    effectProfiles: [
      {
        id: `changeset.${operation}`,
        kind: "mutation",
        reversibility: "compensatable",
        minimumGatewayExposure: "approved-execute",
        verifierId: "changeset.verify",
        compensatorId: "changeset.rollback",
      },
    ],
    bootstrapIntent: "write",
    execution: "durable",
    idempotency: "required",
    gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    outputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  };
  return {
    schemaVersion: "np.agent-capability-registry.v1",
    projection: "definition",
    capabilities: [
      {
        descriptor,
        implementationVersion: 1,
        effectProfiles: descriptor.effectProfiles.map((profile) => ({
          schemaVersion: "np.agent-effect-profile.v1",
          capabilityId: descriptor.id,
          capabilityContractVersion: 1,
          implementationVersion: 1,
          profileId: profile.id,
          kind: profile.kind,
          reversibility: profile.reversibility,
          minimumGatewayExposure: profile.minimumGatewayExposure,
          effectContractVersion: 1,
          verifierId: profile.verifierId,
          compensatorId: profile.compensatorId,
        })),
      },
    ],
  };
}
async function approvalFixture(
  principalRequester = false,
  brokenReport = false,
  key = integrityKey,
) {
  let time = new Date();
  let fact: boolean | { reauthenticatedAt: string; sessionFactFingerprint: string } = {
    reauthenticatedAt: time.toISOString(),
    sessionFactFingerprint: digest,
  };
  const { adapter, objects } = previewStorageFixture();
  const configuration = previewConfiguration();
  const options: NpAgentChangeSetServiceOptionsV1 = {
    cursorKey: new Uint8Array(32).fill(44),
    now: () => time,
    secretRequestDigestKey: { id: "approval-request", key: new Uint8Array(32).fill(72) },
    reauthentication: { verify: () => fact },
    approvals: {
      integrityKeys: { active: key },
      challengeKeys: { active: { id: "approval-challenge", key: new Uint8Array(32).fill(73) } },
      lifetimeSeconds: 600,
      resolveExecutionBinding: async ({ intendedOperation }) => binding(intendedOperation),
    },
    preview: {
      ...configuration,
      storageAdapter: adapter,
      resolveAdapter: () => adapter,
      checks: {
        rendererId: configuration.contract.rendererId,
        rendererVersion: configuration.contract.rendererVersion,
        rendererFingerprint: configuration.contract.rendererFingerprint,
        productionOrigins: ["https://site.example"],
        resolveManifest: async () => [{ route: "/", locale: null, audience: "public" }],
        render: async () =>
          brokenReport
            ? '<html><head><title>Review</title></head><body><img src="/image.png"></body></html>'
            : '<html lang="en"><head><title>Review</title><meta name="description" content="Review"></head><body><main>Preview</main></body></html>',
      },
    },
  };
  const f = await fixture(options);
  const principal = principalRequester
    ? await principalFixture(f, false, options, ["changeset:apply", "content:publish"])
    : null;
  const service = principal?.service ?? f.service;
  await readyPreview({ service, actor: principal?.actor ?? f.actor });
  const [change] = await f.db.select().from(npAgentChangesets);
  if (!change?.planHash || !service.approvals) throw new Error("Approval fixture not ready");
  const request = {
    schemaVersion: "np.agent-changeset-request-approval-input.v1",
    expectedDraftVersion: 1,
    planHash: change.planHash,
    intendedOperation: "apply",
    scheduledFor: null,
    idempotencyKey: randomUUID(),
  };
  const detail = await service.requestApproval({
    actor: f.actor,
    id: change.id,
    command: request,
  });
  return {
    ...f,
    service,
    principal,
    objects,
    options,
    approvals: service.approvals,
    change,
    request,
    detail,
    advance: (seconds: number) => {
      time = new Date(time.getTime() + seconds * 1000);
    },
    freshFact: () => {
      fact = { reauthenticatedAt: time.toISOString(), sessionFactFingerprint: digest };
    },
    setFact: (value: typeof fact) => {
      fact = value;
    },
  };
}
type F = Awaited<ReturnType<typeof approvalFixture>>;
function identity(f: F, detail = f.detail) {
  return { siteId, actor: f.actor.actor, id: detail.item.approval.id };
}
function challengeCommand(
  detail: NpAgentApprovalDetailV1,
  purpose: "approve" | "reject" | "revoke" = "approve",
) {
  return {
    schemaVersion: "np.agent-approval-challenge-request.v1",
    purpose,
    expectedApprovalVersion: detail.item.version,
    statementHash: detail.item.statementHash,
    idempotencyKey: randomUUID(),
  };
}
function decisionCommand(
  detail: NpAgentApprovalDetailV1,
  challenge: NpAgentApprovalChallengeOutputV1,
) {
  return {
    schemaVersion: "np.agent-approval-decision-input.v1",
    expectedApprovalVersion: challenge.approvalVersion,
    statementHash: detail.item.statementHash,
    challengeGeneration: challenge.challengeGeneration,
    challenge: challenge.challenge,
    idempotencyKey: randomUUID(),
    reason: "Reviewed",
  };
}
async function decide(f: F, decision: "approve" | "reject" | "revoke", detail = f.detail) {
  const challenge = await f.approvals.issueChallenge({
    ...identity(f, detail),
    command: challengeCommand(detail, decision),
  });
  const command = decisionCommand(detail, challenge);
  return {
    detail: await f.approvals.decide({ ...identity(f, detail), decision, command }),
    challenge,
    command,
  };
}
describe.skipIf(skipIfNoTestDb())("Approval service lifecycle", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("requests, approves, revokes and requests a fresh generation without content execution", async () => {
    const f = await approvalFixture();
    expect(f.detail.item.approval.state).toBe("pending");
    const replay = await f.service.requestApproval({
      actor: f.actor,
      id: f.change.id,
      command: f.request,
    });
    expect(replay.item.approval.id).toBe(f.detail.item.approval.id);
    const approved = await decide(f, "approve");
    expect(approved.detail.item.approval.state).toBe("approved");
    expect(
      (
        await f.approvals.decide({
          ...identity(f, approved.detail),
          decision: "approve",
          command: approved.command,
        })
      ).item.approval.state,
    ).toBe("approved");
    const revoked = await decide(f, "revoke", approved.detail);
    expect(revoked.detail.item.approval.state).toBe("revoked");
    expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe("ready");
    const next = await f.service.requestApproval({
      actor: f.actor,
      id: f.change.id,
      command: { ...f.request, idempotencyKey: randomUUID() },
    });
    expect(next.item.approval.generation).toBe(2);
    expect(await f.db.select().from(postsTable)).toEqual([]);
    expect(next.item.approval.id).not.toBe(f.detail.item.approval.id);
    const page = await f.approvals.list({
      siteId,
      actor: f.actor.actor,
      query: { state: null, limit: 1 },
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const nextPage = await f.approvals.list({
      siteId,
      actor: f.actor.actor,
      query: { state: null, limit: 1, cursor: page.nextCursor },
    });
    expect(nextPage.items).toHaveLength(1);
    expect(nextPage.items[0]?.approval.id).not.toBe(page.items[0]?.approval.id);
    await expect(
      f.approvals.list({
        siteId,
        actor: f.actor.actor,
        query: { state: "pending", limit: 1, cursor: page.nextCursor },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_CURSOR_INVALID" });

    const journals = JSON.stringify({
      invocations: await f.db.select().from(npAgentInvocations),
      audit: await f.db.select().from(npAuditEvents),
    });
    expect(journals).not.toContain(approved.challenge.challenge);
    expect(journals).not.toContain(revoked.challenge.challenge);
    expect(JSON.stringify(approved.detail)).not.toMatch(
      /statementMac|decisionMac|integrityKeyId|statementBody|sealedPlanBody|challengeHash/,
    );
  });
  it("keeps a bound preview renderable and readable through pending and approved review", async () => {
    const f = await approvalFixture();
    const previewId = f.detail.review?.changeSet.preview?.previewId;
    if (!previewId) throw new Error("Missing bound preview");
    const initial = await f.service.getPreview({ actor: f.actor, previewId });
    const artifactId = initial.artifactRefs[0]?.artifactId;
    if (!artifactId) throw new Error("Missing review report");
    const artifactInput = { actor: f.actor, previewId, artifactId };
    const initialArtifact = await f.service.readPreviewArtifact(artifactInput);
    for (const state of ["approval_pending", "approved"] as const) {
      if (state === "approved") await decide(f, "approve");
      expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe(state);
      expect(await f.service.reconcilePreviews({ siteId, limit: 1 })).toMatchObject({
        examined: 1,
        completed: 0,
      });
      const retained = await f.service.getPreview({ actor: f.actor, previewId });
      expect(retained).toMatchObject({
        state: "ready",
        previewId,
        digest: initial.digest,
        expiresAt: initial.expiresAt,
      });
      expect(
        await f.service.renderPreview({
          siteId,
          previewId,
          viewer: { userId: f.actor.actor.user.id, sessionId: f.actor.actor.sessionId },
          route: { route: "/", locale: null, audience: "public" },
          render: async (context) => {
            expect(context.plan.changeSetId).toBe(f.change.id);
            expect(context.snapshots[0]?.presence).toBe("absent");
            return `review-${state}`;
          },
        }),
      ).toBe(`review-${state}`);
      const artifact = await f.service.readPreviewArtifact(artifactInput);
      expect(artifact.contentDigest).toBe(initialArtifact.contentDigest);
      expect(artifact.bytes).toEqual(initialArtifact.bytes);
      await expect(
        f.service.preview({
          actor: f.actor,
          id: f.change.id,
          command: {
            idempotencyKey: randomUUID(),
            expectedVersion: 1,
            expectedPlanHash: f.change.planHash,
          },
        }),
      ).rejects.toThrow();
    }
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
  it("clears consumed intent and preserves immutable approval after deleting a distinct approver", async () => {
    const f = await approvalFixture();
    const seeded = await seedUser({ role: "admin" });
    await grantSiteMembership(siteId, seeded.userId, "admin");
    const [user] = await f.db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, seeded.userId));
    if (!user || !session) throw new Error("Missing distinct approver");
    const input = { ...identity(f), actor: { user, sessionId: session.id } };
    const challenge = await f.approvals.issueChallenge({
      ...input,
      command: challengeCommand(f.detail),
    });
    await f.approvals.decide({
      ...input,
      decision: "approve",
      command: decisionCommand(f.detail, challenge),
    });
    const [approved] = await f.db.select().from(npAgentApprovals);
    if (!approved) throw new Error("Missing approved row");
    expect(approved).toMatchObject({
      state: "approved",
      decidedByUserId: user.id,
      challengeGeneration: 1,
      challengePurpose: null,
      challengeHash: null,
      challengeHashKeyId: null,
      challengeIssuedToUserId: null,
      challengeSessionFingerprint: null,
      challengeExpiresAt: null,
    });
    expect(approved.challengeConsumedAt).not.toBeNull();
    const immutable = {
      body: approved.decisionBody,
      hash: approved.decisionHash,
      mac: approved.decisionMac,
    };
    const gateway = createAgentGatewayServiceV1({
      tokenHashKeyring: { active: { id: "approval-delete", key: new Uint8Array(32).fill(77) } },
      environment: "production",
    });
    await gateway.containUserAuthorityLoss(user.id);
    // Audit identity is an independent nullable FK; preserve its event and payload while removing the fixture user.
    await f.db
      .update(npAuditEvents)
      .set({ actorUserId: null })
      .where(eq(npAuditEvents.actorUserId, user.id));
    await f.db.delete(npUsers).where(eq(npUsers.id, user.id));
    expect(await f.db.select().from(npUsers).where(eq(npUsers.id, user.id))).toEqual([]);
    const [retained] = await f.db.select().from(npAgentApprovals);
    if (!retained) throw new Error("Missing retained approval");
    expect(retained.decidedByUserId).toBeNull();
    expect({
      body: retained.decisionBody,
      hash: retained.decisionHash,
      mac: retained.decisionMac,
    }).toEqual(immutable);
    await expect(f.approvals.verify(retained)).resolves.toBeDefined();
    expect((await f.approvals.get(identity(f))).item.approval.state).toBe("approved");
  });
  it("binds schedule intent and its canonical time without scheduling execution", async () => {
    const f = await approvalFixture();
    const scheduledFor = new Date(Date.now() + 300_000).toISOString();
    const scheduleRequest = {
      ...f.request,
      intendedOperation: "schedule",
      scheduledFor,
      idempotencyKey: randomUUID(),
    };
    await expect(
      f.service.requestApproval({ actor: f.actor, id: f.change.id, command: scheduleRequest }),
    ).rejects.toThrow();
    await decide(f, "revoke");
    const scheduled = await f.service.requestApproval({
      actor: f.actor,
      id: f.change.id,
      command: { ...scheduleRequest, idempotencyKey: randomUUID() },
    });
    expect(scheduled.item).toMatchObject({ intendedOperation: "schedule", scheduledFor });
    expect(scheduled.item.statementHash).not.toBe(f.detail.item.statementHash);
    const approved = await decide(f, "approve", scheduled);
    expect(approved.detail.item.approval.state).toBe("approved");
    expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe("approved");
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
  it("rejects sensitive approvals without a recent fact and makes the parent rejected", async () => {
    const f = await approvalFixture();
    f.setFact(false);
    const rejected = await decide(f, "reject");
    expect(rejected.detail.item.approval.state).toBe("rejected");
    const [row] = await f.db.select().from(npAgentApprovals);
    expect(row?.decisionBody?.reauthentication).toEqual({ mode: "none" });
    expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe("rejected");
  });
  it("requires actual recent facts both when issuing and consuming approval intent", async () => {
    const f = await approvalFixture();
    f.setFact(true);
    await expect(
      f.approvals.issueChallenge({ ...identity(f), command: challengeCommand(f.detail) }),
    ).rejects.toMatchObject({ code: "RECENT_REAUTHENTICATION_REQUIRED" });
    f.setFact({
      reauthenticatedAt: new Date(Date.now() - 600_000).toISOString(),
      sessionFactFingerprint: digest,
    });
    await expect(
      f.approvals.issueChallenge({ ...identity(f), command: challengeCommand(f.detail) }),
    ).rejects.toMatchObject({ code: "RECENT_REAUTHENTICATION_REQUIRED" });
    f.freshFact();
    const challenge = await f.approvals.issueChallenge({
      ...identity(f),
      command: challengeCommand(f.detail),
    });
    f.setFact(false);
    await expect(
      f.approvals.decide({
        ...identity(f),
        decision: "approve",
        command: decisionCommand(f.detail, challenge),
      }),
    ).rejects.toMatchObject({ code: "RECENT_REAUTHENTICATION_REQUIRED" });
  });
  it("binds intent to purpose, version, generation and one-time consumption", async () => {
    const f = await approvalFixture();
    const issuance = challengeCommand(f.detail, "reject");
    const challenge = await f.approvals.issueChallenge({ ...identity(f), command: issuance });
    await expect(
      f.approvals.issueChallenge({ ...identity(f), command: issuance }),
    ).rejects.toMatchObject({ code: "ONE_TIME_VALUE_ALREADY_ISSUED" });
    const command = decisionCommand(f.detail, challenge);
    const [originalSession] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.id, f.actor.actor.sessionId));
    if (!originalSession) throw new Error("Missing session");
    const otherSessionId = randomUUID();
    await f.db.insert(npSessions).values({
      ...originalSession,
      id: otherSessionId,
      accessTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      refreshTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    });
    await expect(
      f.approvals.decide({
        ...identity(f),
        actor: { ...f.actor.actor, sessionId: otherSessionId },
        decision: "reject",
        command,
      }),
    ).rejects.toThrow();
    for (const patch of [
      { expectedApprovalVersion: 999 },
      { challengeGeneration: 999 },
      { challenge: "B".repeat(43) },
      { statementHash: `cj1:sha256:${"B".repeat(43)}` },
    ]) {
      await expect(
        f.approvals.decide({
          ...identity(f),
          decision: "reject",
          command: { ...command, ...patch, idempotencyKey: randomUUID() },
        }),
      ).rejects.toThrow();
    }
    await expect(
      f.approvals.decide({ ...identity(f), decision: "approve", command }),
    ).rejects.toThrow();
    await f.approvals.decide({ ...identity(f), decision: "reject", command });
    await expect(
      f.approvals.decide({
        ...identity(f),
        decision: "reject",
        command: { ...command, idempotencyKey: randomUUID() },
      }),
    ).rejects.toThrow();
  });
  it("hides wrong-site or unauthorized rows and fences stale staff sessions", async () => {
    const f = await approvalFixture();
    await expect(f.approvals.get({ ...identity(f), siteId: "draft-other" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.approvals.get({ ...identity(f), id: randomUUID() })).rejects.toMatchObject({
      code: "APPROVAL_NOT_FOUND",
      status: 404,
    });
    const seeded = await seedUser({ role: "editor" });
    await grantSiteMembership(siteId, seeded.userId, "viewer");
    const [user] = await f.db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, seeded.userId));
    if (!user || !session) throw new Error("Missing actor");
    await expect(
      f.approvals.get({ ...identity(f), actor: { user, sessionId: session.id } }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await f.approvals.list({ siteId, actor: { user, sessionId: session.id } })).items,
    ).toEqual([]);
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
    await expect(
      f.approvals.issueChallenge({ ...identity(f), command: challengeCommand(f.detail) }),
    ).rejects.toThrow();
  });
  it("expires bounded pending authority and permits a new immutable generation", async () => {
    const f = await approvalFixture();
    await f.approvals.issueChallenge({ ...identity(f), command: challengeCommand(f.detail) });
    f.advance(601);
    await expect(
      f.approvals.issueChallenge({ ...identity(f), command: challengeCommand(f.detail) }),
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    expect(await f.approvals.reconcileExpired({ siteId, limit: 1 })).toEqual({
      examined: 1,
      expired: 1,
    });
    expect((await f.db.select().from(npAgentApprovals))[0]).toMatchObject({
      state: "expired",
      challengeGeneration: 1,
      challengePurpose: null,
      challengeHash: null,
      challengeHashKeyId: null,
      challengeIssuedToUserId: null,
      challengeSessionFingerprint: null,
      challengeExpiresAt: null,
    });
    expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe("ready");
    const next = await f.service.requestApproval({
      actor: f.actor,
      id: f.change.id,
      command: { ...f.request, idempotencyKey: randomUUID() },
    });
    expect(next.item.approval.generation).toBe(2);
    const canonicalFields = {
      id: npAgentApprovals.id,
      statementBody: npAgentApprovals.statementBody,
      statementHash: npAgentApprovals.statementHash,
      statementMac: npAgentApprovals.statementMac,
      decisionBody: npAgentApprovals.decisionBody,
      decisionHash: npAgentApprovals.decisionHash,
      decisionMac: npAgentApprovals.decisionMac,
      revocationBody: npAgentApprovals.revocationBody,
      revocationHash: npAgentApprovals.revocationHash,
      revocationMac: npAgentApprovals.revocationMac,
    };
    const history = await f.db
      .select(canonicalFields)
      .from(npAgentApprovals)
      .orderBy(npAgentApprovals.id);
    f.advance(Math.ceil((f.change.expiresAt.getTime() - f.change.createdAt.getTime()) / 1000) + 1);
    expect(await f.approvals.reconcileExpired({ siteId, limit: 1 })).toEqual({
      examined: 1,
      expired: 1,
    });
    expect(await f.service.reconcileExpired({ siteId, limit: 1 })).toEqual({
      examined: 1,
      cancelled: 1,
    });
    expect((await f.db.select().from(npAgentChangesets))[0]).toMatchObject({
      state: "cancelled",
      cancellationCode: "CHANGESET_EXPIRED",
    });
    expect(
      await f.db.select(canonicalFields).from(npAgentApprovals).orderBy(npAgentApprovals.id),
    ).toEqual(history);
    for (const retained of await f.db.select().from(npAgentApprovals)) {
      expect(retained.state).toBe("expired");
      await expect(f.approvals.verify(retained)).resolves.toBeDefined();
    }
  });
  it("fences changed live resource bases before an approval can authorize them", async () => {
    const f = await approvalFixture();
    const challenge = await f.approvals.issueChallenge({
      ...identity(f),
      command: challengeCommand(f.detail),
    });
    const [operation] = await f.db.select().from(npAgentChangesetOperations);
    if (!operation || operation.resourceKey.kind !== "document")
      throw new Error("Expected document");
    await f.db.insert(postsTable).values({
      id: operation.resourceKey.documentId,
      siteId,
      slug: "independent-write",
      title: "Independent content",
      content: npCreateEmptyRichTextContent(),
    });
    await expect(
      f.approvals.decide({
        ...identity(f),
        decision: "approve",
        command: decisionCommand(f.detail, challenge),
      }),
    ).rejects.toMatchObject({ code: "CHANGESET_CONFLICT", status: 409 });
    const [approval] = await f.db.select().from(npAgentApprovals);
    expect(approval?.state).toBe("pending");
    expect(approval?.challengeConsumedAt).toBeNull();
    expect(await f.approvals.reconcile({ siteId, limit: 1 })).toMatchObject({
      examined: 1,
      revoked: 1,
      incidents: 0,
    });
    const [revoked] = await f.db.select().from(npAgentApprovals);
    expect(revoked).toMatchObject({
      state: "revoked",
      revocationKind: "target_invalidated",
      revocationCode: "APPROVAL_TARGET_INVALIDATED",
    });
    expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe("ready");
    expect((await f.db.select().from(postsTable))[0]?.title).toBe("Independent content");
  });
  it("reconciles current requester authority loss and explicit key retirement without executing content", async () => {
    const f = await approvalFixture();
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
    expect(await f.approvals.reconcile({ siteId, limit: 1 })).toMatchObject({
      examined: 1,
      revoked: 1,
      incidents: 0,
    });
    const [row] = await f.db.select().from(npAgentApprovals);
    expect(row).toMatchObject({ state: "revoked", revocationKind: "authority_loss" });
    expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe("ready");
  });
  it("retires an old integrity key with explicit host maintenance and current-key evidence", async () => {
    const f = await approvalFixture();
    const rotated = createAgentChangeSetServiceV1({
      ...f.options,
      approvals: {
        ...f.options.approvals!,
        integrityKeys: {
          active: { ...integrityKey, id: "approval-b", bytes: new Uint8Array(32).fill(74) },
          previous: [integrityKey],
        },
      },
    });
    expect(
      await rotated.approvals!.reconcile({
        siteId,
        limit: 1,
        retireIntegrityKeyId: integrityKey.id,
      }),
    ).toMatchObject({ examined: 1, revoked: 1, incidents: 0 });
    const [row] = await f.db.select().from(npAgentApprovals);
    expect(row).toMatchObject({
      state: "revoked",
      revocationKind: "integrity_key_retired",
      revocationIntegrityKeyId: "approval-b",
    });
    expect((await rotated.approvals!.get(identity(f))).item.approval.state).toBe("revoked");
  });
  it("requires successful report evidence and retains the artifact availability fence", async () => {
    await expect(approvalFixture(false, true)).rejects.toMatchObject({ code: "PREVIEW_REQUIRED" });
  });
  it("does not approve a preview whose verified private artifact disappeared", async () => {
    const f = await approvalFixture();
    const challenge = await f.approvals.issueChallenge({
      ...identity(f),
      command: challengeCommand(f.detail),
    });
    f.objects.clear();
    await expect(
      f.approvals.decide({
        ...identity(f),
        decision: "approve",
        command: decisionCommand(f.detail, challenge),
      }),
    ).rejects.toThrow();
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("pending");
  });
  it.each(["token-version", "revocation", "audience", "scope"] as const)(
    "rechecks principal requester %s after issuing approval intent",
    async (mode) => {
      const f = await approvalFixture(true);
      if (!f.principal) throw new Error("Expected principal requester");
      expect(f.detail.item.requester.kind).toBe("principal");
      const challenge = await f.approvals.issueChallenge({
        ...identity(f),
        command: challengeCommand(f.detail),
      });
      if (mode === "token-version") await f.db.update(npAgentPrincipals).set({ tokenVersion: 2 });
      if (mode === "revocation")
        await f.db.update(npAgentServiceTokens).set({ status: "revoked", revokedAt: new Date() });
      if (mode === "audience")
        await f.db
          .update(npAgentServiceTokens)
          .set({ audience: "urn:nexpress:agent-gateway:other" });
      if (mode === "scope")
        await f.db.update(npAgentServiceTokens).set({ scopes: ["changeset:read", "site:read"] });
      await expect(
        f.approvals.decide({
          ...identity(f),
          decision: "approve",
          command: decisionCommand(f.detail, challenge),
        }),
      ).rejects.toThrow();
      const [row] = await f.db.select().from(npAgentApprovals);
      expect(row?.state).toBe("pending");
      expect(row?.challengeConsumedAt).toBeNull();
      expect(await f.db.select().from(postsTable)).toEqual([]);
    },
  );
  it("arbitrates concurrent decisions through the same version and one-time intent", async () => {
    const f = await approvalFixture();
    const challenge = await f.approvals.issueChallenge({
      ...identity(f),
      command: challengeCommand(f.detail),
    });
    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        f.approvals.decide({
          ...identity(f),
          decision: "approve",
          command: decisionCommand(f.detail, challenge),
        }),
      ),
    );
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [row] = await f.db.select().from(npAgentApprovals);
    expect(row?.state).toBe("approved");
    expect(row?.version).toBe(3);
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
  it("does not turn tampered challenge metadata into different decision authority", async () => {
    const f = await approvalFixture();
    const challenge = await f.approvals.issueChallenge({
      ...identity(f),
      command: challengeCommand(f.detail, "reject"),
    });
    const command = decisionCommand(f.detail, challenge);
    await f.db.update(npAgentApprovals).set({ challengePurpose: "approve" });
    await expect(
      f.approvals.decide({ ...identity(f), decision: "approve", command }),
    ).rejects.toThrow();
    await f.db
      .update(npAgentApprovals)
      .set({ challengePurpose: "reject", challengeGeneration: challenge.challengeGeneration + 1 });
    await expect(
      f.approvals.decide({
        ...identity(f),
        decision: "reject",
        command: { ...command, challengeGeneration: challenge.challengeGeneration + 1 },
      }),
    ).rejects.toThrow();
    await f.db.update(npAgentApprovals).set({
      challengeGeneration: challenge.challengeGeneration,
      challengeSessionFingerprint: digest,
    });
    await expect(
      f.approvals.decide({ ...identity(f), decision: "reject", command }),
    ).rejects.toThrow();
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("pending");
  });
  it("retires exact integrity key ids containing underscores without matching another key", async () => {
    const firstKey = { ...integrityKey, id: "approval_a" };
    const secondKey = { ...integrityKey, id: "approvalXa", bytes: new Uint8Array(32).fill(75) };
    const f = await approvalFixture(false, false, firstKey);
    const other = createAgentChangeSetServiceV1({
      ...f.options,
      approvals: {
        ...f.options.approvals!,
        integrityKeys: { active: secondKey, previous: [firstKey] },
      },
    });
    const preview = await readyPreview({ service: other, actor: f.actor });
    const [otherChange] = await f.db
      .select()
      .from(npAgentChangesets)
      .where(eq(npAgentChangesets.id, preview.changeSetId));
    if (!otherChange?.planHash || !other.approvals) throw new Error("Missing second target");
    const detail = await other.requestApproval({
      actor: f.actor,
      id: otherChange.id,
      command: { ...f.request, planHash: otherChange.planHash, idempotencyKey: randomUUID() },
    });
    const otherIdentity = { siteId, actor: f.actor.actor, id: detail.item.approval.id };
    const challenge = await other.approvals.issueChallenge({
      ...otherIdentity,
      command: challengeCommand(detail),
    });
    await other.approvals.decide({
      ...otherIdentity,
      decision: "approve",
      command: decisionCommand(detail, challenge),
    });
    const maintenance = createAgentChangeSetServiceV1({
      ...f.options,
      approvals: {
        ...f.options.approvals!,
        integrityKeys: {
          active: { ...integrityKey, id: "approval-c", bytes: new Uint8Array(32).fill(76) },
          previous: [firstKey, secondKey],
        },
      },
    });
    expect(
      await maintenance.approvals!.reconcile({ siteId, retireIntegrityKeyId: firstKey.id }),
    ).toMatchObject({ examined: 1, revoked: 1 });
    const [untouched] = await f.db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.id, detail.item.approval.id));
    expect(untouched?.state).toBe("approved");
  });
  it.each(["pending", "approved"] as const)(
    "recovers new review after removing the original key from %s approval history",
    async (state) => {
      const f = await approvalFixture();
      if (state === "approved") await decide(f, "approve");
      const replacement = {
        ...integrityKey,
        id: "approval-retirement",
        bytes: new Uint8Array(32).fill(78),
      };
      const retired = createAgentChangeSetServiceV1({
        ...f.options,
        approvals: { ...f.options.approvals!, integrityKeys: { active: replacement } },
      });
      if (!retired.approvals) throw new Error("Missing approval service");
      const [live] = await f.db.select().from(npAgentApprovals);
      if (!live) throw new Error("Missing old approval");
      await expect(retired.approvals.summary(live)).rejects.toMatchObject({
        code: "APPROVAL_INTEGRITY_INVALID",
      });
      expect(
        await retired.approvals.reconcile({ siteId, retireIntegrityKeyId: integrityKey.id }),
      ).toMatchObject({ examined: 1, revoked: 1, incidents: 0 });
      const [history] = await f.db.select().from(npAgentApprovals);
      if (!history) throw new Error("Missing retired history");
      await expect(retired.approvals.verify(history)).rejects.toMatchObject({
        code: "APPROVAL_INTEGRITY_INVALID",
      });
      await expect(retired.approvals.summary(history)).resolves.toBeNull();
      const review = await retired.getReview({ actor: f.actor, id: f.change.id });
      expect(review.changeSet).toMatchObject({ state: "ready", approval: null });
      for (const patch of [
        { generation: history.generation + 1 },
        { siteId: "draft-other" },
        { targetId: randomUUID() },
        { planHash: `cj1:sha256:${"B".repeat(43)}` },
        { revocationCode: "APPROVAL_REVOKED" },
        { revocationReason: "tampered" },
        { revocationIntegrityKeyId: "other" },
        { revocationMac: `cj1:hmac-sha256:${replacement.id}:${"B".repeat(43)}` },
      ])
        await expect(retired.approvals.summary({ ...history, ...patch })).rejects.toMatchObject({
          code: "APPROVAL_INTEGRITY_INVALID",
        });
      const invalidMac = `cj1:hmac-sha256:${replacement.id}:${"B".repeat(43)}`;
      await f.db
        .update(npAgentApprovals)
        .set({ revocationMac: invalidMac })
        .where(eq(npAgentApprovals.id, history.id));
      await expect(retired.getReview({ actor: f.actor, id: f.change.id })).rejects.toThrow();
      await expect(
        retired.requestApproval({
          actor: f.actor,
          id: f.change.id,
          command: { ...f.request, idempotencyKey: randomUUID() },
        }),
      ).rejects.toThrow();
      await f.db
        .update(npAgentApprovals)
        .set({ revocationMac: history.revocationMac })
        .where(eq(npAgentApprovals.id, history.id));
      const next = await retired.requestApproval({
        actor: f.actor,
        id: f.change.id,
        command: { ...f.request, idempotencyKey: randomUUID() },
      });
      expect(next.item.approval.generation).toBe(2);
      expect(next.item.approval.id).not.toBe(history.id);
      const [unchanged] = await f.db
        .select()
        .from(npAgentApprovals)
        .where(eq(npAgentApprovals.id, history.id));
      expect(unchanged).toEqual(history);
    },
  );
  it("verifies retired-key overlap and contains statement MAC tampering", async () => {
    const f = await approvalFixture();
    const rotated = createAgentChangeSetServiceV1({
      ...f.options,
      approvals: {
        ...f.options.approvals!,
        integrityKeys: {
          active: { ...integrityKey, id: "approval-b", bytes: new Uint8Array(32).fill(74) },
          previous: [integrityKey],
        },
      },
    });
    expect((await rotated.approvals!.get(identity(f))).item.approval.id).toBe(
      f.detail.item.approval.id,
    );
    const retired = createAgentChangeSetServiceV1({
      ...f.options,
      approvals: {
        ...f.options.approvals!,
        integrityKeys: {
          active: { ...integrityKey, id: "approval-b", bytes: new Uint8Array(32).fill(74) },
        },
      },
    });
    await expect(retired.approvals!.get(identity(f))).rejects.toMatchObject({ status: 404 });
    await f.db.update(npAgentApprovals).set({ statementMac: "invalid" });
    await expect(f.approvals.get(identity(f))).rejects.toMatchObject({ status: 404 });
    const incidents = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agents.approvals.integrity_incident"));
    expect(incidents.length).toBeGreaterThan(0);
    expect(JSON.stringify(incidents.map((row) => row.payload))).not.toContain("invalid");
  });
});
