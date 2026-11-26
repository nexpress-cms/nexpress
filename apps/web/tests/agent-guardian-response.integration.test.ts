import { npDeleteAgentSiteRows } from "../../../packages/core/src/agent/site-deletion.js";
import { npDigestAgentRestrictionCanonical } from "../../../packages/core/src/agent-contract/canonical-restriction.js";
import { npAgentRestrictionSubjectKeyV1 } from "../../../packages/core/src/agent-contract/restriction-adapter-contract.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentActorRestrictions,
  npAgentApprovals,
  npAgentRestrictionEnforcements,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { createAgentGuardianActorProjectionV1 } from "../../../packages/core/src/agent/guardian-actor-projection.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import { guardianResponseFixture } from "./agent-guardian-response-fixture.js";
const subject = (siteId = "default") => ({
  kind: "opaque_actor_bucket" as const,
  ...createAgentGuardianActorProjectionV1({
    id: "guardian-response-key",
    bytes: new Uint8Array(32).fill(91),
  }).project({ siteId, purpose: "network-address", value: "192.0.2.42" }),
});
async function decision(
  f: Awaited<ReturnType<typeof guardianResponseFixture>>,
  siteId = "default",
  scope: "auth.staff" | "auth.member" = "auth.staff",
) {
  return f.adapter.check(
    {
      schemaVersion: "np.agent-restriction-check.v1",
      siteId,
      subjects: [subject(siteId)],
      actionScope: scope,
      observedAt: f.now().toISOString(),
    },
    { signal: AbortSignal.timeout(1000) },
  );
}
describe.skipIf(skipIfNoTestDb())("Guardian approved temporary request limit lifecycle", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("uses a distinct signed approval to limit only exact site/scope and then remove the owned restriction", async () => {
    const f = await guardianResponseFixture(),
      p = await f.plan();
    expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
    expect(await f.service.plan({ ...f.input, command: p.command })).toEqual({
      ...p.result,
      replayed: true,
    });
    await expect(f.decide(p.approval.id, f.actor)).rejects.toMatchObject({
      code: "GUARDIAN_RESPONSE_CONFLICT",
    });
    await f.decide(p.approval.id);
    expect(
      (await f.approvals.get({ siteId: f.input.siteId, actor: f.approver, id: p.approval.id }))
        .actionReview,
    ).toMatchObject({
      capabilityId: "security.limitActor",
      operation: { kind: "limit", durationSeconds: 600, actionScopes: ["auth.staff"] },
    });
    await f.service.execute({ ...f.input, command: p.execute });
    expect(await decision(f)).toMatchObject({ decision: "deny" });
    expect(await decision(f, "other-site")).toMatchObject({ decision: "allow" });
    expect(await decision(f, "default", "auth.member")).toMatchObject({ decision: "allow" });
    const [row] = await f.db.select().from(npAgentActorRestrictions);
    expect(row).toMatchObject({
      state: "active",
      sourceActionId: p.result.resourceId,
      rowVersion: 2,
      lastErrorCode: null,
    });
    expect((await f.db.select().from(npAgentApprovals))[0].state).toBe("consumed");
    const audits = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agent.guardian_response.effect"));
    expect(audits).toHaveLength(1);
    expect(await f.service.reconcile({ siteId: "default" })).toEqual({ checked: 0, resolved: 0 });
    expect((await f.db.select().from(npAgentActorRestrictions))[0].installReceipt).toEqual(
      row.installReceipt,
    );
    const remove = await f.plan({
      kind: "remove",
      sourceActionId: row.sourceActionId,
      restrictionId: row.id,
    });
    await f.decide(remove.approval.id);
    await f.service.execute({ ...f.input, command: remove.execute });
    expect(await decision(f)).toMatchObject({ decision: "allow" });
    expect((await f.db.select().from(npAgentActorRestrictions))[0]).toMatchObject({
      state: "removed",
      removalActionId: remove.result.resourceId,
    });
    expect(
      (await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, row.sourceActionId)))[0]
        .state,
    ).toBe("compensated");
    expect(await f.db.select().from(npAgentRuns)).toEqual([]);
    expect(JSON.stringify(await f.service.get(f.input))).not.toMatch(
      /192\.0\.2\.42|private@example|"bucket"/,
    );
    await npDeleteAgentSiteRows(f.db, "default");
    expect(await f.db.select().from(npAgentActorRestrictions)).toEqual([]);
    expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
  });
  it("restores access at TTL without a worker and confirms cleanup through explicit maintenance without replaying install", async () => {
    const f = await guardianResponseFixture(),
      p = await f.plan({ kind: "limit", durationSeconds: 60, actionScopes: ["auth.staff"] });
    await f.decide(p.approval.id);
    await f.service.execute({ ...f.input, command: p.execute });
    const [row] = await f.db.select().from(npAgentActorRestrictions);
    f.setTime(new Date(row.expiresAt));
    expect(await decision(f)).toMatchObject({ decision: "allow" });
    expect((await f.db.select().from(npAgentActorRestrictions))[0].state).toBe("active");
    expect(await f.service.reconcile({ siteId: "default" })).toEqual({ checked: 1, resolved: 1 });
    expect((await f.db.select().from(npAgentActorRestrictions))[0].state).toBe("expired");
    const action = (await f.db.select().from(npAgentActions))[0];
    expect(action.state).toBe("compensated");
    expect(action.compensationEvidence).toHaveLength(1);
    expect(await f.service.reconcile({ siteId: "default" })).toEqual({ checked: 0, resolved: 0 });
  });
  it("retains unknown dispatch, checks actual persisted effect and prevents late installation after approved removal", async () => {
    let loseReceipt = true;
    const f = await guardianResponseFixture((adapter) => ({
      ...adapter,
      install: async (d, c) => {
        const r = await adapter.install(d, c);
        if (loseReceipt) throw new Error("lost receipt");
        return r;
      },
    }));
    const p = await f.plan();
    await f.decide(p.approval.id);
    await f.service.execute({ ...f.input, command: p.execute });
    let [row] = await f.db.select().from(npAgentActorRestrictions);
    expect(row).toMatchObject({
      state: "pending",
      lastErrorCode: "GUARDIAN_ENFORCEMENT_UNAVAILABLE",
    });
    expect(await decision(f)).toMatchObject({ decision: "deny" });
    expect((await f.db.select().from(npAgentActions))[0].state).toBe("executing");
    loseReceipt = false;
    await f.service.execute({
      ...f.input,
      command: { ...p.execute, idempotencyKey: randomUUID() },
    });
    [row] = await f.db.select().from(npAgentActorRestrictions);
    expect(row.state).toBe("active");
    const remove = await f.plan({
      kind: "remove",
      sourceActionId: row.sourceActionId,
      restrictionId: row.id,
    });
    await f.decide(remove.approval.id);
    await f.service.execute({ ...f.input, command: remove.execute });
    await expect(
      f.adapter.install(row.descriptor, {
        idempotencyKey: `install:${row.id}:1`,
        expectedRowVersion: 1,
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow();
    expect(await decision(f)).toMatchObject({ decision: "allow" });
  });
  it("rechecks changed policy, source version, current approver and distinct scope before any effect", async () => {
    const f = await guardianResponseFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    f.setApproverVisible(false);
    await expect(f.service.execute({ ...f.input, command: p.execute })).rejects.toThrow();
    f.setApproverVisible(true);
    f.setPolicy({
      policyDigest: `cj1:sha256:${"C".repeat(43)}`,
      maximumDurationSeconds: 60,
      approvalLifetimeSeconds: 600,
      allowedScopes: ["auth.staff"],
    });
    await expect(f.service.execute({ ...f.input, command: p.execute })).rejects.toThrow();
    expect(await f.db.select().from(npAgentActorRestrictions)).toEqual([]);
    expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
    expect((await f.db.select().from(npAgentApprovals))[0].state).toBe("approved");
    await expect(f.service.get({ ...f.input, siteId: "other-site" })).rejects.toThrow();
  });
  it("serializes concurrent execution and cleanup, preserves exact canonical evidence under tampering", async () => {
    const f = await guardianResponseFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    const results = await Promise.allSettled([
      f.service.execute({ ...f.input, command: p.execute }),
      f.service.execute({ ...f.input, command: p.execute }),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await f.db.select().from(npAgentActorRestrictions)).toHaveLength(1);
    expect(await f.db.select().from(npAgentRestrictionEnforcements)).toHaveLength(1);
    const [row] = await f.db.select().from(npAgentActorRestrictions);
    if (row.descriptor.subject.kind !== "opaque_actor_bucket")
      throw new Error("Expected network subject");
    const tampered = {
      ...row.descriptor,
      subject: { ...row.descriptor.subject, bucket: "D".repeat(42) + "A" },
    };
    await f.db
      .update(npAgentActorRestrictions)
      .set({
        descriptor: tampered,
        restrictionHash: await npDigestAgentRestrictionCanonical(tampered),
        subjectKey: npAgentRestrictionSubjectKeyV1(tampered.subject),
      })
      .where(eq(npAgentActorRestrictions.id, row.id));
    await expect(f.service.get(f.input)).rejects.toThrow();
    f.setTime(new Date(row.expiresAt));
    expect(await f.service.reconcile({ siteId: "default" })).toMatchObject({ resolved: 0 });
    expect((await f.db.select().from(npAgentActorRestrictions))[0].state).toBe("active");
    await f.db
      .update(npAgentActorRestrictions)
      .set({
        descriptor: row.descriptor,
        restrictionHash: row.restrictionHash,
        subjectKey: row.subjectKey,
      })
      .where(eq(npAgentActorRestrictions.id, row.id));
    await f.service.reconcile({ siteId: "default" });
    expect((await f.db.select().from(npAgentActorRestrictions))[0].state).toBe("expired");
    await f.db.execute(sql`select 1`);
  });
  it("rechecks policy after the committed admission before dispatch and cleans unknown activation without claiming success", async () => {
    const f = await guardianResponseFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    f.revokeAfterStage();
    await f.service.execute({ ...f.input, command: p.execute });
    expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
    const [row] = await f.db.select().from(npAgentActorRestrictions);
    expect(row.state).toBe("pending");
    f.setTime(new Date(row.expiresAt));
    await f.service.reconcile({ siteId: "default" });
    expect((await f.db.select().from(npAgentActorRestrictions))[0].state).toBe("expired");
    expect((await f.db.select().from(npAgentActions))[0]).toMatchObject({
      state: "failed",
      errorCode: "GUARDIAN_ACTIVATION_UNVERIFIED",
    });
  });
  it("never treats an unexecuted removal plan as cleanup authority", async () => {
    const f = await guardianResponseFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    await f.service.execute({ ...f.input, command: p.execute });
    const [row] = await f.db.select().from(npAgentActorRestrictions);
    const removal = await f.plan({
      kind: "remove",
      sourceActionId: row.sourceActionId,
      restrictionId: row.id,
    });
    await f.db
      .update(npAgentActorRestrictions)
      .set({ state: "removing", removalActionId: removal.result.resourceId })
      .where(eq(npAgentActorRestrictions.id, row.id));
    expect(await f.service.reconcile({ siteId: "default" })).toMatchObject({ resolved: 0 });
    expect(await decision(f)).toMatchObject({ decision: "deny" });
    expect(
      (
        await f.db
          .select()
          .from(npAgentApprovals)
          .where(eq(npAgentApprovals.id, removal.approval.id))
      )[0].state,
    ).toBe("pending");
  });
  it("rolls back consumed approval and execution when removal loses its CAS write", async () => {
    const f = await guardianResponseFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    await f.service.execute({ ...f.input, command: p.execute });
    const [row] = await f.db.select().from(npAgentActorRestrictions);
    const removal = await f.plan({
      kind: "remove",
      sourceActionId: row.sourceActionId,
      restrictionId: row.id,
    });
    await f.decide(removal.approval.id);
    await f.db.execute(
      sql`create function np_guardian_cas_test() returns trigger language plpgsql as $$ begin if new.state='removing' then return null; end if; return new; end $$`,
    );
    await f.db.execute(
      sql`create trigger np_guardian_cas_test before update on np_agent_actor_restrictions for each row execute function np_guardian_cas_test()`,
    );
    try {
      await expect(
        f.service.execute({ ...f.input, command: removal.execute }),
      ).rejects.toMatchObject({ code: "GUARDIAN_RESPONSE_CONFLICT" });
      expect(
        (
          await f.db
            .select()
            .from(npAgentApprovals)
            .where(eq(npAgentApprovals.id, removal.approval.id))
        )[0].state,
      ).toBe("approved");
      expect(
        (
          await f.db
            .select()
            .from(npAgentActions)
            .where(eq(npAgentActions.id, removal.result.resourceId))
        )[0],
      ).toMatchObject({ state: "approved", executionInvocationId: null });
      expect((await f.db.select().from(npAgentActorRestrictions))[0]).toMatchObject({
        state: "active",
        removalActionId: null,
      });
    } finally {
      await f.db.execute(sql`drop trigger np_guardian_cas_test on np_agent_actor_restrictions`);
      await f.db.execute(sql`drop function np_guardian_cas_test()`);
    }
    await f.service.execute({ ...f.input, command: removal.execute });
    expect(await decision(f)).toMatchObject({ decision: "allow" });
  });
});
