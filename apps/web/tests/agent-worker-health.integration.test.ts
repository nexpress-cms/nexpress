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
import { npCollectAgentWorkerHealthV1 } from "../../../packages/core/src/agent/worker-health.js";
import { getDb, resetDb, setDb } from "../../../packages/core/src/db/runtime.js";
import { npWorkerHeartbeats } from "../../../packages/core/src/db/schema/system.js";
import {
  recordHeartbeat,
  startHeartbeatLoop,
  WORKER_STALE_THRESHOLD_MS,
} from "../../../packages/core/src/jobs/heartbeat.js";
import {
  NP_WORKER_SUBSCRIPTION_META_KEY,
  type NpWorkerSubscriptionV1,
} from "../../../packages/core/src/jobs-contract/worker-subscription-contract.js";

const now = new Date("2026-09-21T08:00:00.000Z");
const agentQueue = "agent.runExecute";

function subscription(state: NpWorkerSubscriptionV1["state"]): NpWorkerSubscriptionV1 {
  return {
    schemaVersion: "np.worker-subscription.v1",
    state,
    registeredAgentQueues: state === "producer" ? [] : [agentQueue],
    agentQueues: state === "active" ? [agentQueue] : [],
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
      worker("private-active", subscription("active")),
      worker("private-paused", subscription("paused")),
      worker("private-producer", subscription("producer")),
      worker("private-unrelated", {
        ...subscription("active"),
        registeredAgentQueues: [],
        agentQueues: [],
      }),
      worker("private-stale", subscription("active"), {
        lastSeenAt: new Date(now.getTime() - WORKER_STALE_THRESHOLD_MS),
      }),
      worker("private-stopped", subscription("active"), { status: "stopped" }),
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
      sampledWorkers: 12,
      hasMore: false,
      subscribedWorkers: 1,
      pausedWorkers: 1,
      inactiveWorkers: 2,
      staleWorkers: 1,
      stoppedWorkers: 1,
      unknownWorkers: 6,
    });
    const wire = JSON.stringify(result);
    expect(wire).not.toContain("private-");
    expect(wire).not.toContain(agentQueue);
    expect(wire).not.toContain("hostname");
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
    expect(await npCollectAgentWorkerHealthV1({ now })).toMatchObject({
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
        expect(await npCollectAgentWorkerHealthV1({ db, now })).toMatchObject({
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
      expect(await npCollectAgentWorkerHealthV1({ db, now })).toMatchObject({
        state: "observed",
        sampledWorkers: 0,
        hasMore: false,
        subscribedWorkers: 0,
        unknownWorkers: 0,
      });
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
      expect(await npCollectAgentWorkerHealthV1({ now })).toMatchObject({
        state: "unavailable",
        sampledWorkers: null,
        subscribedWorkers: null,
      });
      expect(await npCollectAgentWorkerHealthV1({ db: drizzle(client), now })).toMatchObject({
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
    let evidence: unknown = subscription("active");
    const loop = startHeartbeatLoop(
      { [NP_WORKER_SUBSCRIPTION_META_KEY]: subscription("active") },
      20,
      () => evidence,
    );
    try {
      await expect
        .poll(async () => (await npCollectAgentWorkerHealthV1()).subscribedWorkers)
        .toBe(1);
      expect(await npCollectAgentWorkerHealthV1()).toMatchObject({
        sampledWorkers: 2,
        unknownWorkers: 1,
      });
      evidence = subscription("paused");
      await expect.poll(async () => (await npCollectAgentWorkerHealthV1()).pausedWorkers).toBe(1);
      evidence = undefined;
      await expect.poll(async () => (await npCollectAgentWorkerHealthV1()).unknownWorkers).toBe(2);
      expect((await npCollectAgentWorkerHealthV1()).subscribedWorkers).toBe(0);
      evidence = subscription("active");
      await expect
        .poll(async () => (await npCollectAgentWorkerHealthV1()).subscribedWorkers)
        .toBe(1);
    } finally {
      await loop.stop();
    }
    expect(await npCollectAgentWorkerHealthV1()).toMatchObject({
      sampledWorkers: 2,
      subscribedWorkers: 0,
      stoppedWorkers: 1,
      unknownWorkers: 1,
    });
  });
});
