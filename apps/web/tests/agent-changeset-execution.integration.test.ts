import { randomUUID } from "node:crypto";
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { grantSiteMembership, npSessions, npUsers, npSettings, npRevisions } from "@nexpress/core";
import {
  npAgentApprovals,
  npAgentChangesets,
  npAgentChangesetExecutions,
  npAgentChangesetOperations,
  npAgentPrincipals,
  npAgentServiceTokens,
} from "../../../packages/core/src/db/schema/agent.js";
import type {
  NpAgentChangeSetServiceOptionsV1,
  NpAgentChangeSetActorV1,
} from "../../../packages/core/src/agent/changeset-service.js";
import type {
  NpAgentCapabilityRegistryCanonicalV1,
  NpAgentCapabilityDescriptor,
} from "../../../packages/core/src/agent-contract/types.js";
import type { NpAgentChangeSetDraftInputV1 } from "../../../packages/core/src/agent-contract/changeset-wire-contract.js";
import type {
  NpAgentChangeSetApplyJobPayload,
  NpAgentChangeSetVerifyJobPayload,
} from "../../../packages/core/src/jobs-contract/types.js";
import {
  fixture,
  principalFixture,
  command,
  draft,
  previewConfiguration,
  previewStorageFixture,
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
const digest = `cj1:sha256:${"A".repeat(43)}`;
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

async function executionFixture({
  intendedOperation = "apply",
  document = false,
  deferVerification = false,
  convergenceFails = false,
  distinctApprover = false,
  principalExposure,
}: {
  intendedOperation?: "apply" | "schedule";
  document?: boolean;
  deferVerification?: boolean;
  convergenceFails?: boolean;
  distinctApprover?: boolean;
  principalExposure?: "propose" | "approved-execute";
} = {}) {
  let time = new Date();
  let paused = false;
  const scheduledFor =
    intendedOperation === "schedule" ? new Date(time.getTime() + 120_000).toISOString() : null;
  const { adapter } = previewStorageFixture(),
    configuration = previewConfiguration();
  const applyJobs: NpAgentChangeSetApplyJobPayload[] = [],
    verifyJobs: NpAgentChangeSetVerifyJobPayload[] = [];
  const verifyConvergence = vi.fn(() =>
    Promise.resolve({
      status: convergenceFails ? ("failed" as const) : ("passed" as const),
      evidenceRefs: [],
    }),
  );
  const options: NpAgentChangeSetServiceOptionsV1 = {
    cursorKey: new Uint8Array(32).fill(44),
    now: () => time,
    secretRequestDigestKey: { id: "execution-request", key: new Uint8Array(32).fill(72) },
    reauthentication: {
      verify: () => ({ reauthenticatedAt: time.toISOString(), sessionFactFingerprint: digest }),
    },
    approvals: {
      integrityKeys: {
        active: {
          owner: "approval-integrity",
          id: "execution-a",
          bytes: new Uint8Array(32).fill(71),
        },
      },
      challengeKeys: { active: { id: "execution-challenge", key: new Uint8Array(32).fill(73) } },
      lifetimeSeconds: 600,
      resolveExecutionBinding: (input) => Promise.resolve(binding(input.intendedOperation)),
    },
    execution: {
      resolveIntent: () => Promise.resolve({ enabled: true, paused }),
      verificationFingerprint: digest,
      verifyConvergence,
      enqueueApply: (job) => {
        applyJobs.push(job);
        return Promise.resolve();
      },
      ...(deferVerification
        ? {
            enqueueVerify: (job: NpAgentChangeSetVerifyJobPayload) => {
              verifyJobs.push(job);
              return Promise.resolve();
            },
          }
        : {}),
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
        resolveManifest: () =>
          Promise.resolve([{ route: "/", locale: null, audience: "public" as const }]),
        render: () =>
          Promise.resolve(
            '<html lang="en"><head><title>Review</title><meta name="description" content="Review"></head><body><main>Preview</main></body></html>',
          ),
      },
    },
  };
  const f = await fixture(options);
  const principal = principalExposure
    ? await principalFixture(
        f,
        false,
        options,
        ["changeset:apply", "content:publish", "settings:read", "settings:write"],
        principalExposure,
      )
    : null;
  const service = principal?.service ?? f.service;
  const creator = principal?.actor ?? f.actor;
  const value: NpAgentChangeSetDraftInputV1 = document
    ? draft()
    : {
        title: "Apply SEO",
        summary: null,
        operations: [
          {
            kind: "setting",
            operation: "replace",
            clientOperationId: "seo",
            reason: null,
            resource: { key: "seo" },
            base: null,
            input: {
              value: { defaultOgImage: null, twitterHandle: "execution", defaultLocale: "en" },
            },
          },
        ],
      };
  const created = await service.create({ actor: creator, command: await command(value) });
  const sealed = await service.validate({
    actor: creator,
    id: created.id,
    command: { idempotencyKey: randomUUID(), expectedVersion: 1 },
  });
  const preview = await service.preview({
    actor: creator,
    id: created.id,
    command: {
      idempotencyKey: randomUUID(),
      expectedVersion: 1,
      expectedPlanHash: sealed.planHash,
    },
  });
  await service.processPreview({ siteId, previewId: preview.previewId });
  const requested = await service.requestApproval({
    actor: f.actor,
    id: created.id,
    command: {
      schemaVersion: "np.agent-changeset-request-approval-input.v1",
      expectedDraftVersion: 1,
      planHash: sealed.planHash,
      intendedOperation,
      scheduledFor,
      idempotencyKey: randomUUID(),
    },
  });
  let approver = f.actor;
  if (distinctApprover) {
    const seeded = await seedUser({ role: "admin" });
    await grantSiteMembership(siteId, seeded.userId, "admin");
    const [user] = await f.db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, seeded.userId));
    approver = {
      kind: "staff",
      siteId,
      actor: { user: { ...user, tokenVersion: user.tokenVersion }, sessionId: session.id },
    };
  }
  const approvals = service.approvals!;
  const challenge = await approvals.issueChallenge({
    siteId,
    actor: approver.actor,
    id: requested.item.approval.id,
    command: {
      schemaVersion: "np.agent-approval-challenge-request.v1",
      purpose: "approve",
      expectedApprovalVersion: requested.item.version,
      statementHash: requested.item.statementHash,
      idempotencyKey: randomUUID(),
    },
  });
  const approved = await approvals.decide({
    siteId,
    actor: approver.actor,
    id: requested.item.approval.id,
    decision: "approve",
    command: {
      schemaVersion: "np.agent-approval-decision-input.v1",
      expectedApprovalVersion: challenge.approvalVersion,
      statementHash: requested.item.statementHash,
      challengeGeneration: challenge.challengeGeneration,
      challenge: challenge.challenge,
      idempotencyKey: randomUUID(),
      reason: "Reviewed execution",
    },
  });
  const executionCommand = {
    schemaVersion:
      intendedOperation === "apply"
        ? "np.agent-changeset-apply-input.v1"
        : "np.agent-changeset-schedule-input.v1",
    expectedDraftVersion: 1,
    planHash: sealed.planHash,
    approvalId: approved.item.approval.id,
    statementHash: approved.item.statementHash,
    idempotencyKey: randomUUID(),
    ...(scheduledFor ? { scheduledFor } : {}),
  };
  return {
    ...f,
    service,
    principal,
    approver,
    id: created.id,
    approved,
    executionCommand,
    applyJobs,
    verifyJobs,
    verifyConvergence,
    advance(seconds: number) {
      time = new Date(time.getTime() + seconds * 1000);
    },
    pause() {
      paused = true;
    },
    async seo() {
      return (
        await f.db
          .select()
          .from(npSettings)
          .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "seo")))
      )[0];
    },
    async execution() {
      return (
        await f.db
          .select()
          .from(npAgentChangesetExecutions)
          .where(eq(npAgentChangesetExecutions.changesetId, created.id))
      )[0];
    },
  };
}

describe.skipIf(skipIfNoTestDb())("ChangeSet execution lifecycle", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("applies an approved plan once, consumes approval and verifies real persisted evidence", async () => {
    const f = await executionFixture();
    const result = await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
    expect(result.changeSet.state).toBe("verified");
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
    expect((await f.execution())?.state).toBe("succeeded");
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("consumed");
    const updatedAt = (await f.seo())?.updatedAt;
    const replay = await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
    expect(replay.changeSet.state).toBe("verified");
    expect((await f.seo())?.updatedAt).toEqual(updatedAt);
    expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(1);
    expect((await f.db.select().from(npAgentChangesetOperations))[0]).toMatchObject({
      state: "verified",
      afterHash: expect.any(String),
      resultDigest: expect.any(String),
    });
  });

  it("retains a scheduled reservation until due and executes it with the approved human after creator logout", async () => {
    const f = await executionFixture({ intendedOperation: "schedule", distinctApprover: true });
    const result = await f.service.schedule({
      actor: f.actor,
      id: f.id,
      command: f.executionCommand,
    });
    expect(result.changeSet.state).toBe("scheduled");
    expect(await f.seo()).toBeUndefined();
    expect(await f.service.processExecution(f.applyJobs[0])).toEqual({ state: "reserved" });
    await f.db.delete(npSessions).where(eq(npSessions.userId, f.actor.actor.user.id));
    await f.service.approvals!.reconcile({ siteId, limit: 1 });
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("approved");
    expect((await f.execution())?.state).toBe("reserved");
    f.advance(121);
    await f.service.processExecution(f.applyJobs[0]);
    expect((await f.execution())?.state).toBe("succeeded");
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
  });

  it("expires a delayed approval without content writes", async () => {
    const f = await executionFixture({ intendedOperation: "schedule" });
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    f.advance(601);
    await f.service.processExecution(f.applyJobs[0]);
    expect((await f.execution())?.errorCode).toBe("APPROVAL_EXPIRED");
    expect(await f.seo()).toBeUndefined();
    expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe("apply_failed");
  });

  it("rechecks the current approver's capabilities when scheduled work becomes due", async () => {
    const f = await executionFixture({ intendedOperation: "schedule", distinctApprover: true });
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    await f.db
      .update(npUsers)
      .set({ role: "author" })
      .where(eq(npUsers.id, f.approver.actor.user.id));
    await grantSiteMembership(siteId, f.approver.actor.user.id, "author");
    f.advance(121);
    await f.service.processExecution(f.applyJobs[0]);
    expect((await f.execution())?.errorCode).toBe("AUTHORIZATION_CHANGED");
    expect(await f.seo()).toBeUndefined();
  });

  it("honors current host emergency pause before scheduled content writes", async () => {
    const f = await executionFixture({ intendedOperation: "schedule" });
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    f.pause();
    f.advance(121);
    await f.service.processExecution(f.applyJobs[0]);
    expect((await f.execution())?.errorCode).toBe("POLICY_CHANGED");
    expect(await f.seo()).toBeUndefined();
  });

  it("honors a host abort before scheduled domain writes", async () => {
    const f = await executionFixture({ intendedOperation: "schedule" });
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    f.advance(121);
    const controller = new AbortController();
    controller.abort();
    await f.service.processExecution(f.applyJobs[0], { signal: controller.signal });
    expect((await f.execution())?.errorCode).toBe("EXECUTION_CANCELLED");
    expect((await f.execution())?.committedAt).toBeNull();
    expect((await f.db.select().from(npAgentApprovals))[0]).toMatchObject({
      state: "revoked",
      revocationCode: "EXECUTION_CANCELLED",
      revocationHash: expect.any(String),
      revocationMac: expect.any(String),
    });
    const revoked = await f.service.approvals!.get({
      siteId,
      actor: f.actor.actor,
      id: f.approved.item.approval.id,
    });
    expect(revoked.item.approval.state).toBe("revoked");
    expect(await f.seo()).toBeUndefined();
  });

  it("closes a scheduled reservation when approval expiry maintenance runs first", async () => {
    const f = await executionFixture({ intendedOperation: "schedule" });
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    f.advance(601);
    await f.service.approvals!.reconcileExpired({ siteId, limit: 1 });
    expect((await f.execution())?.errorCode).toBe("APPROVAL_EXPIRED");
    expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe("apply_failed");
    await f.service.processExecution(f.applyJobs[0]);
    expect(await f.seo()).toBeUndefined();
  });

  it("cancels scheduled work and fences its previously issued dispatch payload", async () => {
    const f = await executionFixture({ intendedOperation: "schedule" });
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    const result = await f.service.cancel({
      actor: f.actor,
      id: f.id,
      command: {
        schemaVersion: "np.agent-changeset-cancel-input.v1",
        expectedDraftVersion: 1,
        expectedState: "scheduled",
        planHash: f.executionCommand.planHash,
        reasonCode: "OPERATOR_CANCELLED",
        reason: null,
        idempotencyKey: randomUUID(),
      },
    });
    expect(result.changeSet.state).toBe("cancelled");
    f.advance(121);
    await f.service.processExecution(f.applyJobs[0]);
    expect(await f.seo()).toBeUndefined();
    expect((await f.execution())?.errorCode).toBe("EXECUTION_CANCELLED");
  });

  it("rejects foreign targets, stale plans and insufficient current callers without reservation", async () => {
    const f = await executionFixture();
    await expect(
      f.service.apply({ actor: f.actor, id: randomUUID(), command: f.executionCommand }),
    ).rejects.toBeDefined();
    await expect(
      f.service.apply({
        actor: f.actor,
        id: f.id,
        command: { ...f.executionCommand, planHash: digest },
      }),
    ).rejects.toBeDefined();
    const seeded = await seedUser({ role: "author" });
    await grantSiteMembership(siteId, seeded.userId, "author");
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, seeded.userId));
    const caller: Extract<NpAgentChangeSetActorV1, { kind: "staff" }> = {
      kind: "staff",
      siteId,
      actor: {
        user: {
          id: seeded.userId,
          name: seeded.name,
          email: seeded.email,
          role: "author",
          tokenVersion: 1,
        },
        sessionId: session.id,
      },
    };
    await expect(
      f.service.apply({ actor: caller, id: f.id, command: f.executionCommand }),
    ).rejects.toBeDefined();
    expect(await f.execution()).toBeUndefined();
    expect(await f.seo()).toBeUndefined();
  });

  it("marks failed convergence honestly while preserving committed writes and the consumed approval", async () => {
    const f = await executionFixture({ convergenceFails: true });
    const result = await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
    expect(result.changeSet.state, (await f.execution())?.errorCode ?? "no execution error").toBe(
      "verification_failed",
    );
    expect(await f.seo()).toBeDefined();
    expect((await f.execution())?.committedAt).toBeInstanceOf(Date);
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("consumed");
  });

  it("records failed document hooks and unavailable follow-up jobs without applying its content twice", async () => {
    const f = await executionFixture({ document: true });
    const config = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      hooks: {
        ...config.hooks,
        beforeCreate: [
          ({ data, user }) => {
            expect(Object.keys(user ?? {}).sort()).toEqual([
              "email",
              "id",
              "name",
              "role",
              "tokenVersion",
            ]);
            return Promise.resolve(data);
          },
        ],
        afterCreate: [() => Promise.reject(new Error("fixture hook failure"))],
      },
    });
    const result = await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
    expect(result.changeSet.state, (await f.execution())?.errorCode ?? "no execution error").toBe(
      "verification_failed",
    );
    const execution = await f.execution();
    expect(
      execution?.effects.some(
        (effect) => effect.label === "collection:afterCreate" && effect.state === "failed",
      ),
    ).toBe(true);
    expect(
      execution?.effects.some(
        (effect) => effect.label === "enqueue:content:afterSave" && effect.state === "failed",
      ),
    ).toBe(true);
    expect(await f.db.select().from(npRevisions)).toHaveLength(1);
    await f.service.reconcileExecutions({ siteId });
    expect(await f.db.select().from(npRevisions)).toHaveLength(1);
  });

  it("lets the host dispatch verification explicitly and rejects a stale job tuple", async () => {
    const f = await executionFixture({ deferVerification: true });
    const result = await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
    expect(result.changeSet.state).toBe("applied");
    expect(f.verifyConvergence).not.toHaveBeenCalled();
    expect(f.verifyJobs).toHaveLength(1);
    await f.service.processVerification(f.verifyJobs[0]);
    expect((await f.execution())?.state).toBe("succeeded");
    expect(
      await f.service.processExecution({
        siteId,
        changeSetId: f.id,
        planHash: digest,
        approvalId: f.approved.item.approval.id,
        scheduledFor: null,
        idempotencyKey: f.executionCommand.idempotencyKey,
      }),
    ).toEqual({ state: "stale" });
  });

  it("keeps duplicate dispatch from verifying while committed document hooks still run", async () => {
    const f = await executionFixture({ document: true, deferVerification: true });
    let enterHook: () => void = () => undefined;
    let releaseHook: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      enterHook = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const afterCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      enterHook();
      await release;
      return data;
    });
    const config = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      hooks: { ...config.hooks, afterCreate: [afterCreate] },
    });
    const first = f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
    try {
      await Promise.race([
        entered,
        first.then(() => {
          throw new Error("Apply completed without entering its hook");
        }),
      ]);
      const committed = await f.execution();
      expect(committed?.state).toBe("committed");
      expect(committed?.leaseToken).toBeTypeOf("string");
      expect(committed?.verificationState).toBe("queued");
      if (!committed) throw new Error("Expected committed execution");
      await f.service.processExecution({
        siteId,
        changeSetId: f.id,
        planHash: committed.planHash,
        approvalId: committed.approvalId,
        scheduledFor: null,
        idempotencyKey: committed.idempotencyKey,
      });
      const waiting = await f.execution();
      expect(waiting?.state).toBe("committed");
      expect(waiting?.verificationState).toBe("queued");
      expect(waiting?.errorCode).toBeNull();
      expect(f.verifyConvergence).not.toHaveBeenCalled();
      expect(afterCreate).toHaveBeenCalledOnce();
      expect(await f.db.select().from(npRevisions)).toHaveLength(1);
    } finally {
      releaseHook();
      await first;
    }
    expect((await first).changeSet.state).toBe("applied");
    const drained = await f.execution();
    expect(drained?.leaseToken).toBeNull();
    expect(drained?.leaseUntil).toBeNull();
    expect(
      drained?.effects.find((effect) => effect.label === "collection:afterCreate")?.state,
    ).toBe("succeeded");
    expect(f.verifyJobs).toHaveLength(1);
    await f.service.processVerification(f.verifyJobs[0]);
    const verified = await f.execution();
    expect(verified?.state).toBe("failed");
    expect(
      verified?.effects.find((effect) => effect.label === "enqueue:content:afterSave")?.errorCode,
    ).toBe("DEPENDENCY_UNAVAILABLE");
    expect(afterCreate).toHaveBeenCalledOnce();
    expect(await f.db.select().from(npRevisions)).toHaveLength(1);
  });

  it("serializes duplicate concurrent apply commands into one committed execution", async () => {
    const f = await executionFixture();
    const results = await Promise.allSettled(
      [1, 2].map(() => f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand })),
    );
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    await f.service.reconcileExecutions({ siteId });
    expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(1);
    expect((await f.execution())?.state).toBe("succeeded");
    expect(await f.seo()).toBeDefined();
  });

  it("rejects an approved plan after its sealed base changed", async () => {
    const f = await executionFixture({ intendedOperation: "schedule" });
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    await f.db.insert(npSettings).values({
      siteId,
      key: "seo",
      value: { defaultOgImage: null, twitterHandle: "newer", defaultLocale: "en" },
    });
    f.advance(121);
    await f.service.processExecution(f.applyJobs[0]);
    expect((await f.db.select().from(npAgentChangesets))[0]?.state).toBe("apply_failed");
    expect((await f.execution())?.errorCode).toBe("BASE_CONFLICT");
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "newer" });
  });

  it("rejects tampered signed approval evidence before reserving execution", async () => {
    const f = await executionFixture();
    await f.db.update(npAgentApprovals).set({ statementMac: "tampered-fixture-mac" });
    await expect(
      f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand }),
    ).rejects.toBeDefined();
    expect(await f.execution()).toBeUndefined();
    expect(await f.seo()).toBeUndefined();
  });

  it("detects post-commit resource drift and never replays the consumed approval", async () => {
    const f = await executionFixture({ deferVerification: true });
    await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
    await f.db
      .update(npSettings)
      .set({ value: { defaultOgImage: null, twitterHandle: "later_edit", defaultLocale: "en" } })
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "seo")));
    await f.service.processVerification(f.verifyJobs[0]);
    expect(
      (await f.execution())?.verificationBody.find(
        (check) => check.checkId === "resource_after_hashes",
      )?.status,
    ).toBe("failed");
    const replay = await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
    expect(replay.changeSet.state).toBe("verification_failed");
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "later_edit" });
    expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(1);
  });

  it.each([
    "token-version",
    "revocation",
    "principal-revocation",
    "suspension",
    "audience",
    "scope",
    "exposure",
    "live-permission",
  ] as const)(
    "rechecks approved-execute principal %s when scheduled execution becomes due",
    async (mode) => {
      const f = await executionFixture({
        intendedOperation: "schedule",
        principalExposure: "approved-execute",
        distinctApprover: true,
      });
      if (!f.principal) throw new Error("Expected principal fixture");
      await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
      if (mode === "token-version") await f.db.update(npAgentPrincipals).set({ tokenVersion: 2 });
      if (mode === "revocation")
        await f.db.update(npAgentServiceTokens).set({ status: "revoked", revokedAt: new Date() });
      if (mode === "principal-revocation") {
        const revokedAt = new Date();
        await f.db
          .update(npAgentPrincipals)
          .set({ status: "revoked", revokedAt, updatedAt: revokedAt });
      }
      if (mode === "suspension") await f.db.update(npAgentPrincipals).set({ status: "suspended" });
      if (mode === "audience")
        await f.db
          .update(npAgentServiceTokens)
          .set({ audience: "urn:nexpress:agent-gateway:other" });
      if (mode === "scope")
        await f.db.update(npAgentServiceTokens).set({ scopes: ["changeset:read", "site:read"] });
      if (mode === "exposure") f.principal.gatewaySettings.stdio = "propose";
      if (mode === "live-permission") {
        await f.db
          .update(npUsers)
          .set({ role: "author" })
          .where(eq(npUsers.id, f.actor.actor.user.id));
        await grantSiteMembership(siteId, f.actor.actor.user.id, "author");
      }
      f.advance(121);
      await f.service.processExecution(f.applyJobs[0]);
      expect((await f.execution())?.state).toBe("failed");
      expect((await f.execution())?.errorCode).toBe("AUTHORIZATION_CHANGED");
      expect(await f.seo()).toBeUndefined();
    },
  );

  it("executes an approved-execute principal plan with unchanged live authority", async () => {
    const f = await executionFixture({
      intendedOperation: "schedule",
      principalExposure: "approved-execute",
      distinctApprover: true,
    });
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    f.advance(121);
    await f.service.processExecution(f.applyJobs[0]);
    expect((await f.execution())?.state).toBe("succeeded");
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
  });

  it("keeps a propose-only principal from executing an approved ChangeSet", async () => {
    const f = await executionFixture({ principalExposure: "propose" });
    await expect(
      f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand }),
    ).rejects.toBeDefined();
    expect(await f.seo()).toBeUndefined();
  });
});
