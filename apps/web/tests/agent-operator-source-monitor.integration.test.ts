import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { PgBossAdapter } from "../../../packages/core/src/jobs/pg-boss-adapter.js";
import { npWorkerHeartbeats } from "../../../packages/core/src/db/schema/system.js";
import { NP_WORKER_SUBSCRIPTION_META_KEY } from "../../../packages/core/src/jobs-contract/worker-subscription-contract.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentOperatorEventSourceV1 } from "../../../packages/core/src/agent/operator-event-source.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { npCollectAgentOperatorEventObservationV1 } from "../../../packages/core/src/agent/operator-event-observation.js";
import type { NpAgentOperatorMonitorSnapshotV1 } from "../../../packages/core/src/agent-contract/operator-monitor-contract.js";
import { npRequireAgentOpsPlanOutputV1 } from "../../../packages/core/src/agent-contract/operator-capability-contract.js";
import {
  npAgentEvents,
  npAgentProviderCalls,
  npAgentRuns,
  npAgentOperatorExecutions,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { runtimeDefinition, runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import { npCreateAgentR6UnattendedRecipeRegistryV3 } from "../../../packages/core/src/agent-contract/r6-recipe-registry.js";
import { npAgentOperatorRecipeSetupV1 } from "../../../packages/core/src/agent-contract/operator-recipe-contract.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { operatorExecutionFixture, operatorRequest } from "./agent-operator-execution-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
async function setup() {
  const f = await runtimeFixture();
  const events = createAgentRuntimeEventServiceV1({
    admission: f.admission,
    deploymentAuthority: f.options.deploymentAuthority,
    now: f.options.now,
  });
  const state = {
    allowed: true,
    observations: 0,
    status: "pass" as "pass" | "fail",
    backupFailed: false,
    backupStale: false,
    revokeAfterObservation: false,
  };
  let snapshot: NpAgentOperatorMonitorSnapshotV1 = {
    schemaVersion: "np.agent-operator-monitor-snapshot.v1",
    observedAt: f.options.now().toISOString(),
    complete: true,
    paused: false,
    queues: [{ name: "agent.runExecute", ready: 10, active: 1, oldestReadyAgeSeconds: 900 }],
    workers: [
      {
        id: "worker:1",
        lastHeartbeatAt: new Date(f.options.now().getTime() - 900000).toISOString(),
        state: "active",
        queues: ["agent.runExecute"],
      },
    ],
  };
  const failure = {
    handlerName: "agent.runExecute",
    jobId: randomUUID(),
    completedAt: f.options.now().toISOString(),
  };
  const recreateSource = () =>
    createAgentOperatorEventSourceV1({
      db: f.db,
      now: f.options.now,
      events,
      staleAfterSeconds: 300,
      minimumPendingJobs: 2,
      isInstalledSite: async (current) => current === siteId,
      authorize: async ({ siteId: current }) => {
        if (!state.allowed || current !== siteId)
          throw new Error("Current deployment authority unavailable.");
      },
      observeJobs: async () => {
        state.observations++;
        if (state.revokeAfterObservation) state.allowed = false;
        return {
          snapshot: { ...snapshot, observedAt: f.options.now().toISOString() },
          failures: [failure],
          failuresComplete: true,
        };
      },
      observeStatus: async () => ({
        observedAt: f.options.now().toISOString(),
        checks: [{ id: "storage.adapter", state: state.status }],
        backup: {
          state: "observed",
          artifactId: "manifest-1",
          failed: state.backupFailed,
          stale: state.backupStale,
        },
      }),
    });
  return {
    ...f,
    source: recreateSource(),
    recreateSource,
    state,
    changeSnapshot: (change: Partial<NpAgentOperatorMonitorSnapshotV1>) => {
      snapshot = { ...snapshot, ...change };
    },
  };
}
describe.skipIf(skipIfNoTestDb())("Operator canonical source and bounded recovery", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("emits canonical threshold/stale/failure events, deduplicates exact evidence across polls and records real status/backup transitions", async () => {
    const f = await setup();
    await f.source.observe({ siteId });
    let events = await f.db.select().from(npAgentEvents);
    expect(events.map((e) => e.kind).sort()).toEqual([
      "jobs.backlog.threshold",
      "jobs.handler.failed",
      "jobs.worker.stale",
    ]);
    f.advance(1);
    await f.source.observe({ siteId });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(3);
    f.state.status = "fail";
    f.state.backupFailed = true;
    f.state.backupStale = true;
    await f.source.observe({ siteId });
    events = await f.db.select().from(npAgentEvents);
    expect(events.map((e) => e.kind).sort()).toEqual([
      "jobs.backlog.threshold",
      "jobs.handler.failed",
      "jobs.worker.stale",
      "ops.backup.failed",
      "ops.backup.stale",
      "ops.check.changed",
    ]);
    expect(
      events.every(
        (e) =>
          e.siteId === siteId &&
          e.sourceComponent === "operator-source" &&
          e.privacy === "internal",
      ),
    ).toBe(true);
    f.advance(1);
    await f.source.observe({ siteId });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(6);
  });
  it("suppresses stale/backlog signals when paused or incomplete and performs no reads for uninstalled sites", async () => {
    const f = await setup();
    expect(await f.source.observe({ siteId: "uninstalled" })).toEqual({
      state: "disabled",
      emitted: 0,
    });
    expect(f.state.observations).toBe(0);
    f.changeSnapshot({ paused: true });
    await f.source.observe({ siteId });
    expect((await f.db.select().from(npAgentEvents)).map((e) => e.kind)).toEqual([
      "jobs.handler.failed",
    ]);
    f.changeSnapshot({ paused: false, complete: false });
    await f.source.observe({ siteId });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    f.state.allowed = false;
    await expect(f.source.observe({ siteId })).rejects.toThrow("authority");
    expect(await f.db.select().from(npAgentOperatorExecutions)).toHaveLength(0);
    const priorAudit = await f.db.select().from(npAuditEvents);
    f.state.allowed = true;
    f.state.revokeAfterObservation = true;
    const reads = f.state.observations;
    await expect(f.source.observe({ siteId })).rejects.toThrow("authority");
    expect(f.state.observations).toBe(reads + 1);
    expect(await f.db.select().from(npAuditEvents)).toHaveLength(priorAudit.length);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
  });
  it("pins an actual persisted same-site local runbook plan, resumes after service recreation and verifies a fresh subscribed worker plus decreasing backlog", async () => {
    const f = await setup();
    const owner = await operatorExecutionFixture(
      {
        plan: async () => ({
          artifact: { schemaVersion: "np.runbook.v1", runbook: "worker-not-draining" },
          contractId: "runbook",
          projectCommand: "pnpm --silent run ops:runbook -- worker-not-draining --json",
          checks: [{ id: "queue.current", status: "pass" }],
        }),
      },
      f,
      undefined,
      f.options.now,
    );
    const output = npRequireAgentOpsPlanOutputV1(
      (
        await owner.invoke(
          operatorRequest("ops.plan", {
            action: "queue.global.plan",
            target: { kind: "queue", operation: "drain", jobName: "agent.runExecute" },
          }),
        )
      ).output,
    );
    expect(output.execution.kind).toBe("local-cli-handoff");
    const started = await f.source.startMonitor({
      siteId,
      planId: output.planId,
      windowSeconds: 300,
    });
    expect(await f.source.startMonitor({ siteId, planId: output.planId })).toEqual({
      monitorId: started.monitorId,
      replayed: true,
    });
    f.advance(60);
    f.changeSnapshot({
      queues: [{ name: "agent.runExecute", ready: 7, active: 1, oldestReadyAgeSeconds: 900 }],
    });
    expect(await f.source.sampleMonitor({ siteId, monitorId: started.monitorId })).toMatchObject({
      state: "monitoring",
      beforePending: 11,
      afterPending: 8,
    });
    f.advance(60);
    f.changeSnapshot({
      workers: [
        {
          id: "worker:2",
          lastHeartbeatAt: f.options.now().toISOString(),
          state: "active",
          queues: ["agent.runExecute"],
        },
      ],
    });
    expect(await f.recreateSource().sampleDueMonitors({ siteId })).toEqual({ sampled: 1 });
    expect(await f.source.sampleMonitor({ siteId, monitorId: started.monitorId })).toMatchObject({
      state: "recovered",
      beforePending: 11,
      afterPending: 8,
      replayed: true,
    });
    expect(await f.db.select().from(npAgentOperatorExecutions)).toHaveLength(0);
    const audit = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.targetType, "agent-operator-monitor"));
    expect(audit).toHaveLength(3);
    expect(audit.every((a) => a.siteId === siteId)).toBe(true);
    await expect(
      f.source.startMonitor({ siteId: "foreign", planId: output.planId }),
    ).rejects.toThrow("unavailable");
  });
  it("persists paused/unknown states and terminates at the bounded deadline without claiming recovery", async () => {
    const f = await setup();
    const owner = await operatorExecutionFixture(
      {
        plan: async () => ({
          artifact: { runbook: "worker-not-draining" },
          contractId: "runbook",
          projectCommand: "pnpm --silent run ops:runbook -- worker-not-draining --json",
          checks: [{ id: "queue.current", status: "pass" }],
        }),
      },
      f,
      undefined,
      f.options.now,
    );
    const output = npRequireAgentOpsPlanOutputV1(
      (
        await owner.invoke(
          operatorRequest("ops.plan", {
            action: "queue.global.plan",
            target: { kind: "queue", operation: "drain", jobName: null },
          }),
        )
      ).output,
    );
    await f.source.startMonitor({ siteId, planId: output.planId, windowSeconds: 180 });
    f.advance(60);
    f.changeSnapshot({ paused: true });
    expect(await f.source.sampleMonitor({ siteId, monitorId: output.planId })).toMatchObject({
      state: "paused",
    });
    f.advance(60);
    f.changeSnapshot({ paused: null, complete: false });
    expect(await f.source.sampleMonitor({ siteId, monitorId: output.planId })).toMatchObject({
      state: "unknown",
    });
    f.advance(60);
    expect(await f.source.sampleMonitor({ siteId, monitorId: output.planId })).toMatchObject({
      state: "timed-out",
      reason: "window-expired",
    });
    expect(await f.source.sampleDueMonitors({ siteId })).toEqual({ sampled: 0 });
  });
  it("reports missing canonical storage as unknown without installing queues or workers", async () => {
    const f = await setup();
    // Worker databases are reused across files; truncateAll() preserves pg-boss storage.
    // This case owns the missing-storage precondition, regardless of prior producers.
    await f.db.execute(sql`drop schema if exists pgboss cascade`);
    const result = await npCollectAgentOperatorEventObservationV1({ db: f.db });
    expect(result.snapshot).toMatchObject({ complete: false, paused: null });
    expect(result.failuresComplete).toBe(false);
  });
  it("reads actual due versus future canonical jobs, bounded failure cursors and retained worker subscriptions", async () => {
    const f = await setup();
    const url = getTestDatabaseUrl();
    if (!url) throw new Error("Missing test DB.");
    const adapter = new PgBossAdapter(url, { supervise: false, schedule: false });
    try {
      await adapter.startProducer();
      await adapter.getBoss().createQueue("agent.runExecute");
      await f.db
        .execute(sql`insert into pgboss.job(name,state,created_on,start_after,completed_on,data) values
        ('agent.runExecute','created',now()-interval '20 minutes',now()-interval '20 minutes',null,'{"private":"must not project"}'),
        ('agent.runExecute','created',now(),now()+interval '1 day',null,'{}'),
        ('agent.runExecute','failed',now()-interval '1 minute',now()-interval '1 minute',now(),'{}')`);
      await f.db.insert(npWorkerHeartbeats).values({
        id: "worker:actual",
        status: "running",
        startedAt: new Date(Date.now() - 900000),
        lastSeenAt: new Date(Date.now() - 600000),
        meta: {
          [NP_WORKER_SUBSCRIPTION_META_KEY]: {
            schemaVersion: "np.worker-subscription.v1",
            state: "active",
            agentQueues: ["agent.runExecute"],
            registeredAgentQueues: ["agent.runExecute"],
          },
        },
      });
      const result = await npCollectAgentOperatorEventObservationV1({ db: f.db });
      expect(result.snapshot).toMatchObject({ complete: true, paused: false });
      expect(result.snapshot.queues.find((q) => q.name === "agent.runExecute")).toMatchObject({
        ready: 1,
        active: 0,
      });
      expect(result.snapshot.workers).toMatchObject([
        { id: "worker:actual", state: "active", queues: ["agent.runExecute"] },
      ]);
      expect(result.failures).toHaveLength(1);
      const cursor = result.failures[0];
      expect(
        (await npCollectAgentOperatorEventObservationV1({ db: f.db, afterFailure: cursor }))
          .failures,
      ).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain("must not project");
      await f.db.execute(
        sql`insert into pgboss.job(name,state,created_on,start_after,completed_on,data) select 'agent.runExecute','failed',now()-interval '1 minute',now()-interval '1 minute',now()+interval '1 millisecond','{}' from generate_series(1,105)`,
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      const page1 = await npCollectAgentOperatorEventObservationV1({
        db: f.db,
        afterFailure: cursor,
      });
      expect(page1.failures).toHaveLength(100);
      expect(page1.failuresComplete).toBe(false);
      const page2 = await npCollectAgentOperatorEventObservationV1({
        db: f.db,
        afterFailure: page1.failures.at(-1),
      });
      expect(page2.failures).toHaveLength(5);
      expect(page2.failuresComplete).toBe(true);
    } finally {
      await adapter.stop();
      await f.db.execute(sql`drop schema if exists pgboss cascade`);
    }
  });
  it("admits a canonical source event through the explicitly installed V3 Operator profile without provider execution", async () => {
    const recipes = await npCreateAgentR6UnattendedRecipeRegistryV3();
    const recipe = recipes.recipes.find((r) => r.id === "operator.worker-not-draining");
    if (!recipe) throw new Error("Missing shipped Operator recipe.");
    const definition = runtimeDefinition();
    definition.settings = [structuredClone(npAgentOperatorRecipeSetupV1.settings)];
    definition.scopes = [...npAgentOperatorRecipeSetupV1.scopes];
    definition.autonomy = "advise";
    definition.capabilityModes = structuredClone(npAgentOperatorRecipeSetupV1.capabilityModes);
    const f = await runtimeUsageFixture({ definition, recipe, recipeRegistry: recipes });
    try {
      const events = createAgentRuntimeEventServiceV1({
        admission: f.admission,
        deploymentAuthority: f.runtimeOptions.deploymentAuthority,
        now: f.options.now,
      });
      const triggerId = randomUUID();
      await events.registerTrigger({
        siteId,
        agentId: f.agentId,
        expectedVersionId: f.runInput.expectedVersionId,
        trigger: {
          type: "event",
          id: triggerId,
          eventKind: "jobs.backlog.threshold",
          filter: { op: "eq", field: "source.kind", value: "jobs" },
          coalesceSeconds: 60,
        },
        enabled: true,
      });
      const source = createAgentOperatorEventSourceV1({
        db: f.db,
        now: f.options.now,
        events,
        isInstalledSite: async (id) => id === siteId,
        authorize: async ({ siteId: id }) => {
          if (id !== siteId) throw new Error("Forbidden site.");
        },
        staleAfterSeconds: 300,
        minimumPendingJobs: 2,
        observeJobs: async () => ({
          snapshot: {
            schemaVersion: "np.agent-operator-monitor-snapshot.v1",
            observedAt: f.options.now().toISOString(),
            complete: true,
            paused: false,
            queues: [{ name: "agent.runExecute", ready: 4, active: 0, oldestReadyAgeSeconds: 500 }],
            workers: [],
          },
          failures: [],
          failuresComplete: true,
        }),
      });
      await source.observe({ siteId });
      const [event] = await f.db
        .select()
        .from(npAgentEvents)
        .where(eq(npAgentEvents.kind, "jobs.backlog.threshold"));
      expect(event).toBeDefined();
      const result = await events.dispatch({ siteId, eventId: event.id });
      expect(result.runIds).toHaveLength(1);
      const [run] = await f.db
        .select()
        .from(npAgentRuns)
        .where(eq(npAgentRuns.id, result.runIds[0]));
      expect(run).toMatchObject({
        siteId,
        recipeId: "operator.worker-not-draining",
        origin: "runtime",
        eventRef: { eventId: event.id, eventHash: event.eventHash },
        triggerId,
        state: "queued",
        instructionDigest: recipe.instruction!.digest,
      });
      expect((await events.dispatch({ siteId, eventId: event.id })).runIds).toHaveLength(0);
      expect(await f.db.select().from(npAgentProviderCalls)).toHaveLength(0);
      expect(await f.db.select().from(npAgentOperatorExecutions)).toHaveLength(0);
    } finally {
      await f.dispose();
    }
  });
});
