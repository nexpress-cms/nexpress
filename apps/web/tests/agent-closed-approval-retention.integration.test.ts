import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentChangesets,
  npAgentChangesetExecutions,
  npAgentInvocations,
  npAgentRuns,
  npAgentSourceReleases,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { PgBossAdapter } from "../../../packages/core/src/jobs/pg-boss-adapter.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/contract-diagnostics.js";
import { runtimeApprovalResumeFixture } from "./agent-runtime-approval-resume-fixture.js";
import { decideApproval } from "./agent-changeset-execution-fixture.js";
import { runtimeFingerprint, siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof runtimeApprovalResumeFixture>>;
const day = 86_400_000;
const identity = (f: Fixture) => ({ siteId, actor: f.actor.actor, id: f.required.approvalId });
const sweep = (f: Fixture) => pruneAgentRuntimeEventsV1({ siteId, now: f.options.now() });

async function reject(f: Fixture) {
  return decideApproval(
    f.service.approvals!,
    f.actor,
    await f.service.approvals!.get(identity(f)),
    "reject",
  );
}
async function cancel(f: Fixture, state: "ready") {
  await f.service.cancel({
    actor: f.actor,
    id: f.sealed.id,
    command: {
      schemaVersion: "np.agent-changeset-cancel-input.v1",
      expectedDraftVersion: f.sealed.draftVersion,
      expectedState: state,
      planHash: f.sealed.planHash,
      reasonCode: "OPERATOR_CANCELLED",
      reason: null,
      idempotencyKey: randomUUID(),
    },
  });
  await f.store.cancel(f.input);
}
async function ageAndClean(f: Fixture) {
  f.advance(91 * 86_400);
  const [original] = await f.db
    .select()
    .from(npSessions)
    .where(eq(npSessions.id, f.actor.actor.sessionId));
  const id = randomUUID();
  const now = f.options.now();
  await f.db.insert(npSessions).values({
    ...original,
    id,
    accessTokenHash: randomUUID(),
    refreshTokenHash: randomUUID(),
    createdAt: now,
    updatedAt: now,
    accessExpiresAt: new Date(now.getTime() + day),
    refreshExpiresAt: new Date(now.getTime() + 7 * day),
  });
  f.actor.actor.sessionId = id;
  await f.service.reconcilePreviews({ siteId });
}
async function evidence(f: Fixture) {
  return {
    approvals: await f.db.select().from(npAgentApprovals).orderBy(npAgentApprovals.id),
    invocations: await f.db.select().from(npAgentInvocations).orderBy(npAgentInvocations.id),
    audits: await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id),
  };
}
async function expectRetained(f: Fixture, before: Awaited<ReturnType<typeof evidence>>) {
  expect(await evidence(f)).toEqual(before);
  expect(await f.db.select().from(npAgentChangesetExecutions)).toEqual([]);
  expect(f.applyJobs).toEqual([]);
  expect(f.providerInvoke).not.toHaveBeenCalled();
  expect(await f.service.get({ actor: f.actor, id: f.sealed.id })).toMatchObject({
    id: f.sealed.id,
    state: "cancelled",
  });
  await expect(f.service.approvals!.get(identity(f))).resolves.toMatchObject({
    item: { approval: { id: f.required.approvalId }, allowedDecisions: [] },
  });
  const activity = createAgentActivityServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(61),
    now: f.options.now,
    changesets: f.service,
  });
  await expect(
    activity.getRun({ siteId, actor: f.actor.actor, id: f.input.runId }),
  ).resolves.toMatchObject({
    schemaVersion: "np.agent-activity-run-expired.v1",
    runId: f.input.runId,
    evidence: "expired",
  });
  const hidden = createAgentActivityServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(61),
    now: f.options.now,
    changesets: { get: () => Promise.reject(new Error("Current item access denied")) },
  });
  await expect(
    hidden.getRun({ siteId, actor: f.actor.actor, id: f.input.runId }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(f.admission.admit(f.runInput)).rejects.toMatchObject({
    code: "IDEMPOTENCY_KEY_REUSED",
  });
  await expect(
    f.service.resumeRuntimeApproval({
      ...f.claimed,
      requestActionId: f.requestActionId,
      sequence: 5,
    }),
  ).rejects.toThrow();
  await expect(
    f.db
      .update(npAgentApprovals)
      .set({ reason: "Changed retained decision" })
      .where(eq(npAgentApprovals.id, f.required.approvalId)),
  ).rejects.toThrow();
  await expect(
    f.db.delete(npAgentApprovals).where(eq(npAgentApprovals.id, f.required.approvalId)),
  ).rejects.toThrow();
  const requestAction = await f.requestAction();
  await expect(
    f.db.delete(npAgentInvocations).where(eq(npAgentInvocations.id, requestAction.invocationId!)),
  ).rejects.toThrow();
  expect((await npCollectAgentHealthSummaryV1({ now: f.options.now() })).issues).toEqual([]);
  expect((await sweep(f)).pruned).toBe(0);
}

describe.skipIf(skipIfNoTestDb())("Closed unexecuted approval source retention", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("releases a rejected request after proposal expiry while preserving decisions, current ACLs and replay denial", async () => {
    const f = await runtimeApprovalResumeFixture();
    await reject(f);
    await f.store.cancel(f.input);
    await ageAndClean(f);
    expect((await f.service.reconcileExpired({ siteId })).cancelled).toBe(1);
    expect(await f.db.select().from(npAgentChangesets)).toMatchObject([
      { state: "cancelled", cancellationCode: "CHANGESET_EXPIRED" },
    ]);
    const before = await evidence(f);
    const actions = await f.db.select().from(npAgentActions).orderBy(npAgentActions.id);
    expect((await sweep(f)).pruned).toBe(1);
    expect(await f.db.select().from(npAgentRuns)).toEqual([]);
    const [release] = await f.db.select().from(npAgentSourceReleases);
    expect(await f.db.select().from(npAgentActions).orderBy(npAgentActions.id)).toEqual(
      actions.map((action) => ({ ...action, runId: null, runSourceReleaseId: release.id })),
    );
    await expectRetained(f, before);
  });

  it("releases a never-approved scheduling request only after approval and proposal expiry", async () => {
    const f = await runtimeApprovalResumeFixture("schedule");
    await f.store.cancel(f.input);
    await ageAndClean(f);
    expect((await sweep(f)).pruned).toBe(0);
    expect((await f.service.approvals!.reconcileExpired({ siteId })).expired).toBe(1);
    expect((await sweep(f)).pruned).toBe(0);
    expect((await f.service.reconcileExpired({ siteId })).cancelled).toBe(1);
    expect(await f.db.select().from(npAgentChangesets)).toMatchObject([
      { state: "cancelled", cancellationCode: "CHANGESET_EXPIRED" },
    ]);
    const before = await evidence(f);
    expect(before.approvals[0]).toMatchObject({
      state: "expired",
      decisionBody: null,
      decidedAt: null,
    });
    expect((await sweep(f)).pruned).toBe(1);
    await expectRetained(f, before);
  });

  it("pins tampered request evidence and unknown source references before a concurrent single release", async () => {
    const f = await runtimeApprovalResumeFixture();
    await reject(f);
    await f.store.cancel(f.input);
    await ageAndClean(f);
    expect((await f.service.reconcileExpired({ siteId })).cancelled).toBe(1);
    expect(await f.db.select().from(npAgentChangesets)).toMatchObject([
      { state: "cancelled", cancellationCode: "CHANGESET_EXPIRED" },
    ]);
    const original = await f.requestAction();
    const [invocation] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, original.invocationId!));
    await f.db
      .update(npAgentInvocations)
      .set({ authorityRef: { ...invocation.authorityRef, principalId: randomUUID() } })
      .where(eq(npAgentInvocations.id, invocation.id));
    expect((await npCollectAgentHealthSummaryV1({ now: f.options.now() })).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "AGENT_EXECUTION_DIVERGED", count: 1 }),
      ]),
    );
    expect((await sweep(f)).pruned).toBe(0);
    await f.db
      .update(npAgentInvocations)
      .set({ authorityRef: invocation.authorityRef })
      .where(eq(npAgentInvocations.id, invocation.id));
    expect((await npCollectAgentHealthSummaryV1({ now: f.options.now() })).issues).toEqual([]);
    await f.db
      .update(npAgentActions)
      .set({ inputHash: runtimeFingerprint })
      .where(eq(npAgentActions.id, original.id));
    expect((await sweep(f)).pruned).toBe(0);
    await f.db
      .update(npAgentActions)
      .set({ inputHash: original.inputHash })
      .where(eq(npAgentActions.id, original.id));
    const blockerId = randomUUID();
    await f.db.insert(npAuditEvents).values({
      id: blockerId,
      siteId,
      actorKind: "system",
      action: "fixture.unowned_source",
      targetType: "agent-run",
      targetId: f.input.runId,
      payload: {},
    });
    expect((await sweep(f)).pruned).toBe(0);
    await f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, blockerId));
    const databaseUrl = getTestDatabaseUrl();
    if (!databaseUrl) throw new Error("Expected isolated test database");
    const adapter = new PgBossAdapter(databaseUrl, { supervise: false, schedule: false });
    try {
      await adapter.startProducer();
      const boss = Reflect.get(adapter, "boss") as {
        createQueue(name: string, options: { partition: boolean }): Promise<void>;
      };
      await boss.createQueue("closed.approval.retention", { partition: true });
      await adapter.startProducer();
      const jobId = randomUUID();
      const payload = JSON.stringify({ siteId, approvalId: f.required.approvalId });
      await f.db.execute(
        sql`insert into pgboss.job(id,name,data) values(${jobId}::uuid,'closed.approval.retention',${payload}::jsonb)`,
      );
      expect((await sweep(f)).pruned).toBe(0);
      await f.db.execute(sql`delete from pgboss.job where id=${jobId}::uuid`);
      const results = await Promise.all([sweep(f), sweep(f)]);
      expect(results.reduce((total, result) => total + result.pruned, 0)).toBe(1);
      expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(1);
      await expect(
        f.db.execute(
          sql`insert into pgboss.job(name,data) values('closed.approval.retention',${payload}::jsonb)`,
        ),
      ).rejects.toThrow();
    } finally {
      await adapter.stop();
      await f.db.execute(sql`drop schema if exists pgboss cascade`);
    }
  });

  it("keeps an expired approval that was previously approved pinned without executing it", async () => {
    const f = await runtimeApprovalResumeFixture();
    await f.approve();
    f.advance(601);
    expect((await f.service.approvals!.reconcileExpired({ siteId })).expired).toBe(1);
    await cancel(f, "ready");
    await ageAndClean(f);
    const before = await evidence(f);
    expect(before.approvals[0]).toMatchObject({
      state: "expired",
      decisionBody: { decision: "approve" },
    });
    expect((await sweep(f)).pruned).toBe(0);
    expect(await f.run()).toBeDefined();
    expect(await f.db.select().from(npAgentSourceReleases)).toEqual([]);
    expect(await evidence(f)).toEqual(before);
    expect(await f.db.select().from(npAgentChangesetExecutions)).toEqual([]);
  });

  it("releases creator and requester independently while freezing linked approval evidence after the first release", async () => {
    const f = await runtimeApprovalResumeFixture("apply", { separateRequester: true });
    await reject(f);
    await f.store.cancel(f.input);
    await ageAndClean(f);
    expect((await f.service.reconcileExpired({ siteId })).cancelled).toBe(1);
    expect(await f.db.select().from(npAgentChangesets)).toMatchObject([
      { state: "cancelled", cancellationCode: "CHANGESET_EXPIRED" },
    ]);
    const blockerId = randomUUID();
    await f.db.insert(npAuditEvents).values({
      id: blockerId,
      siteId,
      actorKind: "system",
      action: "fixture.unowned_requester",
      targetType: "agent-run",
      targetId: f.input.runId,
      payload: {},
    });
    expect((await sweep(f)).pruned).toBe(1);
    const [creatorRelease] = await f.db.select().from(npAgentSourceReleases);
    expect(creatorRelease.sourceId).toBe(f.creatorInput.runId);
    expect(await f.run()).toBeDefined();
    expect((await npCollectAgentHealthSummaryV1({ now: f.options.now() })).issues).toEqual([]);
    await expect(
      f.db
        .update(npAgentApprovals)
        .set({ reason: "Late requester rewrite" })
        .where(eq(npAgentApprovals.id, f.required.approvalId)),
    ).rejects.toThrow();
    await expect(
      f.db
        .update(npAgentActions)
        .set({ inputHash: runtimeFingerprint })
        .where(eq(npAgentActions.id, f.requestActionId)),
    ).rejects.toThrow();
    await f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, blockerId));
    const before = await evidence(f);
    expect((await sweep(f)).pruned).toBe(1);
    expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(2);
    expect(await f.db.select().from(npAgentChangesets)).toMatchObject([
      { runId: null, runSourceReleaseId: creatorRelease.id },
    ]);
    await expectRetained(f, before);
  });
});
