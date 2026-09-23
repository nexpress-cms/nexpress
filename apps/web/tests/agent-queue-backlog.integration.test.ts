import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import { getDb, resetDb, setDb } from "../../../packages/core/src/db/runtime.js";
import { npCollectAgentQueueBacklogV1 } from "../../../packages/core/src/jobs/agent-queue-backlog.js";
import { PgBossAdapter } from "../../../packages/core/src/jobs/pg-boss-adapter.js";
import {
  npRequireAgentQueueBacklogV1,
  type NpAgentQueueBacklogV1,
} from "../../../packages/core/src/jobs-contract/agent-queue-backlog-contract.js";
import { NP_AGENT_WORKER_QUEUE_NAMES } from "../../../packages/core/src/jobs-contract/worker-subscription-contract.js";

async function connectedClient() {
  const connectionString = getTestDatabaseUrl();
  if (!connectionString) throw new Error("TEST_DATABASE_URL not set");
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

function emptyQueues(available: boolean) {
  return NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
    queue,
    createdReady: available ? 0 : null,
    createdScheduled: available ? 0 : null,
    retryReady: available ? 0 : null,
    retryScheduled: available ? 0 : null,
    active: available ? 0 : null,
    oldestReadyAgeSeconds: null,
    oldestActiveAgeSeconds: null,
  }));
}

function expectUnknown(result: NpAgentQueueBacklogV1, state: "unsupported" | "unavailable") {
  expect(result.state).toBe(state);
  expect(result.queues).toEqual(emptyQueues(false));
  expect(npRequireAgentQueueBacklogV1(result)).toEqual(result);
}

async function installStorage() {
  const connectionString = getTestDatabaseUrl();
  if (!connectionString) throw new Error("TEST_DATABASE_URL not set");
  // Install the real schema only in this isolated fixture. No worker is started;
  // stop the fixture producer before observing so it cannot affect the facts.
  const adapter = new PgBossAdapter(connectionString, { supervise: false, schedule: false });
  try {
    await adapter.startProducer();
    for (const name of ["agent.runExecute", "agent.eventDispatch", "unrelated.queue"]) {
      await adapter.getBoss().createQueue(name, { partition: name === "agent.eventDispatch" });
    }
  } finally {
    await adapter.stop();
  }
}

describe.skipIf(skipIfNoTestDb())("Agent queue backlog observations", () => {
  let client: Client;
  beforeAll(async () => {
    await ensureMigrated();
    client = await connectedClient();
  });
  beforeEach(async () => {
    await client.query("drop schema if exists pgboss cascade");
    await truncateAll();
  });
  afterEach(async () => {
    await client.query("drop schema if exists pgboss cascade");
  });
  afterAll(async () => {
    await client?.end();
    await closeTestDb();
  });

  it("distinguishes absent, incompatible and observed empty storage without initializing it", async () => {
    const db = drizzle(client);
    expectUnknown(await npCollectAgentQueueBacklogV1({ db }), "unsupported");
    expect((await client.query("select to_regclass('pgboss.job') as relation")).rows).toEqual([
      { relation: null },
    ]);
    await client.query("create schema pgboss; create table pgboss.job(name text)");
    expectUnknown(await npCollectAgentQueueBacklogV1({ db }), "unavailable");
    await client.query("drop schema pgboss cascade");
    await installStorage();
    const result = await npCollectAgentQueueBacklogV1({ db });
    expect(result.state).toBe("observed");
    expect(result.queues).toEqual(emptyQueues(true));
    expect(npRequireAgentQueueBacklogV1(result)).toEqual(result);
  });

  it("separates due work from scheduling/backoff across retained queues without exposing or changing jobs", async () => {
    await installStorage();
    const readyAt = new Date(Date.now() - 123_456);
    const retryAt = new Date(readyAt.getTime() + 40_000);
    const activeAt = new Date(readyAt.getTime() + 10_000);
    const futureAt = new Date(Date.now() + 86_400_000);
    await client.query(
      `insert into pgboss.job(name,state,created_on,start_after,started_on,data,output)
       values
       ('agent.runExecute','created',now()-interval '30 days',$1,null,'{"siteId":"private-site-a","secret":"private-payload"}','"private-output"'),
       ('agent.runExecute','created',now()-interval '30 days',$4,null,'{"siteId":"private-site-b"}',null),
       ('agent.runExecute','retry',now()-interval '30 days',$2,null,'{}',null),
       ('agent.runExecute','retry',now()-interval '30 days',$4,null,'{}',null),
       ('agent.runExecute','active',now()-interval '30 days',$1,$3,'{}',null),
       ('agent.eventDispatch','created',now()-interval '30 days',$2,null,'{}',null),
       ('agent.runExecute','completed',now()-interval '30 days',$1,null,'{}',null),
       ('agent.runExecute','failed',now()-interval '30 days',$1,null,'{}',null),
       ('agent.runExecute','cancelled',now()-interval '30 days',$1,null,'{}',null),
       ('unrelated.queue','active',now()-interval '30 days',$1,null,'{}',null)`,
      [readyAt, retryAt, activeAt, futureAt],
    );
    const before = (await client.query("select * from pgboss.job order by name,id")).rows;
    const result = await npCollectAgentQueueBacklogV1({ db: drizzle(client) });
    expect(result.state).toBe("observed");
    const observedAt = Date.parse(result.generatedAt);
    expect(result.queues).toEqual(
      emptyQueues(true).map((row) =>
        row.queue === "agent.runExecute"
          ? {
              ...row,
              createdReady: 1,
              createdScheduled: 1,
              retryReady: 1,
              retryScheduled: 1,
              active: 1,
              oldestReadyAgeSeconds: Math.floor((observedAt - readyAt.getTime()) / 1000),
              oldestActiveAgeSeconds: Math.floor((observedAt - activeAt.getTime()) / 1000),
            }
          : row.queue === "agent.eventDispatch"
            ? {
                ...row,
                createdReady: 1,
                oldestReadyAgeSeconds: Math.floor((observedAt - retryAt.getTime()) / 1000),
              }
            : row,
      ),
    );
    const wire = JSON.stringify(result);
    expect(wire).not.toMatch(/private-|siteId|unrelated\.queue/);
    for (const job of before) expect(wire).not.toContain(job.id);
    expect((await client.query("select * from pgboss.job order by name,id")).rows).toEqual(before);
  });

  it("rejects invalid retained clocks instead of presenting partial counts", async () => {
    await installStorage();
    await client.query("insert into pgboss.job(name,state) values ('agent.runExecute','active')");
    // NULL, future and infinite active clocks are not measurable elapsed work.
    for (const startedOn of [null, "2099-01-01T00:00:00Z", "infinity", "-infinity"]) {
      await client.query("update pgboss.job set started_on=$1", [startedOn]);
      expectUnknown(await npCollectAgentQueueBacklogV1({ db: drizzle(client) }), "unavailable");
    }
    await client.query("update pgboss.job set state='created',start_after='infinity'");
    expectUnknown(await npCollectAgentQueueBacklogV1({ db: drizzle(client) }), "unavailable");
    // A compatible-looking custom/old schema must not silently lose NULL due times.
    await client.query("alter table pgboss.job alter column start_after drop not null");
    await client.query("update pgboss.job set start_after=null");
    expectUnknown(await npCollectAgentQueueBacklogV1({ db: drizzle(client) }), "unavailable");
  });

  it("bounds blocked reads and restores original Client timeouts and ownership after recovery", async () => {
    await installStorage();
    const holder = await connectedClient();
    const original = getDb();
    try {
      resetDb(original);
      expectUnknown(await npCollectAgentQueueBacklogV1(), "unavailable");
      await holder.query("begin; lock table pgboss.job in access exclusive mode");
      for (const timeout of ["50ms", "1500ms"]) {
        await client.query("select set_config('statement_timeout',$1,false)", [timeout]);
        expectUnknown(await npCollectAgentQueueBacklogV1({ db: drizzle(client) }), "unavailable");
        expect((await client.query("show statement_timeout")).rows[0]?.statement_timeout).toBe(
          timeout,
        );
      }
      await holder.query("rollback");
      const recovered = await npCollectAgentQueueBacklogV1({ db: drizzle(client) });
      expect(recovered.state).toBe("observed");
      expect(recovered.queues).toEqual(emptyQueues(true));
      expect((await client.query("show statement_timeout")).rows[0]?.statement_timeout).toBe(
        "1500ms",
      );
      expect((await client.query("select 1 as alive")).rows).toEqual([{ alive: 1 }]);
      expect(() => getDb()).toThrow("Database not initialized");
    } finally {
      setDb(original);
      await holder.query("rollback");
      await holder.end();
      await client.query("set statement_timeout=0");
    }
  });
});
