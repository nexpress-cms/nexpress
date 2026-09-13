import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runtimeApprovalResumeFixture } from "./agent-runtime-approval-resume-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import {
  npAgentActions,
  npAgentInvocations,
  npAgentPrincipals,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  type NpAgentChangeSetCapabilityInvocationRequestV1,
} from "../../../packages/core/src/agent-contract/installed-capability-contract.js";

async function inspect(
  f: Awaited<ReturnType<typeof runtimeApprovalResumeFixture>>,
  actionId = f.requestActionId,
) {
  return f.admission.withRunAuthority(f.input, (context) =>
    f.service.inspectRuntimeApproval(context, actionId),
  );
}

describe.skipIf(skipIfNoTestDb())(
  "Runtime ChangeSet authority and immutable approval evidence",
  () => {
    beforeAll(async () => {
      await ensureMigrated();
      registerTestCollections();
      const { ensureFor } = await import("@/lib/init-core");
      await ensureFor("read");
    });
    beforeEach(truncateAll);
    afterAll(closeTestDb);

    it("uses the existing Runtime Run for every action and no Gateway authority", async () => {
      const f = await runtimeApprovalResumeFixture();
      const runs = await f.db.select().from(npAgentRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        id: f.input.runId,
        origin: "runtime",
        state: "waiting_approval",
      });
      const actions = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.runId, f.input.runId));
      expect(actions.map((a) => a.sequence).sort()).toEqual([1, 2, 3, 4]);
      const projected = await f.admission.withRunAuthority(f.input, (context) =>
        f.service.projectRuntimeAction(
          context,
          actions.find((action) => action.sequence === 1)!.id,
        ),
      );
      expect(projected?.references?.changeSets).toHaveLength(1);
      expect(projected?.references?.changeSets[0]).toMatchObject({
        changeSetId: f.sealed.id,
        draftVersion: f.sealed.draftVersion,
        draftHash: f.sealed.draftHash,
        planHash: f.sealed.planHash,
        previewState: "ready",
      });
      const metadata = JSON.stringify(projected);
      for (const forbidden of [
        "Runtime SEO",
        "twitterHandle",
        "operations",
        "locator",
        "credential",
        "reasoning",
      ])
        expect(metadata).not.toContain(forbidden);

      const invocations = await f.db
        .select()
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.runId, f.input.runId),
            eq(npAgentInvocations.operationKind, "capability"),
          ),
        );
      expect(invocations).toHaveLength(4);
      for (const invocation of invocations)
        expect(invocation).toMatchObject({
          transport: "runtime",
          authorityRef: { kind: "runtime-run", runId: f.input.runId },
        });
      expect(await inspect(f)).toMatchObject({
        status: "pending",
        executionActionId: null,
        executionSequence: null,
      });
    });

    it("does not accept a missing or other action as the exact approval request", async () => {
      const f = await runtimeApprovalResumeFixture();
      const [other] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.sequence, 1));
      await expect(inspect(f, randomUUID())).rejects.toThrow();
      await expect(inspect(f, other.id)).rejects.toThrow();
      expect((await f.run()).state).toBe("waiting_approval");
    });

    it("rejects changed canonical action input before claiming or executing", async () => {
      const f = await runtimeApprovalResumeFixture();
      await f.approve();
      const original = await f.requestAction();
      await f.db
        .update(npAgentActions)
        .set({ inputCanonical: { ...original.inputCanonical, changeSetId: randomUUID() } })
        .where(eq(npAgentActions.id, original.id));
      await expect(inspect(f)).rejects.toThrow();
      expect((await f.run()).state).toBe("waiting_approval");
    });

    it("rechecks revocation on stored requester access and hides prior action evidence", async () => {
      const f = await runtimeApprovalResumeFixture();
      const run = await f.run();
      await f.db
        .update(npAgentPrincipals)
        .set({ status: "suspended", updatedAt: f.options.now(), rowVersion: 2 })
        .where(eq(npAgentPrincipals.id, run.principalId));
      await expect(inspect(f)).rejects.toThrow();
      await expect(
        f.service.get({ actor: { kind: "runtime", ...f.input }, id: f.sealed.id }),
      ).rejects.toThrow();
    });

    it("replays an approved request without a second approval, invocation, action or content effect", async () => {
      const f = await runtimeApprovalResumeFixture();
      await f.approve();
      const claimed = await f.store.claimApproval({
        ...f.input,
        requestActionId: f.requestActionId,
      });
      expect(claimed.claim).not.toBeNull();
      const original = await f.requestAction();
      const request = npRequireAgentInstalledCapabilityInvocationRequestV1({
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: original.capabilityId,
        arguments: { input: original.inputCanonical, idempotencyKey: original.idempotencyKey },
      }) as NpAgentChangeSetCapabilityInvocationRequestV1;
      const first = await f.service.invokeRuntimeCapability({
        ...f.input,
        claim: claimed.claim!,
        sequence: original.sequence,
        request,
      });
      const second = await f.service.invokeRuntimeCapability({
        ...f.input,
        claim: claimed.claim!,
        sequence: original.sequence,
        request,
      });
      expect(first.invocationId).toBe(original.invocationId);
      expect(second.invocationId).toBe(first.invocationId);
      expect(await f.requestAction()).toEqual(original);
      expect(await f.db.select().from(npAgentActions)).toHaveLength(4);
      expect((await f.run()).state).toBe("running");
    });

    it("rejects request-key or sequence substitution on Runtime mutation replay", async () => {
      const f = await runtimeApprovalResumeFixture();
      await f.approve();
      const claimed = await f.store.claimApproval({
        ...f.input,
        requestActionId: f.requestActionId,
      });
      const original = await f.requestAction();
      const request = npRequireAgentInstalledCapabilityInvocationRequestV1({
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: original.capabilityId,
        arguments: { input: original.inputCanonical, idempotencyKey: randomUUID() },
      }) as NpAgentChangeSetCapabilityInvocationRequestV1;
      await expect(
        f.service.invokeRuntimeCapability({
          ...f.input,
          claim: claimed.claim!,
          sequence: original.sequence,
          request,
        }),
      ).rejects.toThrow();
      expect(await f.requestAction()).toEqual(original);
    });
  },
);
