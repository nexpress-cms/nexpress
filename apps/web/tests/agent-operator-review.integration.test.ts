import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentOperatorPlans,
  npAgentOperatorExecutions,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
import { createAgentOperatorEventSourceV1 } from "../../../packages/core/src/agent/operator-event-source.js";
import { npCreateAgentOperatorAppHostV1 } from "../../../packages/app/src/lib/agents/operator-host.js";
import { operatorExecutionFixture, operatorRequest } from "./agent-operator-execution-fixture.js";
import { siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Operator retained Activity review and deployment gate", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeTestDb();
  });
  it("projects a real persisted local plan and bounded recovery through current-authorized Activity, withholding private artifacts", async () => {
    let allowed = true;
    let clock = new Date();
    let ready = 10,
      active = 1,
      live = false;
    const observation = () => ({
      schemaVersion: "np.agent-operator-monitor-snapshot.v1" as const,
      observedAt: clock.toISOString(),
      complete: true,
      paused: false,
      queues: [{ name: "agent.runExecute", ready, active, oldestReadyAgeSeconds: 900 }],
      workers: live
        ? [
            {
              id: "worker:recovered",
              lastHeartbeatAt: clock.toISOString(),
              state: "active" as const,
              queues: ["agent.runExecute"],
            },
          ]
        : [],
    });
    const f = await operatorExecutionFixture({
      assertReviewAccess: async ({ siteId: id }) => {
        if (!allowed || id !== siteId) throw new Error("Target denied");
      },
      plan: async () => ({
        artifact: {
          schemaVersion: "np.runbook.v1",
          runbook: "worker-not-draining",
          observation: observation(),
          privatePath: "/private/password",
        },
        contractId: "runbook",
        projectCommand: "pnpm --silent run ops:runbook -- worker-not-draining --json",
        checks: [{ id: "queue.pause", status: "pass" }],
      }),
    });
    const result = await f.invoke(
      operatorRequest("ops.plan", {
        action: "queue.global.plan",
        target: { kind: "queue", operation: "drain", jobName: "agent.runExecute" },
      }),
    );
    const [action] = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.invocationId, result.invocationId));
    const activity = createAgentActivityServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(31),
      operator: f.service,
    });
    const read = () => activity.getAction({ siteId, actor: f.actor.actor, id: action.id });
    const first = await read();
    expect(first.operatorReview).toMatchObject({
      checks: [{ id: "queue.pause", state: "pass" }],
      plan: { execution: { kind: "local-cli-handoff" } },
      queue: { ready: 10, active: 1 },
      recovery: null,
    });
    expect(JSON.stringify(first)).not.toMatch(/password|privatePath/);
    const source = createAgentOperatorEventSourceV1({
      db: f.db,
      now: () => clock,
      events: { record: async () => {} },
      isInstalledSite: async (id) => id === siteId,
      authorize: async () => {},
      staleAfterSeconds: 300,
      minimumPendingJobs: 1,
      observeJobs: async () => ({ snapshot: observation(), failures: [], failuresComplete: true }),
    });
    const planId = first.operatorReview!.plan!.planId;
    clock = new Date();
    await source.startMonitor({ siteId, planId, windowSeconds: 300 });
    clock = new Date(clock.getTime() + 60000);
    expect((await read()).operatorReview?.recovery).toMatchObject({ state: "monitoring" });
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.targetType, "agent-operator-monitor")),
    ).toHaveLength(1);
    ready = 5;
    active = 0;
    live = true;
    await source.sampleMonitor({ siteId, monitorId: planId });
    expect((await read()).operatorReview?.recovery).toMatchObject({
      state: "recovered",
      beforePending: 11,
      afterPending: 5,
    });
    allowed = false;
    await expect(read()).rejects.toMatchObject({ code: "ACTIVITY_NOT_FOUND" });
    allowed = true;
    await f.db
      .update(npAgentOperatorPlans)
      .set({ artifactCanonical: { privatePath: "/changed" } })
      .where(eq(npAgentOperatorPlans.id, planId));
    await expect(read()).rejects.toMatchObject({ code: "ACTIVITY_NOT_FOUND" });
  });
  it("blocks a disabled deployment before consuming real approval or reserving an execution, and admits exact retry after explicit enablement", async () => {
    vi.stubEnv("NP_REMOTE_OPS_MUTATIONS", "0");
    const app = npCreateAgentOperatorAppHostV1({ authorize: async () => {} });
    const f = await operatorExecutionFixture({ preflightExecution: app.preflightExecution });
    const plan = await f.plan();
    await f.decide(plan.approvalId);
    await expect(f.invoke(plan.request)).rejects.toThrow("unavailable");
    expect(f.state.executions).toBe(0);
    expect(await f.db.select().from(npAgentOperatorExecutions)).toHaveLength(0);
    expect(
      (
        await f.db.select().from(npAgentApprovals).where(eq(npAgentApprovals.id, plan.approvalId))
      )[0].state,
    ).toBe("approved");
    vi.stubEnv("NP_REMOTE_OPS_MUTATIONS", "1");
    expect((await f.invoke(plan.request)).output).toMatchObject({ state: "succeeded" });
    expect(f.state.executions).toBe(1);
    vi.unstubAllEnvs();
  });
  it("fails closed when current viewer authority is revoked during the evidence read", async () => {
    let authorizations = 0;
    const f = await operatorExecutionFixture({
      assertReviewAccess: async () => {
        if (++authorizations === 2) throw new Error("Current deployment permission denied");
      },
      plan: async () => ({
        artifact: { schemaVersion: "np.runbook.v1", runbook: "worker-not-draining" },
        contractId: "runbook",
        projectCommand: "pnpm --silent run ops:runbook -- worker-not-draining --json",
        checks: [{ id: "queue.current", status: "pass" }],
      }),
    });
    const result = await f.invoke(
      operatorRequest(
        "ops.plan",
        {
          action: "queue.global.plan",
          target: { kind: "queue", operation: "drain", jobName: null },
        },
        randomUUID(),
      ),
    );
    const [action] = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.invocationId, result.invocationId));
    await expect(
      f.service.projectActivity({ siteId, actor: f.actor.actor, actionId: action.id }),
    ).rejects.toThrow("denied");
    expect(authorizations).toBe(2);
    await expect(
      f.service.projectActivity({ siteId: "foreign", actor: f.actor.actor, actionId: action.id }),
    ).rejects.toThrow();
  });
});
