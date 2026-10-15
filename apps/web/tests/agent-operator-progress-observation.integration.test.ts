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
import { npCollectOperatorProgressObservationV1 } from "../../../packages/core/src/jobs/operator-progress-observation.js";
import { PgBossAdapter } from "../../../packages/core/src/jobs/pg-boss-adapter.js";

async function connect() {
  const url = getTestDatabaseUrl();
  if (!url) throw new Error("TEST_DATABASE_URL not set");
  const client = new Client({ connectionString: url });
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
      "agent.scheduleTick",
      "content.afterSave",
      "custom.queue",
    ])
      await adapter.getBoss().createQueue(name, { partition: name === "content.afterSave" });
  } finally {
    await adapter.stop();
  }
}

describe.skipIf(skipIfNoTestDb())("Operator retained job transition observations", () => {
  let client: Client;
  const read = (maxTargets = 1000) =>
    npCollectOperatorProgressObservationV1({
      scope: { kind: "site", siteId: "site-a" },
      maxTargets,
      db: drizzle(client),
    });
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

  it("validates scope and bounds without installing missing or incompatible sources", async () => {
    await expect(read(1001)).rejects.toThrow("request");
    await expect(
      npCollectOperatorProgressObservationV1({
        scope: { kind: "site", siteId: "Bad" },
        maxTargets: 1,
        db: drizzle(client),
      }),
    ).rejects.toThrow("request");
    expect(await read()).toMatchObject({
      state: "unsupported",
      complete: false,
      started: null,
      completed: null,
    });
    expect(
      (await client.query("select to_regclass('pgboss.job') as relation")).rows[0]?.relation,
    ).toBeNull();
    await client.query("create schema pgboss; create table pgboss.job(name text)");
    expect(await read()).toMatchObject({ state: "unavailable", inspectedCount: null });
    await client.query("drop schema pgboss cascade");
    await installStorage();
    const empty = await read();
    expect(empty).toMatchObject({
      state: "observed",
      complete: true,
      inspectedCount: 0,
      started: 0,
      completed: 0,
    });
    expect(Date.parse(empty.generatedAt) - Date.parse(empty.windowStart)).toBe(900_000);
  });

  it("uses actual transition timestamps and preserves site versus deployment attribution", async () => {
    await installStorage();
    await client.query(`insert into pgboss.job(name,state,created_on,start_after,started_on,completed_on,data,output) values
      ('agent.runExecute','active',now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '4 minutes',null,'{"siteId":"site-a","secret":"private-payload"}','"private-output"'),
      ('agent.runExecute','completed',now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '10 minutes',now()-interval '1 minute','{"siteId":"site-a"}',null),
      ('agent.runExecute','failed',now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '16 minutes',now()-interval '2 minutes','{"siteId":"site-a"}',null),
      ('agent.runExecute','cancelled',now()-interval '20 minutes',now()-interval '20 minutes',null,now()-interval '3 minutes','{"siteId":"site-a"}',null),
      ('agent.runExecute','retry',now()-interval '20 minutes',now()+interval '1 hour',now()-interval '5 minutes',null,'{"siteId":"site-a"}',null),
      ('agent.runExecute','completed',now()-interval '30 minutes',now()-interval '30 minutes',now()-interval '20 minutes',now()-interval '16 minutes','{"siteId":"site-a"}',null),
      ('agent.runExecute','created',now(),now()+interval '1 hour',null,null,'{"siteId":"site-a"}',null),
      ('agent.runExecute','active',now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '5 minutes',null,'{"siteId":"site-b"}',null),
      ('agent.scheduleTick','completed',now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '5 minutes',now()-interval '4 minutes','{}',null),
      ('content.afterSave','completed',now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '5 minutes',now()-interval '4 minutes','{"siteId":"site-a"}',null),
      ('custom.queue','completed',now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '5 minutes',now()-interval '4 minutes','{"siteId":"site-a"}',null)`);
    const before = (await client.query("select * from pgboss.job order by id")).rows;
    const site = await read();
    expect(site).toMatchObject({
      state: "observed",
      complete: true,
      inspectedCount: 6,
      started: 4,
      completed: 2,
      failed: 1,
      cancelled: 1,
    });
    const deployment = await npCollectOperatorProgressObservationV1({
      scope: { kind: "deployment" },
      maxTargets: 1000,
      db: drizzle(client),
    });
    expect(deployment).toMatchObject({
      state: "observed",
      complete: true,
      inspectedCount: 7,
      started: 5,
      completed: 2,
      failed: 1,
      cancelled: 1,
    });
    expect(JSON.stringify(site)).not.toMatch(/private-|site-b|custom\.queue|agent\.scheduleTick/);
    expect(JSON.stringify(deployment)).not.toMatch(
      /private-|site-a|site-b|content\.afterSave|custom\.queue/,
    );
    for (const row of before) {
      expect(JSON.stringify(site)).not.toContain(row.id);
      expect(JSON.stringify(deployment)).not.toContain(row.id);
    }
    expect((await client.query("select * from pgboss.job order by id")).rows).toEqual(before);
    expect(await read(2)).toMatchObject({ state: "observed", complete: false, inspectedCount: 2 });
  });

  it("discards malformed transition clocks and restores timeout after a blocked source", async () => {
    await installStorage();
    await client.query(`insert into pgboss.job(name,state,created_on,start_after,started_on,completed_on,data) values
      ('agent.runExecute','completed',now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '5 minutes',now()+interval '1 minute','{"siteId":"site-a"}')`);
    expect(await read()).toMatchObject({ state: "unavailable", completed: null, complete: false });
    await client.query("update pgboss.job set completed_on=now()");
    const holder = await connect();
    try {
      await holder.query("begin; lock table pgboss.job in access exclusive mode");
      await client.query("set statement_timeout='50ms'");
      expect(await read()).toMatchObject({ state: "unavailable", inspectedCount: null });
      expect((await client.query("show statement_timeout")).rows[0]?.statement_timeout).toBe(
        "50ms",
      );
      await holder.query("rollback");
      expect(await read()).toMatchObject({ state: "observed", started: 1, completed: 1 });
    } finally {
      await holder.query("rollback");
      await holder.end();
      await client.query("set statement_timeout=0");
    }
  });
});
