import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npAgentProviderCalls } from "../../../packages/core/src/db/schema/agent.js";
import { npRequireAgentRuntimeRetainedCallV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof runtimeUsageFixture>>;
type Call = typeof npAgentProviderCalls.$inferSelect;
const fixtures: Fixture[] = [];
async function fixture() {
  const f = await runtimeUsageFixture();
  fixtures.push(f);
  const request = await f.request();
  const receipt = await f.usage.reserve({ siteId, runId: f.runId, request });
  const [call] = await f.db
    .select()
    .from(npAgentProviderCalls)
    .where(eq(npAgentProviderCalls.id, receipt.providerCallId));
  if (!call) throw new Error("Missing deterministic provider call fixture.");
  return { ...f, call };
}

describe.skipIf(skipIfNoTestDb())("Runtime retained provider-call owning proof", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const f of fixtures.splice(0)) await f.dispose();
  });
  afterAll(closeTestDb);

  it("verifies retained bindings independently of optional redacted diagnostic bodies", async () => {
    const f = await fixture();
    const proof = await npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
      npRequireAgentRuntimeRetainedCallV1({
        db,
        call: { ...f.call, requestRedacted: null, responseRedacted: null },
        noWait: true,
      }),
    );
    expect(proof.run.id).toBe(f.call.runId);
    expect(proof.reservation.id).toBe(f.call.usageReservationId);
    expect(proof.pricing.fingerprint).toBe(f.call.pricingFingerprint);
    expect(proof.recipe.id).toBe(f.call.recipeId);
  });

  it("rejects changed call-to-owner attribution before allowing source detail release", async () => {
    const f = await fixture();
    const changes: Partial<Call>[] = [
      { idempotencyKey: randomUUID() },
      { recipeFingerprint: `cj1:sha256:${"Z".repeat(43)}` },
      { connectionConfigSnapshotId: randomUUID() },
      { pricingVersion: f.call.pricingVersion + 1 },
      { instructionDigest: `cj1:sha256:${"Z".repeat(43)}` },
    ];
    for (const change of changes) {
      await expect(
        npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
          npRequireAgentRuntimeRetainedCallV1({ db, call: { ...f.call, ...change }, noWait: true }),
        ),
      ).rejects.toMatchObject({ code: "RUNTIME_USAGE_INVALID" });
    }
  });

  it("does not wait behind an authority owner while maintenance holds its reference fence", async () => {
    const f = await fixture();
    const databaseUrl = getTestDatabaseUrl();
    if (!databaseUrl) throw new Error("Missing integration database URL.");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client
        .query(`SELECT principal_id FROM np_agent_runs WHERE id=$1`, [f.runId])
        .then(async ({ rows }) => {
          await client.query("SELECT id FROM np_agent_principals WHERE id=$1 FOR UPDATE", [
            rows[0].principal_id,
          ]);
        });
      await expect(
        npWithAgentRuntimeControlTransactionV1(siteId, async ({ db }) => {
          await db.execute(
            sql`select id from np_agent_reference_fence where id=1 for update nowait`,
          );
          return npRequireAgentRuntimeRetainedCallV1({ db, call: f.call, noWait: true });
        }),
      ).rejects.toMatchObject({ cause: { code: "55P03" } });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
    await expect(
      npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
        npRequireAgentRuntimeRetainedCallV1({ db, call: f.call, noWait: true }),
      ),
    ).resolves.toMatchObject({ run: { id: f.runId } });
  });
});
