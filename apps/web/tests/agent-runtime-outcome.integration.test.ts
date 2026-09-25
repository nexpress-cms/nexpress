import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { npAgentRuns } from "../../../packages/core/src/db/schema/agent.js";
import { npCollectAgentRuntimeOutcomeV1 } from "../../../packages/core/src/agent/runtime-outcome-health.js";
import {
  NP_AGENT_RUNTIME_OUTCOME_STATES,
  npRequireAgentRuntimeOutcomeV1,
} from "../../../packages/core/src/agent-contract/runtime-outcome-contract.js";
import {
  npCreateRuntimePersistenceFixture,
  npRuntimePersistenceRun,
} from "./agent-runtime-persistence-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function connect() {
  const client = new Client({ connectionString: getTestDatabaseUrl() });
  await client.connect();
  return client;
}

describe.skipIf(skipIfNoTestDb())("Runtime outcome observation", () => {
  let client: Client;
  beforeAll(async () => {
    await ensureMigrated();
    client = await connect();
  });
  afterEach(truncateAll);
  afterAll(async () => {
    await client?.end();
    await closeTestDb();
  });

  it("observes real terminal transitions across sites and distinguishes unfinished deadlines and execution leases", async () => {
    const a = await npCreateRuntimePersistenceFixture("outcome-a"),
      b = await npCreateRuntimePersistenceFixture("outcome-b");
    const now = Date.now(),
      queuedAt = new Date(now - 120_000),
      startedAt = new Date(now - 60_000),
      deadlineAt = new Date(now + 60_000),
      finishedAt = new Date(now - 1_000);
    const empty = await npCollectAgentRuntimeOutcomeV1({ db: drizzle(client) });
    expect(empty.state).toBe("observed");
    expect(empty.active.unfinished).toBe(0);
    for (const [i, state] of NP_AGENT_RUNTIME_OUTCOME_STATES.entries()) {
      const run = npRuntimePersistenceRun(i % 2 ? b : a, {
        queuedAt,
        deadlineAt,
        goal: "private-runtime-goal",
      });
      await a.db.insert(npAgentRuns).values(run);
      await a.db.update(npAgentRuns).set({ state, finishedAt }).where(eq(npAgentRuns.id, run.id!));
    }
    await a.db.insert(npAgentRuns).values([
      npRuntimePersistenceRun(a, {
        state: "succeeded",
        queuedAt: new Date(now - 172_800_000),
        deadlineAt: new Date(now - 172_740_000),
        finishedAt: new Date(now - 86_460_000),
      }),
      // Unfinished observations are not limited to the terminal 24-hour window.
      npRuntimePersistenceRun(b, {
        queuedAt: new Date(now - 172_800_000),
        deadlineAt: new Date(now - 172_740_000),
      }),
      npRuntimePersistenceRun(a, { queuedAt, deadlineAt }),
      npRuntimePersistenceRun(b, { queuedAt, deadlineAt: new Date(now - 10_000) }),
      npRuntimePersistenceRun(a, { state: "waiting_approval", queuedAt, deadlineAt }),
      npRuntimePersistenceRun(a, {
        state: "running",
        queuedAt,
        startedAt,
        deadlineAt,
        leaseUntil: new Date(now - 10_000),
      }),
      npRuntimePersistenceRun(b, {
        state: "verifying",
        queuedAt,
        startedAt,
        deadlineAt,
        leaseUntil: null,
      }),
      npRuntimePersistenceRun(a, {
        state: "running",
        queuedAt,
        startedAt,
        deadlineAt,
        leaseUntil: new Date(now + 30_000),
      }),
    ]);
    const before = (await client.query("select * from np_agent_runs order by id")).rows;
    const result = await npCollectAgentRuntimeOutcomeV1({ db: drizzle(client) });
    expect(npRequireAgentRuntimeOutcomeV1(result)).toEqual(result);
    expect(result.state).toBe("observed");
    expect(Date.parse(result.generatedAt) - Date.parse(result.windowStart)).toBe(86_400_000);
    expect(result.outcomes).toEqual(
      NP_AGENT_RUNTIME_OUTCOME_STATES.map((state) => ({
        state,
        count: 1,
        lastFinishedAt: finishedAt.toISOString(),
      })),
    );
    expect(result.active).toEqual({
      unfinished: 7,
      deadlineElapsed: 2,
      executing: 3,
      leaseElapsed: 1,
      leaseMissing: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/private-runtime-goal|outcome-a|outcome-b/);
    expect((await client.query("select * from np_agent_runs order by id")).rows).toEqual(before);
  });

  it("uses inclusive millisecond window bounds and rejects unavailable storage without broadening scope", async () => {
    const fixture = await npCreateRuntimePersistenceFixture();
    await fixture.db.insert(npAgentRuns).values(
      NP_AGENT_RUNTIME_OUTCOME_STATES.map((state) =>
        npRuntimePersistenceRun(fixture, {
          state,
          finishedAt: new Date("2026-09-01T00:00:30.000Z"),
        }),
      ),
    );
    const searchPath = (await client.query("show search_path")).rows[0]?.search_path;
    // A session-local projection of real records pins boundary timestamps to the
    // collector statement clock. Stored-row semantics are covered above; this
    // fixture makes exact inclusive bounds deterministic without clock injection.
    await client.query(`create temp view np_agent_runs as
      select case when state='budget_blocked' then 'gateway' else origin end as origin,
        state, date_trunc('milliseconds',statement_timestamp())-interval '24 hours 1 minute' as queued_at,
        null::timestamptz as started_at,
        date_trunc('milliseconds',statement_timestamp())-interval '1 minute' as deadline_at,
        null::timestamptz as lease_until,
        case state when 'succeeded' then date_trunc('milliseconds',statement_timestamp())
          when 'failed' then date_trunc('milliseconds',statement_timestamp())-interval '24 hours'
          when 'cancelled' then date_trunc('milliseconds',statement_timestamp())-interval '24 hours 1 millisecond'
          else date_trunc('milliseconds',statement_timestamp())-interval '1 second' end as finished_at
      from public.np_agent_runs`);
    try {
      const result = await npCollectAgentRuntimeOutcomeV1({ db: drizzle(client) });
      expect(result.state).toBe("observed");
      expect(result.outcomes.map((row) => row.count)).toEqual([1, 1, 0, 1, 0]);
      expect(result.outcomes[0]?.lastFinishedAt).toBe(result.generatedAt);
      expect(result.outcomes[1]?.lastFinishedAt).toBe(result.windowStart);
      await client.query("drop view pg_temp.np_agent_runs");
      await client.query("set search_path=pg_catalog");
      expect((await npCollectAgentRuntimeOutcomeV1({ db: drizzle(client) })).state).toBe(
        "unsupported",
      );
      await client.query("create temp view np_agent_runs as select 1 as unrelated");
      const incompatible = await npCollectAgentRuntimeOutcomeV1({ db: drizzle(client) });
      expect(incompatible.state).toBe("unavailable");
      expect(Object.values(incompatible.active).every((value) => value === null)).toBe(true);
    } finally {
      await client.query("drop view if exists pg_temp.np_agent_runs");
      await client.query("select set_config('search_path',$1,false)", [searchPath]);
    }
  });

  it("fails closed for future retained chronology and preserves the original Client timeout after a blocked read", async () => {
    const fixture = await npCreateRuntimePersistenceFixture();
    const now = Date.now();
    const run = npRuntimePersistenceRun(fixture, {
      queuedAt: new Date(now - 1_000),
      deadlineAt: new Date(now + 60_000),
      state: "succeeded",
      finishedAt: new Date(now + 30_000),
    });
    await fixture.db.insert(npAgentRuns).values(run);
    const unknown = await npCollectAgentRuntimeOutcomeV1({ db: drizzle(client) });
    expect(unknown.state).toBe("unavailable");
    expect(unknown.outcomes.every((row) => row.count === null && row.lastFinishedAt === null)).toBe(
      true,
    );
    expect(Object.values(unknown.active).every((value) => value === null)).toBe(true);
    await fixture.db
      .update(npAgentRuns)
      .set({ finishedAt: new Date(now) })
      .where(eq(npAgentRuns.id, run.id!));
    const holder = await connect();
    try {
      await holder.query("begin; lock table np_agent_runs in access exclusive mode");
      for (const timeout of ["50ms", "1500ms"]) {
        await client.query("select set_config('statement_timeout',$1,false)", [timeout]);
        expect((await npCollectAgentRuntimeOutcomeV1({ db: drizzle(client) })).state).toBe(
          "unavailable",
        );
        expect((await client.query("show statement_timeout")).rows[0]?.statement_timeout).toBe(
          timeout,
        );
      }
      await holder.query("rollback");
      expect((await npCollectAgentRuntimeOutcomeV1({ db: drizzle(client) })).state).toBe(
        "observed",
      );
      expect((await client.query("show statement_timeout")).rows[0]?.statement_timeout).toBe(
        "1500ms",
      );
    } finally {
      await holder.query("rollback");
      await holder.end();
      await client.query("set statement_timeout=0");
    }
  });
});
