import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentInvocations,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npAuditEvents,
  npBans,
  npMembers,
} from "../../../packages/core/src/db/schema/community.js";
import { npSessions, npUsers } from "../../../packages/core/src/db/schema/system.js";
import { resetCommunityMemberReportObserverV1 } from "../../../packages/core/src/community/member-report-observer.js";
import { issueBan } from "../../../packages/core/src/community/bans.js";
import { isMemberBanned } from "../../../packages/core/src/community/can.js";
import { resolveReport } from "../../../packages/core/src/community/reports.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
  seedActiveMember,
} from "./harness.js";
import { memberResponseFixture } from "./agent-member-response-fixture.js";

describe.skipIf(skipIfNoTestDb())("explicit approved current-site Member response", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(resetCommunityMemberReportObserverV1);
  afterAll(closeTestDb);

  it("requires a distinct signed human Approval, enforces the actual temporary site ban and revokes only its exact owned row", async () => {
    const f = await memberResponseFixture();
    const prepared = await f.plan();
    expect(await f.db.select().from(npBans)).toEqual([]);
    expect(await f.service.plan({ ...f.input, command: prepared.command })).toEqual({
      ...prepared.result,
      replayed: true,
    });
    await expect(f.decide(prepared.approval.id, f.actor)).rejects.toMatchObject({
      code: "MEMBER_RESPONSE_CONFLICT",
    });
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("pending");
    await f.decide(prepared.approval.id);
    const approved = await f.approvals.get({
      siteId: f.input.siteId,
      actor: f.approver,
      id: prepared.approval.id,
    });
    expect(approved.item.approval.state).toBe("approved");
    expect(approved.actionReview).toMatchObject({
      capabilityId: "moderation.member.restrict",
      memberId: f.target.memberId,
      operation: { kind: "restrict", durationSeconds: 600 },
    });
    const result = await f.service.execute({ ...f.input, command: prepared.execute });
    const [ban] = await f.db.select().from(npBans);
    expect(ban).toMatchObject({
      siteId: "default",
      memberId: f.target.memberId,
      scopeType: "site",
      scopeId: null,
      kind: "temporary",
      byUserId: f.actor.user.id,
      byMemberId: null,
      reason: `Agent Member response ${result.resourceId}`,
    });
    expect(ban.expiresAt?.getTime()).toBe(f.now().getTime() + 600000);
    expect(
      await withCurrentSite("default", () => isMemberBanned(f.target.memberId, [], f.db, f.now())),
    ).toBe(true);
    expect(
      await withCurrentSite("other-site", () =>
        isMemberBanned(f.target.memberId, [], f.db, f.now()),
      ),
    ).toBe(false);
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("consumed");
    const [action] = await f.db.select().from(npAgentActions);
    expect(action).toMatchObject({
      state: "succeeded",
      containmentId: null,
      runId: null,
      verificationState: "passed",
      verifierId: "member.restrict.verify",
    });
    expect(await f.service.execute({ ...f.input, command: prepared.execute })).toEqual({
      ...result,
      replayed: true,
    });
    expect(await f.db.select().from(npBans)).toHaveLength(1);
    await expect(
      f.service.execute({
        ...f.input,
        command: { ...prepared.execute, idempotencyKey: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    const manual = await withCurrentSite("default", () =>
      issueBan({
        memberId: f.target.memberId,
        scopeType: "site",
        kind: "permanent",
        actor: { kind: "staff", user: f.actor.user },
      }),
    );
    const current = await f.service.get(f.input);
    expect(current.revocable).toEqual([
      { sourceActionId: result.resourceId, banId: ban.id, expiresAt: ban.expiresAt!.toISOString() },
    ]);
    const revoke = await f.plan({
      kind: "revoke",
      sourceActionId: result.resourceId,
      banId: ban.id,
    });
    await f.decide(revoke.approval.id);
    await f.service.execute({ ...f.input, command: revoke.execute });
    expect((await f.db.select().from(npBans)).map((row) => row.id)).toEqual([manual.id]);
    expect(
      await withCurrentSite("default", () => isMemberBanned(f.target.memberId, [], f.db, f.now())),
    ).toBe(true);
    const effects = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agent.member_response.effect"));
    expect(effects).toHaveLength(2);
    expect(effects[1].payload).toMatchObject({
      sourceActionId: result.resourceId,
      ban: { id: ban.id },
    });
  });

  it("requires explicit policy, bounded duration, current Member/report relationship and exact versions", async () => {
    const f = await memberResponseFixture();
    f.setPolicy(null);
    await expect(f.service.get(f.input)).rejects.toMatchObject({
      code: "MEMBER_RESPONSE_UNAVAILABLE",
    });
    f.setPolicy({
      policyDigest: `cj1:sha256:${"A".repeat(43)}`,
      maximumDurationSeconds: 30,
      approvalLifetimeSeconds: 60,
    });
    await expect(f.plan({ kind: "restrict", durationSeconds: 31 })).rejects.toMatchObject({
      code: "MEMBER_RESPONSE_CONFLICT",
    });
    const current = await f.service.get(f.input);
    const foreign = await seedActiveMember({ handle: `foreign-${randomUUID().slice(0, 10)}` });
    await expect(
      f.service.plan({
        ...f.input,
        command: {
          schemaVersion: "np.agent-member-response-plan-input.v1",
          expectedVersion: current.incidentVersion,
          memberId: foreign.memberId,
          expectedMemberVersionDigest: current.memberVersionDigest,
          operation: { kind: "restrict", durationSeconds: 30 },
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    const prepared = await f.plan({ kind: "restrict", durationSeconds: 30 });
    await f.decide(prepared.approval.id);
    await f.db
      .update(npMembers)
      .set({ status: "suspended", updatedAt: f.now() })
      .where(eq(npMembers.id, f.target.memberId));
    await expect(
      f.service.execute({ ...f.input, command: prepared.execute }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    expect(await f.db.select().from(npBans)).toEqual([]);
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("approved");
    await f.db
      .update(npMembers)
      .set({ status: "active" })
      .where(eq(npMembers.id, f.target.memberId));
    await withCurrentSite("default", () =>
      resolveReport({
        reportId: f.reports[0].id,
        action: "dismiss",
        actor: { kind: "staff", user: f.actor.user },
      }),
    );
    await expect(
      f.service.execute({ ...f.input, command: prepared.execute }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    expect(await f.db.select().from(npBans)).toEqual([]);
  });

  it("rechecks current approver authority, execution reauthentication, policy and expiry before consuming approval", async () => {
    const f = await memberResponseFixture();
    const prepared = await f.plan();
    await f.decide(prepared.approval.id);
    f.setRecent(false);
    await expect(
      f.service.execute({ ...f.input, command: prepared.execute }),
    ).rejects.toMatchObject({ code: "RECENT_REAUTHENTICATION_REQUIRED" });
    f.setRecent(true);
    f.setApproverVisible(false);
    await expect(
      f.service.execute({ ...f.input, command: prepared.execute }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("approved");
    f.setApproverVisible(true);
    await f.db.update(npUsers).set({ role: "viewer" }).where(eq(npUsers.id, f.approver.user.id));
    await expect(
      f.service.execute({ ...f.input, command: prepared.execute }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    await f.db.update(npUsers).set({ role: "admin" }).where(eq(npUsers.id, f.approver.user.id));
    f.setPolicy({
      policyDigest: `cj1:sha256:${"C".repeat(43)}`,
      maximumDurationSeconds: 3600,
      approvalLifetimeSeconds: 600,
    });
    await expect(
      f.service.execute({ ...f.input, command: prepared.execute }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    f.setPolicy({
      policyDigest: `cj1:sha256:${"A".repeat(43)}`,
      maximumDurationSeconds: 3600,
      approvalLifetimeSeconds: 600,
    });
    f.setTime(new Date(prepared.approval.expiresAt));
    await expect(
      f.service.execute({ ...f.input, command: prepared.execute }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    expect(await f.db.select().from(npBans)).toEqual([]);
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("approved");
  });

  it("preserves owned historical proof after requester tombstoning, denies pending execution and allows a fresh distinct-human revocation", async () => {
    const f = await memberResponseFixture();
    const prepared = await f.plan({ kind: "restrict", durationSeconds: 1200 });
    await f.decide(prepared.approval.id);
    await f.service.execute({ ...f.input, command: prepared.execute });
    const [ban] = await f.db.select().from(npBans);
    expect(
      await withCurrentSite("default", () =>
        isMemberBanned(f.target.memberId, [], f.db, new Date(ban.expiresAt!.getTime() - 1)),
      ),
    ).toBe(true);
    expect(
      await withCurrentSite("default", () =>
        isMemberBanned(f.target.memberId, [], f.db, ban.expiresAt!),
      ),
    ).toBe(false);
    const pendingRevoke = await f.plan({
      kind: "revoke",
      sourceActionId: prepared.result.resourceId,
      banId: ban.id,
    });
    await f.decide(pendingRevoke.approval.id);
    const gateway = createAgentGatewayServiceV1({
      tokenHashKeyring: {
        active: { id: "member-response-tombstone", key: new Uint8Array(32).fill(77) },
      },
      now: f.now,
      environment: "production",
    });
    await gateway.containUserAuthorityLoss(f.actor.user.id);
    const [tombstone] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(
        eq(
          npAgentInvocations.id,
          (
            await f.db
              .select()
              .from(npAgentActions)
              .where(eq(npAgentActions.id, prepared.result.resourceId))
          )[0].invocationId!,
        ),
      );
    expect(tombstone).toMatchObject({ staffUserId: null, actorDeletedAt: f.now() });
    await expect(
      f.service.execute({ ...f.input, command: pendingRevoke.execute }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.sessionId));
    expect((await f.service.get({ ...f.input, actor: f.approver })).revocable).toEqual([
      {
        sourceActionId: prepared.result.resourceId,
        banId: ban.id,
        expiresAt: ban.expiresAt!.toISOString(),
      },
    ]);
    const replacementApprover = await f.staff();
    const revoke = await f.plan(
      { kind: "revoke", sourceActionId: prepared.result.resourceId, banId: ban.id },
      f.approver,
    );
    await f.decide(revoke.approval.id, replacementApprover);
    await f.service.execute({ ...f.input, actor: f.approver, command: revoke.execute });
    expect(await f.db.select().from(npBans)).toEqual([]);
  });

  it("does not duplicate concurrent executions and retains exact idempotent recovery after a serialization conflict", async () => {
    const f = await memberResponseFixture();
    const prepared = await f.plan();
    await f.decide(prepared.approval.id);
    const results = await Promise.allSettled([
      f.service.execute({ ...f.input, command: prepared.execute }),
      f.service.execute({ ...f.input, command: prepared.execute }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(await f.db.select().from(npBans)).toHaveLength(1);
    expect(await f.service.execute({ ...f.input, command: prepared.execute })).toMatchObject({
      replayed: true,
    });
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agent.member_response.effect")),
    ).toHaveLength(1);
  });

  it("rolls back the actual ban, consumed Approval, invocation and effect proof when mandatory audit persistence fails", async () => {
    const f = await memberResponseFixture();
    const prepared = await f.plan();
    await f.decide(prepared.approval.id);
    await f.db.execute(
      sql`create function np_test_member_response_audit_fail() returns trigger language plpgsql as $$ begin if NEW.action='agent.member_response.effect' then raise exception 'fixture mandatory audit failure'; end if; return NEW; end $$`,
    );
    await f.db.execute(
      sql`create trigger np_test_member_response_audit_fail before insert on np_audit_events for each row execute function np_test_member_response_audit_fail()`,
    );
    try {
      await expect(f.service.execute({ ...f.input, command: prepared.execute })).rejects.toThrow();
      expect(await f.db.select().from(npBans)).toEqual([]);
      expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("approved");
      expect((await f.db.select().from(npAgentActions))[0]).toMatchObject({
        state: "approved",
        effectDigest: null,
      });
      expect(
        await f.db
          .select()
          .from(npAgentInvocations)
          .where(eq(npAgentInvocations.operationId, "agents.incidents.member_response_execute")),
      ).toEqual([]);
    } finally {
      await f.db.execute(sql`drop trigger np_test_member_response_audit_fail on np_audit_events`);
      await f.db.execute(sql`drop function np_test_member_response_audit_fail()`);
    }
    await f.service.execute({ ...f.input, command: prepared.execute });
    expect(await f.db.select().from(npBans)).toHaveLength(1);
  });

  it("refuses manual restrictions and changed owned restriction facts even with an otherwise valid signed revoke approval", async () => {
    const f = await memberResponseFixture();
    const prepared = await f.plan();
    await f.decide(prepared.approval.id);
    await f.service.execute({ ...f.input, command: prepared.execute });
    const [ban] = await f.db.select().from(npBans);
    const manual = await withCurrentSite("default", () =>
      issueBan({
        memberId: f.target.memberId,
        scopeType: "collection",
        scopeId: "posts",
        kind: "permanent",
        actor: { kind: "staff", user: f.actor.user },
      }),
    );
    await expect(
      f.plan({ kind: "revoke", sourceActionId: prepared.result.resourceId, banId: manual.id }),
    ).rejects.toMatchObject({ code: "MEMBER_RESPONSE_CONFLICT" });
    const revoke = await f.plan({
      kind: "revoke",
      sourceActionId: prepared.result.resourceId,
      banId: ban.id,
    });
    await f.decide(revoke.approval.id);
    await f.db
      .update(npBans)
      .set({ expiresAt: new Date(ban.expiresAt!.getTime() + 1000) })
      .where(and(eq(npBans.siteId, "default"), eq(npBans.id, ban.id)));
    await expect(f.service.execute({ ...f.input, command: revoke.execute })).rejects.toMatchObject({
      code: "MEMBER_RESPONSE_CONFLICT",
    });
    expect(await f.db.select().from(npBans)).toHaveLength(2);
    const [approval] = await f.db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.id, revoke.approval.id));
    expect(approval.state).toBe("approved");
  });
});
