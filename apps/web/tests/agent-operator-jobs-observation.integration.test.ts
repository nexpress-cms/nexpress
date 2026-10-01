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
import { npCollectOperatorJobsObservationV1 } from "../../../packages/core/src/jobs/operator-observation.js";
import { PgBossAdapter } from "../../../packages/core/src/jobs/pg-boss-adapter.js";

async function connect() {
  const client = new Client({ connectionString: getTestDatabaseUrl() });
  await client.connect();
  return client;
}

async function installStorage() {
  const url = getTestDatabaseUrl();
  if (!url) throw new Error("TEST_DATABASE_URL not set");
  const adapter = new PgBossAdapter(url, { supervise: false, schedule: false });
  try {
    await adapter.startProducer();
    for (const name of [
      "agent.runExecute",
      "content.afterSave",
      "agent.scheduleTick",
      "custom.queue",
    ])
      await adapter.getBoss().createQueue(name, { partition: name === "content.afterSave" });
  } finally {
    await adapter.stop();
  }
}

describe.skipIf(skipIfNoTestDb())("Operator site job observations", () => {
  let client: Client;
  const read = (maxTargets = 1000) =>
    npCollectOperatorJobsObservationV1({ siteId: "site-a", maxTargets, db: drizzle(client) });
  beforeAll(async () => {
    await ensureMigrated();
    client = await connect();
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

  it("distinguishes missing/incompatible source from observed empty retained cohort and validates input", async () => {
    await expect(
      npCollectOperatorJobsObservationV1({ siteId: "Bad", maxTargets: 1, db: drizzle(client) }),
    ).rejects.toThrow("site");
    await expect(read(1001)).rejects.toThrow("bound");
    expect(await read()).toMatchObject({
      state: "unsupported",
      inspectedCount: null,
      failed: null,
      complete: false,
    });
    expect(
      (await client.query("select to_regclass('pgboss.job') as relation")).rows[0]?.relation,
    ).toBeNull();
    await client.query("create schema pgboss; create table pgboss.job(name text)");
    expect(await read()).toMatchObject({ state: "unavailable", created: null });
    await client.query("drop schema pgboss cascade");
    await installStorage();
    const empty = await read();
    expect(empty).toMatchObject({
      state: "observed",
      inspectedCount: 0,
      complete: true,
      created: 0,
      failed: 0,
    });
    expect(Date.parse(empty.generatedAt) - Date.parse(empty.windowStart)).toBe(86_400_000);
  });

  it("observes only matching framework site payloads and recent retained cohort without leaking or changing records", async () => {
    await installStorage();
    await client.query(`insert into pgboss.job(name,state,created_on,start_after,started_on,data,output) values
      ('agent.runExecute','created',now()-interval '5 minutes',now()-interval '4 minutes',null,'{"siteId":"site-a","secret":"private-payload"}','"private-output"'),
      ('content.afterSave','retry',now()-interval '3 minutes',now()+interval '1 hour',null,'{"siteId":"site-a"}',null),
      ('agent.runExecute','active',now()-interval '2 minutes',now()-interval '2 minutes',now()-interval '1 minute','{"siteId":"site-a"}',null),
      ('agent.runExecute','completed',now()-interval '2 minutes',now(),null,'{"siteId":"site-a"}',null),
      ('agent.runExecute','failed',now()-interval '2 minutes',now(),null,'{"siteId":"site-a"}',null),
      ('agent.runExecute','cancelled',now()-interval '2 minutes',now(),null,'{"siteId":"site-a"}',null),
      ('agent.runExecute','failed',now()-interval '25 hours',now(),null,'{"siteId":"site-a"}',null),
      ('agent.runExecute','failed',now()+interval '1 hour',now(),null,'{"siteId":"site-a"}',null),
      ('agent.runExecute','failed',now(),now(),null,'{"siteId":"site-b"}',null),
      ('agent.runExecute','failed',now(),now(),null,'{"siteId":123}',null),
      ('agent.runExecute','failed',now(),now(),null,'{}',null),
      ('agent.scheduleTick','failed',now(),now(),null,'{"siteId":"site-a"}',null),
      ('custom.queue','failed',now(),now(),null,'{"siteId":"site-a"}',null)`);
    const before = (await client.query("select * from pgboss.job order by id")).rows;
    const observed = await read();
    expect(observed).toMatchObject({
      state: "observed",
      complete: true,
      inspectedCount: 6,
      created: 1,
      retry: 1,
      active: 1,
      completed: 1,
      failed: 1,
      cancelled: 1,
    });
    expect(observed.oldestReadyAgeSeconds).toBeGreaterThanOrEqual(240);
    const wire = JSON.stringify(observed);
    expect(wire).not.toMatch(/private-|site-b|custom\.queue|agent\.scheduleTick/);
    for (const row of before) expect(wire).not.toContain(row.id);
    expect((await client.query("select * from pgboss.job order by id")).rows).toEqual(before);
    const bounded = await read(2);
    expect(bounded).toMatchObject({ state: "observed", complete: false, inspectedCount: 2 });
    expect(
      (bounded.created ?? 0) +
        (bounded.retry ?? 0) +
        (bounded.active ?? 0) +
        (bounded.failed ?? 0) +
        (bounded.completed ?? 0) +
        (bounded.cancelled ?? 0),
    ).toBe(2);
  });

  it("does not return partial success for malformed clocks and restores bounded read timeout after blocked storage", async () => {
    await installStorage();
    await client.query(
      `insert into pgboss.job(name,state,data) values ('agent.runExecute','active','{"siteId":"site-a"}')`,
    );
    expect(await read()).toMatchObject({ state: "unavailable", inspectedCount: null });
    await client.query("update pgboss.job set started_on=now()");
    const holder = await connect();
    try {
      await holder.query("begin; lock table pgboss.job in access exclusive mode");
      await client.query("set statement_timeout='50ms'");
      expect(await read()).toMatchObject({ state: "unavailable", active: null });
      expect((await client.query("show statement_timeout")).rows[0]?.statement_timeout).toBe(
        "50ms",
      );
      await holder.query("rollback");
      expect(await read()).toMatchObject({ state: "observed", active: 1 });
    } finally {
      await holder.query("rollback");
      await holder.end();
      await client.query("set statement_timeout=0");
    }
  });
});
