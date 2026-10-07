import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentIncidentTimeline,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import { npComments } from "../../../packages/core/src/db/schema/community.js";
import { npSessions, npSiteMemberships } from "../../../packages/core/src/db/schema/system.js";
import { grantSiteMembership } from "../../../packages/core/src/sites/memberships.js";
import type { NpAgentAdminActorV1 } from "../../../packages/core/src/agent/admin-admission.js";
import type { NpAgentModerationCapabilityInvocationRequestV1 } from "../../../packages/core/src/agent-contract/moderation-capability-contract.js";
import { moderationRuntimeFixture } from "./agent-moderation-runtime-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof moderationRuntimeFixture>>;
async function noEffects(f: Fixture) {
  const [comment] = await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id));
  expect(comment.status).toBe("pending");
  expect(await f.db.select().from(npAgentContainments)).toEqual([]);
  expect(await f.db.select().from(npAgentIncidentTimeline)).toEqual([]);
}
async function wait(f: Fixture) {
  const input = await f.queue();
  const processed = await f.executor.process(input);
  const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, input.runId));
  expect(processed, run.errorCode ?? "Runtime reached approval").toEqual({
    state: "waiting_approval",
  });
  const pending = await f.pending(input.runId);
  expect(pending.action.state).toBe("approval_pending");
  expect(pending.output.runId).toBe(input.runId);
  await noEffects(f);
  return { ...input, requestActionId: pending.action.id, ...pending };
}

describe.skipIf(skipIfNoTestDb())("Human-approved Moderator Runtime continuation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("waits without effects, survives executor restart, quarantines and restores exactly once with safe result context", async () => {
    const f = await moderationRuntimeFixture();
    try {
      const pending = await wait(f);
      const catalog = await f.admission.withRunAuthority(
        { siteId, runId: pending.runId },
        async (context) => ({
          enabled: await f.capabilities.sourceEntries(context),
          absent: await f.withoutRuntimeOwner.sourceEntries(context),
        }),
      );
      expect(catalog.enabled.map((entry) => entry.definition.descriptor.id)).toEqual(
        expect.arrayContaining(["moderation.quarantine", "moderation.restore"]),
      );
      expect(
        catalog.absent.some((entry) => entry.definition.descriptor.id.startsWith("moderation.")),
      ).toBe(false);
      const resume = { siteId, runId: pending.runId, requestActionId: pending.requestActionId };
      expect(await f.executor.resumeApproval(resume)).toEqual({ state: "waiting_approval" });
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      await noEffects(f);
      await f.decide(pending.output.approvalId);
      const ready = await f.admission.withRunAuthority(
        { siteId, runId: resume.runId, allowTerminal: true },
        (context) => f.service.inspectRuntimeApproval(context, pending.requestActionId),
      );
      expect(ready).toMatchObject({
        status: "ready",
        executionActionId: pending.requestActionId,
        executionSequence: pending.action.sequence,
      });
      f.executor.shutdown();
      const restarted = f.createExecutor();
      expect(await restarted.resumeApproval(resume)).toEqual({ state: "succeeded" });
      expect(await restarted.resumeApproval(resume)).toEqual({ state: "succeeded" });
      expect(await restarted.process({ siteId, runId: pending.runId })).toEqual({
        state: "succeeded",
      });
      expect(f.providerInvoke).toHaveBeenCalledTimes(2);
      const [quarantineAction] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.runId, pending.runId));
      expect(quarantineAction).toMatchObject({
        id: pending.requestActionId,
        sequence: pending.action.sequence,
        state: "succeeded",
      });
      const [containment] = await f.db.select().from(npAgentContainments);
      expect(containment.state).toBe("active");
      expect(
        (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0].status,
      ).toBe("hidden");
      expect(
        (
          await f.db
            .select()
            .from(npAgentApprovals)
            .where(eq(npAgentApprovals.id, pending.output.approvalId))
        )[0].state,
      ).toBe("consumed");
      const projected = await f.admission.withRunAuthority(
        { siteId, runId: resume.runId, allowTerminal: true },
        (context) => f.service.projectRuntimeAction(context, pending.requestActionId),
      );
      expect(projected).toMatchObject({
        state: "succeeded",
        moderationOutput: { state: "succeeded", containmentId: containment.id },
      });
      const providerRequest = f.providerInvoke.mock.calls[1]![0];
      expect(
        providerRequest.trustedContext.some((entry) => entry.text.includes(containment.id)),
      ).toBe(true);
      expect(JSON.stringify(providerRequest)).not.toContain(f.comment.bodyMd);
      expect(JSON.stringify(providerRequest)).not.toContain("originalState");
      const restore: NpAgentModerationCapabilityInvocationRequestV1 = {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "moderation.restore",
        arguments: {
          idempotencyKey: randomUUID(),
          input: {
            mode: "propose",
            proposal: {
              containmentKind: "content_quarantine",
              containmentId: containment.id,
              expectedVersionDigest: containment.targetVersionDigest,
            },
          },
        },
      };
      const restoreInput = await f.queue(restore);
      expect(await restarted.process(restoreInput)).toEqual({ state: "waiting_approval" });
      const restoration = await f.pending(restoreInput.runId);
      expect(
        (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0].status,
      ).toBe("hidden");
      await f.decide(restoration.output.approvalId);
      const restoreResume = { ...restoreInput, requestActionId: restoration.action.id };
      expect(await restarted.resumeApproval(restoreResume)).toEqual({ state: "succeeded" });
      expect(await restarted.resumeApproval(restoreResume)).toEqual({ state: "succeeded" });
      expect(
        (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0],
      ).toEqual(f.comment);
      expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
      expect(await f.db.select().from(npAgentIncidentTimeline)).toHaveLength(2);
      expect(
        await f.admission.withRunAuthority({ ...restoreInput, allowTerminal: true }, (context) =>
          f.service.projectRuntimeAction(context, restoration.action.id),
        ),
      ).toMatchObject({
        state: "succeeded",
        moderationOutput: { state: "compensated", containmentId: containment.id },
      });
      expect(f.providerInvoke).toHaveBeenCalledTimes(4);
      const [completedRestore] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.id, restoration.action.id));
      await f.db
        .update(npAgentActions)
        .set({
          outputRedacted: { ...completedRestore.outputRedacted, containmentId: randomUUID() },
        })
        .where(eq(npAgentActions.id, restoration.action.id));
      await expect(
        f.admission.withRunAuthority({ ...restoreInput, allowTerminal: true }, (context) =>
          f.service.projectRuntimeAction(context, restoration.action.id),
        ),
      ).rejects.toMatchObject({ code: "MODERATION_CONFLICT" });
      await f.db
        .update(npAgentActions)
        .set({ outputRedacted: completedRestore.outputRedacted })
        .where(eq(npAgentActions.id, restoration.action.id));
      expect(
        await f.admission.withRunAuthority({ ...restoreInput, allowTerminal: true }, (context) =>
          f.service.projectRuntimeAction(context, restoration.action.id),
        ),
      ).toMatchObject({ state: "succeeded" });
    } finally {
      await f.dispose();
    }
  });

  it("honors a narrower host target limit when Runtime allows more pending proposals", async () => {
    const f = await moderationRuntimeFixture({ runtimeTargetLimit: 4 });
    try {
      const input = await f.queue();
      const acquired = await f.store.claim(input);
      if (!acquired.claim) throw new Error("Expected Runtime claim");
      const claimed = { ...input, claim: acquired.claim };
      const first = await f.facade.invokeRuntime({
        ...claimed,
        sequence: 1,
        request: f.quarantine,
      });
      expect(first.output.state).toBe("approval_required");
      if (first.output.state !== "approval_required") throw new Error("Expected approval");
      expect(
        await f.store.withClaim(claimed, (context) =>
          f.service.inspectRuntimeApproval(context, first.output.actionId),
        ),
      ).toMatchObject({ status: "pending" });
      const second = structuredClone(f.quarantine);
      second.arguments.idempotencyKey = randomUUID();
      await expect(
        f.facade.invokeRuntime({ ...claimed, sequence: 2, request: second }),
      ).rejects.toThrow();
      expect(
        await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, input.runId)),
      ).toHaveLength(1);
      expect(await f.db.select().from(npAgentApprovals)).toHaveLength(1);
      await noEffects(f);
    } finally {
      await f.dispose();
    }
  });

  it.each(["rejected", "revoked", "expired"] as const)(
    "closes %s approval without a content effect or provider continuation",
    async (condition) => {
      const f = await moderationRuntimeFixture();
      try {
        const pending = await wait(f);
        if (condition === "rejected") await f.decide(pending.output.approvalId, "reject");
        else {
          await f.decide(pending.output.approvalId);
          if (condition === "revoked") await f.decide(pending.output.approvalId, "revoke");
          else {
            f.advance(3601);
            await f.approvals.reconcileExpired({ siteId });
          }
        }
        await expect(
          f.executor.resumeApproval({
            siteId,
            runId: pending.runId,
            requestActionId: pending.requestActionId,
          }),
        ).rejects.toThrow();
        await noEffects(f);
        expect(f.providerInvoke).toHaveBeenCalledTimes(1);
        expect(
          (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, pending.runId)))[0],
        ).toMatchObject({ state: "failed", leaseUntil: null });
        expect(
          (
            await f.db
              .select()
              .from(npAgentApprovals)
              .where(eq(npAgentApprovals.id, pending.output.approvalId))
          )[0].state,
        ).toBe(condition);
      } finally {
        await f.dispose();
      }
    },
  );

  it.each(["approver-authority", "target-version", "policy", "budget"] as const)(
    "rechecks current %s before resuming an approved effect",
    async (condition) => {
      const f = await moderationRuntimeFixture();
      try {
        const pending = await wait(f);
        let approver: NpAgentAdminActorV1 = f.actor.actor;
        if (condition === "approver-authority") {
          const seeded = await seedUser({ role: "admin" });
          await grantSiteMembership(siteId, seeded.userId, "admin");
          const [session] = await f.db
            .select()
            .from(npSessions)
            .where(eq(npSessions.userId, seeded.userId));
          approver = {
            user: {
              id: seeded.userId,
              name: seeded.name,
              email: seeded.email,
              role: seeded.role,
              tokenVersion: 0,
            },
            sessionId: session.id,
          };
        }
        await f.decide(pending.output.approvalId, "approve", approver);
        if (condition === "approver-authority")
          await f.db
            .update(npSiteMemberships)
            .set({ role: "viewer" })
            .where(
              and(
                eq(npSiteMemberships.siteId, siteId),
                eq(npSiteMemberships.userId, approver.user.id),
              ),
            );
        if (condition === "target-version")
          await f.db
            .update(npComments)
            .set({ bodyMd: "Human revised the pending target" })
            .where(eq(npComments.id, f.comment.id));
        if (condition === "policy") f.rules.automation.moderationTargetsPerRun = 0;
        if (condition === "budget") f.budget.directActionsPerHour = 0;
        await expect(
          f.executor.resumeApproval({
            siteId,
            runId: pending.runId,
            requestActionId: pending.requestActionId,
          }),
        ).rejects.toThrow();
        await noEffects(f);
        expect(f.providerInvoke).toHaveBeenCalledTimes(1);
        expect(
          (
            await f.db
              .select()
              .from(npAgentApprovals)
              .where(eq(npAgentApprovals.id, pending.output.approvalId))
          )[0].state,
        ).toBe("approved");
      } finally {
        await f.dispose();
      }
    },
  );

  it("rejects provider-directed approved execution and atomically rolls back a failed continuation before retry", async () => {
    const f = await moderationRuntimeFixture();
    try {
      const pending = await wait(f);
      await f.decide(pending.output.approvalId);
      const identity = { siteId, runId: pending.runId, requestActionId: pending.requestActionId };
      const acquired = await f.store.claimApproval(identity);
      if (!acquired.claim) throw new Error("Expected approved continuation lease");
      const claimed = { siteId, runId: pending.runId, claim: acquired.claim };
      await expect(
        f.facade.invokeRuntime({
          ...claimed,
          sequence: pending.action.sequence,
          request: {
            schemaVersion: "np.agent-invocation-request.v1",
            capabilityId: "moderation.quarantine",
            arguments: {
              idempotencyKey: randomUUID(),
              input: {
                mode: "execute_approved",
                actionId: pending.action.id,
                approvalId: pending.output.approvalId,
                proposalHash: pending.output.proposalHash,
              },
            },
          },
        }),
      ).rejects.toThrow();
      await noEffects(f);
      f.failTimeline(true);
      await expect(
        f.service.resumeRuntimeApproval({
          ...claimed,
          requestActionId: pending.action.id,
          sequence: pending.action.sequence,
        }),
      ).rejects.toThrow("Fixture timeline persistence unavailable");
      await noEffects(f);
      expect(
        (
          await f.db
            .select()
            .from(npAgentApprovals)
            .where(eq(npAgentApprovals.id, pending.output.approvalId))
        )[0].state,
      ).toBe("approved");
      expect(
        (
          await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, pending.action.id))
        )[0],
      ).toMatchObject({ state: "approved", executionInvocationId: null, containmentId: null });
      f.failTimeline(false);
      await f.service.resumeRuntimeApproval({
        ...claimed,
        requestActionId: pending.action.id,
        sequence: pending.action.sequence,
      });
      expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
      expect(
        (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, pending.runId)))[0].state,
      ).toBe("running");
      expect(
        await f.store.withClaim(claimed, (context) =>
          f.service.inspectRuntimeApproval(context, pending.action.id),
        ),
      ).toMatchObject({
        status: "completed",
        executionActionId: pending.action.id,
        executionSequence: pending.action.sequence,
      });
      // Simulate a worker lost after the atomic effect commit but before finalizing the Run.
      f.executor.shutdown();
      f.advance(11);
      const restarted = f.createExecutor();
      const resumed = await restarted.resumeApproval(identity);
      const [resumedRun] = await f.db
        .select()
        .from(npAgentRuns)
        .where(eq(npAgentRuns.id, pending.runId));
      expect(resumed, resumedRun.errorCode ?? "Recovered committed effect").toEqual({
        state: "succeeded",
      });
      expect(await restarted.resumeApproval(identity)).toEqual({ state: "succeeded" });
      expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
      expect(await f.db.select().from(npAgentIncidentTimeline)).toHaveLength(1);
      expect(f.providerInvoke).toHaveBeenCalledTimes(2);
      await expect(
        f.service.resumeRuntimeApproval({
          ...claimed,
          requestActionId: pending.action.id,
          sequence: pending.action.sequence,
        }),
      ).rejects.toThrow();
    } finally {
      await f.dispose();
    }
  });
});
