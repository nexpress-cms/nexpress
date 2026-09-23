import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  getTestDatabaseUrl,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import {
  npCollectAgentWorkerHealthV1,
  npCollectAgentWorkerHealthV2,
} from "../../../packages/core/src/agent/worker-health.js";
import { getDb, resetDb, setDb } from "../../../packages/core/src/db/runtime.js";
import { npWorkerHeartbeats } from "../../../packages/core/src/db/schema/system.js";
import {
  recordHeartbeat,
  startHeartbeatLoop,
  WORKER_STALE_THRESHOLD_MS,
} from "../../../packages/core/src/jobs/heartbeat.js";
import {
  NP_AGENT_WORKER_QUEUE_NAMES,
  NP_WORKER_SUBSCRIPTION_META_KEY,
  type NpWorkerSubscriptionV1,
} from "../../../packages/core/src/jobs-contract/worker-subscription-contract.js";

const now = new Date("2026-09-21T08:00:00.000Z");
const agentQueue = "agent.runExecute";

function subscription(
  state: NpWorkerSubscriptionV1["state"],
  queues: string[] = [agentQueue],
): NpWorkerSubscriptionV1 {
  return {
    schemaVersion: "np.worker-subscription.v1",
    state,
    registeredAgentQueues: state === "producer" ? [] : queues,
    agentQueues: state === "active" ? queues : [],
  };
}

function worker(
  id: string,
  evidence: unknown,
  overrides: Partial<typeof npWorkerHeartbeats.$inferInsert> = {},
): typeof npWorkerHeartbeats.$inferInsert {
  return {
    id,
    status: "running",
    startedAt: new Date(now.getTime() - WORKER_STALE_THRESHOLD_MS * 2),
    lastSeenAt: now,
    meta: {
      hostname: "private-worker-host",
      secret: "private-host-metadata",
      ...(evidence === undefined ? {} : { [NP_WORKER_SUBSCRIPTION_META_KEY]: evidence }),
    },
    ...overrides,
  };
}

async function connectedClient() {
  const connectionString = getTestDatabaseUrl();
  if (!connectionString) throw new Error("TEST_DATABASE_URL not set");
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

describe.skipIf(skipIfNoTestDb())("Agent worker Health observations", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("separates persisted subscription states from legacy, malformed and future observations", async () => {
    const db = await getTestDb();
    await db.insert(npWorkerHeartbeats).values([
      worker("private-active", {
        ...subscription("active", ["agent.eventDispatch", agentQueue]),
        registeredAgentQueues: ["agent.eventDispatch", "agent.retentionPrune", agentQueue],
      }),
      worker("private-event-only", subscription("active", ["agent.eventDispatch"])),
      worker("private-paused", subscription("paused", ["agent.retentionPrune", agentQueue])),
      worker("private-producer", subscription("producer")),
      worker("private-unrelated", {
        ...subscription("active"),
        registeredAgentQueues: [],
        agentQueues: [],
      }),
      worker("private-stale", subscription("active", ["agent.eventDispatch", agentQueue]), {
        lastSeenAt: new Date(now.getTime() - WORKER_STALE_THRESHOLD_MS),
      }),
      worker("private-stopped", subscription("active", ["agent.retentionPrune"]), {
        status: "stopped",
      }),
      worker("private-legacy", undefined),
      worker("private-malformed", { ...subscription("active"), agentQueues: ["mail.send"] }),
      worker("private-future", subscription("active"), {
        lastSeenAt: new Date(now.getTime() + 1),
      }),
      worker("private-transition", subscription("transitioning")),
      worker("private-unavailable", subscription("unavailable")),
      worker("private-inconsistent", subscription("stopped")),
    ]);
    const before = await db.select().from(npWorkerHeartbeats).orderBy(npWorkerHeartbeats.id);
    const result = await npCollectAgentWorkerHealthV1({ now });
    expect(result).toMatchObject({
      state: "observed",
      sampledWorkers: 13,
      hasMore: false,
      subscribedWorkers: 2,
      pausedWorkers: 1,
      inactiveWorkers: 2,
      staleWorkers: 1,
      stoppedWorkers: 1,
      unknownWorkers: 6,
    });
    const detailed = await npCollectAgentWorkerHealthV2({ now });
    expect(detailed.schemaVersion).toBe("np.agent-worker-health.v2");
    expect(detailed.summary).toEqual(result);
    expect(detailed.queues).toEqual(
      NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
        queue,
        subscribedWorkers: queue === "agent.eventDispatch" ? 2 : queue === agentQueue ? 1 : 0,
        pausedRegisteredWorkers: ["agent.retentionPrune", agentQueue].includes(queue) ? 1 : 0,
        staleRegisteredWorkers: ["agent.eventDispatch", agentQueue].includes(queue) ? 1 : 0,
        stoppedRegisteredWorkers: queue === "agent.retentionPrune" ? 1 : 0,
      })),
    );
    const wire = JSON.stringify(result);
    expect(wire).not.toContain("private-");
    expect(wire).not.toContain(agentQueue);
    expect(wire).not.toContain("hostname");
    expect(JSON.stringify(detailed)).not.toMatch(/private-|hostname|mail\.send/);
    expect(await db.select().from(npWorkerHeartbeats).orderBy(npWorkerHeartbeats.id)).toEqual(
      before,
    );
  });

  it("samples the newest 100 with stable id ties and excludes the sentinel and older rows", async () => {
    const db = await getTestDb();
    await db.insert(npWorkerHeartbeats).values([
      ...Array.from({ length: 100 }, (_, index) =>
        worker(`a-private-${index.toString().padStart(3, "0")}`, subscription("active")),
      ),
      // Equal timestamp: id is the tie-breaker, so this paused row is only the sentinel.
      worker("z-private-sentinel", subscription("paused")),
      worker("0-private-older", subscription("unavailable"), {
        lastSeenAt: new Date(now.getTime() - 1),
      }),
    ]);
    const before = await db.select().from(npWorkerHeartbeats).orderBy(npWorkerHeartbeats.id);
    const detailed = await npCollectAgentWorkerHealthV2({ now });
    expect(detailed.summary).toEqual(await npCollectAgentWorkerHealthV1({ now }));
    expect(detailed.summary).toMatchObject({
      state: "observed",
      sampledWorkers: 100,
      hasMore: true,
      subscribedWorkers: 100,
      pausedWorkers: 0,
      inactiveWorkers: 0,
      staleWorkers: 0,
      stoppedWorkers: 0,
      unknownWorkers: 0,
    });
    expect(detailed.queues).toEqual(
      NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
        queue,
        subscribedWorkers: queue === agentQueue ? 100 : 0,
        pausedRegisteredWorkers: 0,
        staleRegisteredWorkers: 0,
        stoppedRegisteredWorkers: 0,
      })),
    );
    expect(await db.select().from(npWorkerHeartbeats).orderBy(npWorkerHeartbeats.id)).toEqual(
      before,
    );
  });

  it("bounds blocked reads without changing the Doctor connection's stricter or looser timeout", async () => {
    await getTestDb();
    const holder = await connectedClient();
    const observer = await connectedClient();
    try {
      await holder.query("begin");
      await holder.query("lock table np_worker_heartbeats in access exclusive mode");
      const db = drizzle(observer);
      for (const timeout of ["50ms", "1500ms"]) {
        await observer.query("select set_config('statement_timeout',$1,false)", [timeout]);
        const detailed = await npCollectAgentWorkerHealthV2({ db, now });
        expect(detailed.summary).toEqual(await npCollectAgentWorkerHealthV1({ db, now }));
        expect(detailed.queues).toEqual(
          NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
            queue,
            subscribedWorkers: null,
            pausedRegisteredWorkers: null,
            staleRegisteredWorkers: null,
            stoppedRegisteredWorkers: null,
          })),
        );
        expect(detailed.summary).toMatchObject({
          state: "unavailable",
          sampledWorkers: null,
          hasMore: null,
          subscribedWorkers: null,
          unknownWorkers: null,
        });
        expect((await observer.query("show statement_timeout")).rows[0]?.statement_timeout).toBe(
          timeout,
        );
      }
      await holder.query("rollback");
      const recovered = await npCollectAgentWorkerHealthV2({ db, now });
      expect(recovered.summary).toMatchObject({
        state: "observed",
        sampledWorkers: 0,
        hasMore: false,
        subscribedWorkers: 0,
        unknownWorkers: 0,
      });
      expect(recovered.queues).toEqual(
        NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
          queue,
          subscribedWorkers: 0,
          pausedRegisteredWorkers: 0,
          staleRegisteredWorkers: 0,
          stoppedRegisteredWorkers: 0,
        })),
      );
      expect((await observer.query("show statement_timeout")).rows[0]?.statement_timeout).toBe(
        "1500ms",
      );
    } finally {
      await holder.query("rollback");
      await holder.end();
      await observer.end();
    }
  });

  it("uses Doctor's existing Client with no runtime singleton and leaves ownership unchanged", async () => {
    const original = getDb();
    const client = await connectedClient();
    try {
      resetDb(original);
      const unavailable = await npCollectAgentWorkerHealthV2({ now });
      expect(unavailable.summary).toEqual(await npCollectAgentWorkerHealthV1({ now }));
      expect(unavailable.queues.every((queue) => queue.subscribedWorkers === null)).toBe(true);
      expect(unavailable.summary).toMatchObject({
        state: "unavailable",
        sampledWorkers: null,
        subscribedWorkers: null,
      });
      const observed = await npCollectAgentWorkerHealthV2({ db: drizzle(client), now });
      expect(observed.summary).toEqual(
        await npCollectAgentWorkerHealthV1({ db: drizzle(client), now }),
      );
      expect(observed.summary).toMatchObject({
        state: "observed",
        sampledWorkers: 0,
        subscribedWorkers: 0,
        unknownWorkers: 0,
      });
      expect((await client.query("select 1 as alive")).rows).toEqual([{ alive: 1 }]);
      expect(() => getDb()).toThrow("Database not initialized");
    } finally {
      setDb(original);
      await client.end();
    }
  });

  it("persists only current owner evidence and never promotes host metadata to a subscription", async () => {
    // Generic heartbeat callers cannot forge the reserved owner evidence field.
    await recordHeartbeat("private-generic", {
      [NP_WORKER_SUBSCRIPTION_META_KEY]: subscription("active"),
    });
    let evidence: unknown = subscription("active", ["agent.eventDispatch", agentQueue]);
    const loop = startHeartbeatLoop(
      { [NP_WORKER_SUBSCRIPTION_META_KEY]: subscription("active") },
      20,
      () => evidence,
    );
    try {
      const queueCounts = async () =>
        (await npCollectAgentWorkerHealthV2()).queues.filter(
          (queue) => queue.queue === "agent.eventDispatch" || queue.queue === agentQueue,
        );
      await expect
        .poll(queueCounts)
        .toEqual([
          expect.objectContaining({ queue: "agent.eventDispatch", subscribedWorkers: 1 }),
          expect.objectContaining({ queue: agentQueue, subscribedWorkers: 1 }),
        ]);
      expect(await npCollectAgentWorkerHealthV1()).toMatchObject({
        sampledWorkers: 2,
        unknownWorkers: 1,
      });
      evidence = subscription("paused");
      await expect.poll(queueCounts).toEqual([
        expect.objectContaining({
          queue: "agent.eventDispatch",
          subscribedWorkers: 0,
          pausedRegisteredWorkers: 0,
        }),
        expect.objectContaining({
          queue: agentQueue,
          subscribedWorkers: 0,
          pausedRegisteredWorkers: 1,
        }),
      ]);
      evidence = undefined;
      await expect.poll(async () => (await npCollectAgentWorkerHealthV1()).unknownWorkers).toBe(2);
      expect(await queueCounts()).toEqual([
        expect.objectContaining({ subscribedWorkers: 0, pausedRegisteredWorkers: 0 }),
        expect.objectContaining({ subscribedWorkers: 0, pausedRegisteredWorkers: 0 }),
      ]);
      evidence = subscription("active");
      await expect
        .poll(async () => (await npCollectAgentWorkerHealthV1()).subscribedWorkers)
        .toBe(1);
    } finally {
      await loop.stop();
    }
    const stopped = await npCollectAgentWorkerHealthV2();
    expect(stopped.queues.find((queue) => queue.queue === agentQueue)).toMatchObject({
      subscribedWorkers: 0,
      stoppedRegisteredWorkers: 1,
    });
    expect(stopped.summary).toMatchObject({
      sampledWorkers: 2,
      subscribedWorkers: 0,
      stoppedWorkers: 1,
      unknownWorkers: 1,
    });
  });
});
