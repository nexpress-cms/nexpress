import { eq } from "drizzle-orm";
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
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import { npCollectAgentBudgetHealthV1 } from "../../../packages/core/src/agent/budget-health.js";
import { getDb, resetDb, setDb } from "../../../packages/core/src/db/runtime.js";
import { npSettings, npSites } from "../../../packages/core/src/db/schema/system.js";
import { npAgentUsageDaily } from "../../../packages/core/src/db/schema/agent.js";

async function connectedClient() {
  const connectionString = getTestDatabaseUrl();
  if (!connectionString) throw new Error("TEST_DATABASE_URL not set");
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

describe.skipIf(skipIfNoTestDb())("Agent budget Health observations", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("measures an empty existing site without creating Runtime settings or usage", async () => {
    const db = await getTestDb();
    const before = await db.select().from(npSettings);
    expect(await npCollectAgentBudgetHealthV1()).toMatchObject({
      state: "observed",
      sampledSites: 1,
      hasMore: false,
      measuredSites: 1,
      unresolvedUsageSites: 0,
      unavailableSites: 0,
    });
    expect(await db.select().from(npSettings)).toEqual(before);
    expect(await db.select().from(npAgentUsageDaily)).toHaveLength(0);
  });

  it("distinguishes unresolved provider usage from invalid retained daily evidence", async () => {
    const f = await runtimeUsageFixture();
    try {
      const request = await f.request();
      await f.usage.reserve({ siteId, runId: f.runId, request });
      await f.usage.beginDispatch({ siteId, runId: f.runId, request });
      await f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(request, {
          schemaVersion: "np.agent-provider-invoke-outcome.v1",
          status: "ambiguous",
          provider: request.provider,
          model: request.model,
          providerRequestId: null,
          output: null,
          errorClass: "timeout",
          safeCode: "PROVIDER_TIMEOUT",
          retryable: false,
          dispatchState: "unknown",
          usage: null,
          finishReason: null,
          latencyMs: 30_000,
        }),
      });
      const unresolved = await npCollectAgentBudgetHealthV1({ now: f.options.now() });
      expect(unresolved).toMatchObject({
        state: "observed",
        sampledSites: 3,
        measuredSites: 2,
        unresolvedUsageSites: 1,
        unavailableSites: 0,
      });
      const decision = {
        task: "interactive-capability" as const,
        decision: { kind: "complete" as const, summary: "Synthetic observation completed." },
      };
      await f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(
          request,
          {
            schemaVersion: "np.agent-provider-invoke-outcome.v1",
            status: "succeeded",
            provider: request.provider,
            model: request.model,
            providerRequestId: "budget-health-fixture",
            output: decision,
            usage: {
              inputTokens: 6,
              cachedInputTokens: 2,
              outputTokens: 3,
              tokenSource: "provider",
              costMicros: 11,
              costSource: "adapter-estimate",
            },
            finishReason: "stop",
            latencyMs: 10,
          },
          decision,
        ),
      });
      expect(await npCollectAgentBudgetHealthV1({ now: f.options.now() })).toMatchObject({
        measuredSites: 3,
        unresolvedUsageSites: 0,
        unavailableSites: 0,
      });
      await f.db.delete(npAgentUsageDaily).where(eq(npAgentUsageDaily.siteId, siteId));
      const invalid = await npCollectAgentBudgetHealthV1({ now: f.options.now() });
      expect(invalid).toMatchObject({
        sampledSites: 3,
        measuredSites: 2,
        unresolvedUsageSites: 0,
        unavailableSites: 1,
      });
      for (const evidence of [unresolved, invalid]) {
        const wire = JSON.stringify(evidence);
        expect(wire).not.toContain(siteId);
        expect(wire).not.toContain(request.providerCallId);
        expect(wire).not.toContain(f.runId);
        expect(wire).not.toContain("costMicros");
      }
    } finally {
      await f.dispose();
    }
  });

  it("reports invalid site controls as unavailable without treating them as unresolved usage", async () => {
    const db = await getTestDb();
    await db.insert(npSettings).values({
      siteId: "default",
      key: "agents.runtime",
      value: { credential: "private-invalid-control" },
    });
    const before = await db.select().from(npSettings);
    const evidence = await npCollectAgentBudgetHealthV1();
    expect(evidence).toMatchObject({
      state: "observed",
      sampledSites: 1,
      measuredSites: 0,
      unresolvedUsageSites: 0,
      unavailableSites: 1,
    });
    expect(JSON.stringify(evidence)).not.toContain("private-invalid-control");
    expect(await db.select().from(npSettings)).toEqual(before);
  });

  it("bounds the sorted site sample and does not inspect or mutate the sentinel site", async () => {
    const db = await getTestDb();
    await db.insert(npSites).values(
      Array.from({ length: 25 }, (_, index) => ({
        id: `budget-private-${index.toString().padStart(2, "0")}`,
        name: "Private fixture site",
      })),
    );
    // 'default' sorts after these 25 sites: its invalid controls must not enter the sample.
    await db.insert(npSettings).values({ siteId: "default", key: "agents.runtime", value: {} });
    const beforeSettings = await db.select().from(npSettings);
    const beforeSites = await db.select().from(npSites).orderBy(npSites.id);
    const evidence = await npCollectAgentBudgetHealthV1();
    expect(evidence).toMatchObject({
      state: "observed",
      sampledSites: 25,
      hasMore: true,
      measuredSites: 25,
      unresolvedUsageSites: 0,
      unavailableSites: 0,
    });
    expect(JSON.stringify(evidence)).not.toContain("budget-private");
    expect(JSON.stringify(evidence)).not.toContain("default");
    expect(await db.select().from(npSettings)).toEqual(beforeSettings);
    expect(await db.select().from(npSites).orderBy(npSites.id)).toEqual(beforeSites);
  });

  it("honors the quota lock and restores both stricter and looser host statement timeouts", async () => {
    const holder = await connectedClient();
    const observer = await connectedClient();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        "np:site-quota:default",
      ]);
      const db = drizzle(observer);
      for (const timeout of ["50ms", "1500ms"]) {
        await observer.query("select set_config('statement_timeout',$1,false)", [timeout]);
        expect(await npCollectAgentBudgetHealthV1({ db })).toMatchObject({
          state: "observed",
          sampledSites: 1,
          measuredSites: 0,
          unresolvedUsageSites: 0,
          unavailableSites: 1,
        });
        expect((await observer.query("show statement_timeout")).rows[0]?.statement_timeout).toBe(
          timeout,
        );
      }
      await holder.query("rollback");
      expect(await npCollectAgentBudgetHealthV1({ db })).toMatchObject({
        measuredSites: 1,
        unavailableSites: 0,
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

  it("reuses a Doctor-owned connected Client when the runtime singleton is unavailable", async () => {
    const original = getDb();
    const client = await connectedClient();
    try {
      resetDb(original);
      expect(await npCollectAgentBudgetHealthV1()).toMatchObject({
        state: "unavailable",
        sampledSites: null,
        hasMore: null,
        measuredSites: null,
        unresolvedUsageSites: null,
        unavailableSites: null,
      });
      expect(await npCollectAgentBudgetHealthV1({ db: drizzle(client) })).toMatchObject({
        state: "observed",
        sampledSites: 1,
        measuredSites: 1,
      });
      // Ownership stays with Doctor: collection neither closes the handle nor replaces the singleton.
      expect((await client.query("select 1 as alive")).rows).toEqual([{ alive: 1 }]);
      expect(() => getDb()).toThrow("Database not initialized");
    } finally {
      setDb(original);
      await client.end();
    }
  });
});
