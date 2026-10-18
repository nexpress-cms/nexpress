import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentGuardianControlsV1 } from "../../../packages/core/src/agent/guardian-controls.js";
import { createAgentGuardianResponseServiceV1 } from "../../../packages/core/src/agent/guardian-response-service.js";
import type { NpAgentRestrictionAdapter } from "../../../packages/core/src/agent-contract/restriction-adapter-contract.js";
import {
  npAgentActions,
  npAgentActorRestrictions,
  npAgentApprovals,
  npAgentRestrictionEnforcements,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { guardianResponseFixture } from "./agent-guardian-response-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    wait: async () => {
      enter();
      await released;
    },
  };
}
async function setup() {
  const state: {
    probe: ReturnType<typeof gate> | null;
    policy: ReturnType<typeof gate> | null;
    install: ReturnType<typeof gate> | null;
    visible: boolean;
    installs: number;
  } = { probe: null, policy: null, install: null, visible: true, installs: 0 };
  const f = await guardianResponseFixture((adapter): NpAgentRestrictionAdapter => ({
    ...adapter,
    install: async (descriptor, context) => {
      state.installs++;
      if (state.install) await state.install.wait();
      return adapter.install(descriptor, context);
    },
  }));
  const pending = async () =>
    (await f.db.select({ id: npAgentActorRestrictions.id }).from(npAgentActorRestrictions).limit(1))
      .length > 0;
  const service = createAgentGuardianResponseServiceV1({
    reads: f.reads,
    adapter: f.adapter,
    resolveApprovals: () => f.approvals,
    canEnforceSubject: async () => {
      if (state.probe && (await pending())) await state.probe.wait();
      return true;
    },
    resolvePolicy: async () => {
      if (state.policy && (await pending())) await state.policy.wait();
      return {
        policyDigest: `cj1:sha256:${"A".repeat(43)}`,
        maximumDurationSeconds: 3600,
        approvalLifetimeSeconds: 600,
        allowedScopes: ["auth.staff"],
      };
    },
    canReviewIncidentAsStaffUser: () => state.visible,
    admission: {
      reauthentication: {
        verify: () => ({
          reauthenticatedAt: f.now().toISOString(),
          sessionFactFingerprint: `cj1:sha256:${"B".repeat(43)}`,
        }),
      },
    },
    now: f.now,
  });
  const controls = createAgentGuardianControlsV1({
    deploymentActorFingerprint: `cj1:sha256:${"C".repeat(43)}`,
    registration: () =>
      Promise.resolve({ ready: true, sourceCount: 1, fingerprint: `cj1:sha256:${"D".repeat(43)}` }),
    now: f.now,
  });
  async function disable() {
    expect(
      await controls.disable({ siteId: f.input.siteId, reason: "Synthetic containment drill" }),
    ).toMatchObject({ outcome: "disabled" });
  }
  async function enable() {
    const prepared = await controls.prepareEnable({ siteId: f.input.siteId });
    if (!prepared.plan) throw new Error("Expected exact local enable plan");
    expect(
      await controls.enable({
        siteId: f.input.siteId,
        plan: prepared.plan,
        approval: prepared.plan.id,
      }),
    ).toMatchObject({ outcome: "enabled" });
  }
  return { ...f, service, controls, state, disable, enable };
}
describe.skipIf(skipIfNoTestDb())(
  "Guardian disable and serialized external dispatch admission",
  () => {
    beforeAll(ensureMigrated);
    beforeEach(async () => {
      await truncateAll();
      registerTestCollections();
    });
    afterAll(closeTestDb);

    for (const reenable of [false, true])
      it(`rejects an old approval after successful disable${reenable ? " and re-enable" : ""} during the nonlocking host probe`, async () => {
        const f = await setup(),
          p = await f.plan();
        await f.decide(p.approval.id);
        const probe = gate();
        f.state.probe = probe;
        const execution = f.service.execute({ ...f.input, command: p.execute });
        try {
          await probe.entered;
          await f.disable();
          if (reenable) await f.enable();
        } finally {
          probe.release();
        }
        await execution;
        expect(f.state.installs).toBe(0);
        expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
        const [restriction] = await f.db.select().from(npAgentActorRestrictions);
        expect(restriction).toMatchObject({
          state: "pending",
          installReceipt: null,
          lastErrorCode: "GUARDIAN_ENFORCEMENT_UNAVAILABLE",
        });
        expect((await f.db.select().from(npAgentActions))[0]).toMatchObject({
          state: "executing",
          verificationState: "unknown",
        });
        expect((await f.db.select().from(npAgentApprovals))[0].state).toBe("consumed");
        await f.service.reconcile({ siteId: f.input.siteId });
        expect(f.state.installs).toBe(0);
        await f.service.execute({ ...f.input, command: p.execute });
        expect(f.state.installs).toBe(0);
        f.setTime(new Date(restriction.expiresAt));
        expect(await f.service.reconcile({ siteId: f.input.siteId })).toMatchObject({
          resolved: 1,
        });
        expect((await f.db.select().from(npAgentActorRestrictions))[0].state).toBe("expired");
        expect((await f.db.select().from(npAgentActions))[0]).toMatchObject({
          state: "failed",
          errorCode: "GUARDIAN_ACTIVATION_UNVERIFIED",
        });
      });

    it("rechecks current approver item authority inside admission after a policy probe resumes", async () => {
      const f = await setup(),
        p = await f.plan();
      await f.decide(p.approval.id);
      const policy = gate();
      f.state.policy = policy;
      const execution = f.service.execute({ ...f.input, command: p.execute });
      try {
        await policy.entered;
        f.state.visible = false;
      } finally {
        policy.release();
      }
      await execution;
      expect(f.state.installs).toBe(0);
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
      expect((await f.db.select().from(npAgentActorRestrictions))[0]).toMatchObject({
        state: "pending",
        installReceipt: null,
      });
    });

    it("rejects lost requester session authority between the host probe and serialized admission", async () => {
      const f = await setup(),
        p = await f.plan();
      await f.decide(p.approval.id);
      const probe = gate();
      f.state.probe = probe;
      const execution = f.service.execute({ ...f.input, command: p.execute });
      try {
        await probe.entered;
        await f.db
          .update(npSessions)
          .set({ accessExpiresAt: new Date(0) })
          .where(eq(npSessions.id, f.actor.sessionId));
      } finally {
        probe.release();
      }
      await execution;
      expect(f.state.installs).toBe(0);
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
      expect((await f.db.select().from(npAgentActorRestrictions))[0]).toMatchObject({
        state: "pending",
        installReceipt: null,
      });
    });

    it("bounds a stalled admission callback and never dispatches its late continuation", async () => {
      const f = await setup(),
        p = await f.plan();
      await f.decide(p.approval.id);
      const policy = gate();
      f.state.policy = policy;
      const execution = f.service.execute({ ...f.input, command: p.execute });
      try {
        await policy.entered;
        await execution;
        await f.disable();
        expect(f.state.installs).toBe(0);
      } finally {
        policy.release();
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(f.state.installs).toBe(0);
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
      expect((await f.db.select().from(npAgentActorRestrictions))[0]).toMatchObject({
        state: "pending",
        installReceipt: null,
      });
    });

    it("allows already-admitted external I/O to complete after disable without treating abort as undo", async () => {
      const f = await setup(),
        p = await f.plan();
      await f.decide(p.approval.id);
      const install = gate();
      f.state.install = install;
      const execution = f.service.execute({ ...f.input, command: p.execute });
      try {
        await install.entered;
        await f.disable();
      } finally {
        install.release();
      }
      await execution;
      expect(f.state.installs).toBe(1);
      expect((await f.db.select().from(npAgentActorRestrictions))[0]).toMatchObject({
        state: "active",
        installReceipt: expect.any(Object),
      });
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toHaveLength(1);
      expect(await f.service.execute({ ...f.input, command: p.execute })).toMatchObject({
        replayed: true,
      });
      expect(f.state.installs).toBe(1);
    });

    for (const decision of ["reject", "revoke"] as const)
      it(`retains authenticated ${decision} of an old approval while disabled`, async () => {
        const f = await setup(),
          p = await f.plan();
        if (decision === "revoke") await f.decide(p.approval.id);
        await f.disable();
        const target = p.approval.statementBody.target;
        if (target.kind !== "action") throw new Error("Expected exact Guardian Action target");
        const reviewInput = {
          siteId: f.input.siteId,
          target,
          actor: f.approver,
        };
        expect(await f.service.approvalTargets.visible(reviewInput)).toMatchObject({
          operationCount: 1,
        });
        expect(await f.service.approvalTargets.actionReview?.(reviewInput)).toMatchObject({
          actionId: p.result.resourceId,
          capabilityId: "security.limitActor",
          policyDigest: p.approval.statementBody.policyHashes[0],
        });
        await f.decide(p.approval.id, f.approver, decision);
        expect((await f.db.select().from(npAgentApprovals))[0].state).toBe(
          decision === "reject" ? "rejected" : "revoked",
        );
        expect((await f.db.select().from(npAgentActions))[0]).toMatchObject({
          state: "failed",
          errorCode: decision === "reject" ? "APPROVAL_REJECTED" : "APPROVAL_REVOKED",
        });
        expect(f.state.installs).toBe(0);
      });

    it("preserves approved early removal, disabled verification and terminal replay", async () => {
      const f = await setup(),
        p = await f.plan();
      await f.decide(p.approval.id);
      await f.service.execute({ ...f.input, command: p.execute });
      const [restriction] = await f.db.select().from(npAgentActorRestrictions);
      expect(restriction.state).toBe("active");
      await f.disable();
      const removal = await f.plan({
        kind: "remove",
        restrictionId: restriction.id,
        sourceActionId: restriction.sourceActionId,
      });
      await f.decide(removal.approval.id);
      await f.service.execute({ ...f.input, command: removal.execute });
      expect(
        (
          await f.db
            .select()
            .from(npAgentActorRestrictions)
            .where(eq(npAgentActorRestrictions.id, restriction.id))
        )[0].state,
      ).toBe("removed");
      expect(await f.service.execute({ ...f.input, command: removal.execute })).toMatchObject({
        replayed: true,
      });
      expect(f.state.installs).toBe(1);
    });
  },
);
