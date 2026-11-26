import { npRequireAgentProviderSchemaValueV1 } from "../../../packages/core/src/agent/provider-auth-contract.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentEvents,
  npAgentIncidents,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents, npMemberSessions } from "../../../packages/core/src/db/schema/community.js";
import { npSessions, npSites, npUsers } from "../../../packages/core/src/db/schema/system.js";
import { createStaffSession } from "../../../packages/core/src/auth/session.js";
import { guardianSessionFixture } from "./agent-guardian-session-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Guardian approved exact browser session revocation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  for (const audience of ["staff", "member"] as const)
    it(`requires a distinct super administrator and atomically revokes only the selected ${audience} family`, async () => {
      const f = await guardianSessionFixture({ audience }),
        p = await f.plan();
      expect(p.current.target).toMatchObject({
        actorKind: audience,
        impact: "deployment",
        affectedSiteCount: 1,
        sessionFamilyId: f.session.id,
      });
      expect(p.approval.statementBody.requiredHumanPredicates).toEqual(["is-super-admin"]);
      const [planned] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.id, p.result.resourceId));
      const descriptor = planned.capabilityDefinitionBody.capabilities[0].descriptor;
      expect(() =>
        npRequireAgentProviderSchemaValueV1(descriptor.inputSchema, planned.inputCanonical),
      ).not.toThrow();
      expect(() =>
        npRequireAgentProviderSchemaValueV1(descriptor.inputSchema, p.command),
      ).toThrow();
      const readTarget = () =>
        audience === "staff"
          ? f.db.select().from(npSessions).where(eq(npSessions.id, f.session.id))
          : f.db.select().from(npMemberSessions).where(eq(npMemberSessions.id, f.session.id));
      expect(await readTarget()).toHaveLength(1);
      expect(await f.service.plan({ ...f.input, command: p.command })).toEqual({
        ...p.result,
        replayed: true,
      });
      await expect(f.decide(p.approval.id, f.actor)).rejects.toThrow();
      await expect(f.decide(p.approval.id, f.siteAdmin)).rejects.toThrow();
      await f.decide(p.approval.id);
      const detail = await f.approvals.get({
        siteId: "default",
        actor: f.approver,
        id: p.approval.id,
      });
      expect(detail.actionReview).toMatchObject({
        capabilityId: "security.revokeSessions",
        target: p.current.target,
      });
      expect((await f.service.get(f.input)).plans[0].canExecute).toBe(true);
      expect(await f.service.execute({ ...f.input, command: p.execute })).toEqual({
        resourceId: p.result.resourceId,
        replayed: false,
      });
      expect(await readTarget()).toHaveLength(0);
      expect(
        await f.db.select().from(npSessions).where(eq(npSessions.id, f.actor.sessionId)),
      ).toHaveLength(1);
      expect(await f.service.get(f.input)).toMatchObject({
        canPlan: false,
        plans: [{ state: "succeeded", canExecute: false }],
      });
      expect(await f.service.execute({ ...f.input, command: p.execute })).toEqual({
        resourceId: p.result.resourceId,
        replayed: true,
      });
      await expect(
        f.service.execute({ ...f.input, command: { ...p.execute, idempotencyKey: randomUUID() } }),
      ).rejects.toThrow();
      const [action] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.id, p.result.resourceId));
      expect(action).toMatchObject({
        state: "succeeded",
        verificationState: "passed",
        undoRef: null,
        compensatorId: null,
        containmentId: null,
        runId: null,
      });
      expect((await f.db.select().from(npAgentApprovals))[0].state).toBe("consumed");
      const revoked = await f.db
        .select()
        .from(npAgentEvents)
        .where(eq(npAgentEvents.kind, "auth.session.revoked"));
      expect(revoked).toHaveLength(1);
      expect(revoked[0].payload).toMatchObject({ audience, sessionFamilyId: f.session.id });
      expect(await f.db.select().from(npAgentRuns)).toEqual([]);
      expect(JSON.stringify(await f.service.get(f.input))).not.toMatch(
        /guardian-target@example|192\.0\.2\.71|principalId|accessToken|refreshToken/u,
      );
      f.setPolicy(null);
      expect((await f.service.get(f.input)).plans[0].state).toBe("succeeded");
      expect(
        (await f.approvals.get({ siteId: "default", actor: f.approver, id: p.approval.id }))
          .actionReview?.capabilityId,
      ).toBe("security.revokeSessions");
    });
  it("permits terminating the requester's own exact family and proves the committed result after re-login", async () => {
    const f = await guardianSessionFixture({ ownSession: true }),
      p = await f.plan();
    await f.decide(p.approval.id);
    await f.service.execute({ ...f.input, command: p.execute });
    await expect(f.service.get(f.input)).rejects.toThrow();
    const fresh = await createStaffSession(
      f.actor.user,
      "guardian-session-fixture-secret-for-local-tests-only",
      f.db,
      {
        accessExpiration: 600,
        refreshExpiration: 1200,
      },
    );
    const actor = { ...f.actor, sessionId: fresh.sessionId },
      input = { ...f.input, actor };
    expect((await f.service.get(input)).plans[0].state).toBe("succeeded");
    expect(await f.service.execute({ ...input, command: p.execute })).toEqual({
      resourceId: p.result.resourceId,
      replayed: true,
    });
    expect(
      await f.db.select().from(npSessions).where(eq(npSessions.id, fresh.sessionId)),
    ).toHaveLength(1);
  });
  it("enforces each viewer's Incident ACL before approval detail, challenge or decision", async () => {
    const f = await guardianSessionFixture(),
      p = await f.plan();
    f.hideFrom(f.approver.user.id);
    await expect(
      f.approvals.get({ siteId: "default", actor: f.approver, id: p.approval.id }),
    ).rejects.toThrow();
    await expect(f.decide(p.approval.id)).rejects.toThrow();
    expect((await f.db.select().from(npAgentApprovals))[0]).toMatchObject({
      state: "pending",
      challengeGeneration: 0,
      decidedByUserId: null,
    });
    expect(
      await f.db.select().from(npSessions).where(eq(npSessions.id, f.session.id)),
    ).toHaveLength(1);
  });
  for (const change of [
    "superadmin",
    "policy",
    "impact",
    "incident",
    "session",
    "reauth",
    "approver-acl",
  ] as const)
    it(`fails closed when ${change} changes after signed approval`, async () => {
      const f = await guardianSessionFixture(),
        p = await f.plan();
      await f.decide(p.approval.id);
      if (change === "superadmin")
        await f.db
          .update(npUsers)
          .set({ isSuperAdmin: false })
          .where(eq(npUsers.id, f.approver.user.id));
      if (change === "policy")
        f.setPolicy({ policyDigest: `cj1:sha256:${"C".repeat(43)}`, approvalLifetimeSeconds: 600 });
      if (change === "impact")
        await f.db.insert(npSites).values({ id: "guardian-other", name: "Other site" });
      if (change === "incident")
        await f.db
          .update(npAgentIncidents)
          .set({ versionNumber: p.current.incidentVersion + 1 })
          .where(eq(npAgentIncidents.id, f.input.incidentId));
      if (change === "session")
        await f.db
          .update(npSessions)
          .set({ createdAt: new Date(f.session.createdAt.getTime() + 1) })
          .where(eq(npSessions.id, f.session.id));
      if (change === "reauth") f.setRecent(false);
      if (change === "approver-acl") f.setApproverVisible(false);
      await expect(f.service.execute({ ...f.input, command: p.execute })).rejects.toThrow();
      expect((await f.db.select().from(npAgentApprovals))[0].state).toBe("approved");
      expect(
        await f.db.select().from(npSessions).where(eq(npSessions.id, f.session.id)),
      ).toHaveLength(1);
      expect(
        await f.db
          .select()
          .from(npAgentEvents)
          .where(eq(npAgentEvents.kind, "auth.session.revoked")),
      ).toEqual([]);
    });
  it("rolls session deletion and consumed approval back when the Action CAS writes zero rows", async () => {
    const f = await guardianSessionFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    await f.db.execute(
      sql`create or replace function np_test_guardian_session_skip() returns trigger language plpgsql as $$ begin if new.state='succeeded' then return null; end if; return new; end $$`,
    );
    await f.db.execute(
      sql`create trigger np_test_guardian_session_skip before update on np_agent_actions for each row execute function np_test_guardian_session_skip()`,
    );
    try {
      await expect(f.service.execute({ ...f.input, command: p.execute })).rejects.toThrow();
    } finally {
      await f.db.execute(sql`drop trigger np_test_guardian_session_skip on np_agent_actions`);
      await f.db.execute(sql`drop function np_test_guardian_session_skip()`);
    }
    expect(
      await f.db.select().from(npSessions).where(eq(npSessions.id, f.session.id)),
    ).toHaveLength(1);
    expect((await f.db.select().from(npAgentApprovals))[0].state).toBe("approved");
    expect((await f.db.select().from(npAgentActions))[0].state).toBe("approved");
    expect(
      await f.db.select().from(npAgentEvents).where(eq(npAgentEvents.kind, "auth.session.revoked")),
    ).toEqual([]);
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agent.guardian_session.effect")),
    ).toEqual([]);
  });
  it("refuses altered revocation source evidence and never dispatches another effect on retry", async () => {
    const f = await guardianSessionFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    await f.service.execute({ ...f.input, command: p.execute });
    const [event] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.kind, "auth.session.revoked"));
    if (event.payload.kind !== "auth.session.revoked") throw new Error("Expected revoke event");
    await f.db
      .update(npAgentEvents)
      .set({ payload: { ...event.payload, reasonCode: "ALTERED" } })
      .where(eq(npAgentEvents.id, event.id));
    await expect(f.service.get(f.input)).rejects.toThrow();
    await expect(f.service.execute({ ...f.input, command: p.execute })).rejects.toThrow();
    expect(
      await f.db.select().from(npAgentEvents).where(eq(npAgentEvents.kind, "auth.session.revoked")),
    ).toHaveLength(1);
  });
  it("allows protective revocation after target drift and reconciles an understood stale approval", async () => {
    const f = await guardianSessionFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    f.setPolicy(null);
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.sessionId));
    await f.decide(p.approval.id, f.approver, "revoke");
    expect((await f.db.select().from(npAgentActions))[0]).toMatchObject({
      state: "failed",
      errorCode: "APPROVAL_REVOKED",
    });
    expect(
      await f.db.select().from(npSessions).where(eq(npSessions.id, f.session.id)),
    ).toHaveLength(1);
  });
  it("uses signed target invalidation for known policy drift without treating unknown integrity as revocation", async () => {
    const f = await guardianSessionFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    f.setPolicy({ policyDigest: `cj1:sha256:${"D".repeat(43)}`, approvalLifetimeSeconds: 600 });
    expect(await f.approvals.reconcile({ siteId: "default" })).toMatchObject({
      examined: 1,
      revoked: 1,
      incidents: 0,
    });
    expect((await f.db.select().from(npAgentApprovals))[0]).toMatchObject({
      state: "revoked",
      revocationCode: "APPROVAL_TARGET_INVALIDATED",
      revocationKind: "target_invalidated",
    });
    expect((await f.db.select().from(npAgentActions))[0]).toMatchObject({
      state: "failed",
      errorCode: "APPROVAL_REVOKED",
    });
    expect(
      await f.db.select().from(npSessions).where(eq(npSessions.id, f.session.id)),
    ).toHaveLength(1);
  });
  it("rejects self-approval even when the requester is a current super administrator", async () => {
    const f = await guardianSessionFixture();
    await f.db.update(npUsers).set({ isSuperAdmin: true }).where(eq(npUsers.id, f.actor.user.id));
    const p = await f.plan();
    await expect(f.decide(p.approval.id, f.actor)).rejects.toMatchObject({
      code: "GUARDIAN_SESSION_CONFLICT",
    });
    expect((await f.db.select().from(npAgentApprovals))[0].state).toBe("pending");
  });
  it("does not execute against a concurrently changing deployment site catalog", async () => {
    const f = await guardianSessionFixture(),
      p = await f.plan();
    await f.decide(p.approval.id);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const catalog = f.db.transaction(async (tx) => {
      await tx.insert(npSites).values({ id: "guardian-concurrent-site", name: "Concurrent site" });
      entered();
      await gate;
    });
    await ready;
    try {
      await expect(f.service.execute({ ...f.input, command: p.execute })).rejects.toMatchObject({
        cause: { code: "55P03" },
      });
    } finally {
      release();
      await catalog;
    }
    await expect(f.service.execute({ ...f.input, command: p.execute })).rejects.toMatchObject({
      code: "APPROVAL_TARGET_CHANGED",
    });
    expect((await f.db.select().from(npAgentApprovals))[0].state).toBe("approved");
    expect(
      await f.db.select().from(npSessions).where(eq(npSessions.id, f.session.id)),
    ).toHaveLength(1);
    expect(
      await f.db.select().from(npAgentEvents).where(eq(npAgentEvents.kind, "auth.session.revoked")),
    ).toHaveLength(0);
  });
});
