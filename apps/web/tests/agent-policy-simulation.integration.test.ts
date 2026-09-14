import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentPolicies,
  npAgentRuns,
  npAgentProviderCalls,
  npAgentActions,
  npAgentUsageReservations,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { npBuildAgentRuntimeDefinitionInputV1 } from "../../../packages/core/src/agent/runtime-service.js";
import {
  npBuildAgentPolicySimulationFixtureInputV1,
  npRequireAgentPolicySimulationReportV1,
} from "../../../packages/core/src/agent-contract/runtime-policy-simulation.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof runtimeFixture>>;
async function policy(f: Fixture, agentId: string | null = null, empty = false) {
  const rules = structuredClone(f.settings.defaultPolicyRules);
  if (empty) rules.capabilityModes = [];
  return f.service.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.policies.create",
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      ...npBuildAgentRuntimeDefinitionInputV1({
        schemaVersion: "np.agent-policy-definition.v1",
        agentId,
        name: "Synthetic policy",
        instructions: "NEVER_ECHO_GUIDANCE",
        rules,
      }),
    },
  });
}
async function input(f: Fixture, created: Awaited<ReturnType<typeof policy>>) {
  return {
    siteId,
    actor: f.actor.actor,
    operationId: "agents.policies.simulate" as const,
    targetId: created.resourceId,
    command: {
      idempotencyKey: randomUUID(),
      expectedVersion: 1,
      configHash: created.output.contentHash,
      ...(await npBuildAgentPolicySimulationFixtureInputV1()),
    },
  };
}
async function effects(f: Fixture) {
  return Promise.all([
    f.db.select().from(npAgentRuns),
    f.db.select().from(npAgentProviderCalls),
    f.db.select().from(npAgentActions),
    f.db.select().from(npAgentUsageReservations),
    f.db.select().from(npAgentPolicies),
  ]);
}
describe.skipIf(skipIfNoTestDb())("Non-authorizing owned policy simulation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("evaluates four synthetic modes with real ceilings, journals replay, and creates no execution or authority", async () => {
    const f = await runtimeFixture();
    const created = await policy(f);
    const command = await input(f, created);
    f.state.ready = false; // Policy comparison cannot depend on provider/worker readiness.
    const before = await effects(f);
    const first = await f.service.executeAdmin(command);
    const report = npRequireAgentPolicySimulationReportV1(first.output);
    expect(report).toMatchObject({
      nonAuthorizing: true,
      policyId: created.resourceId,
      policyVersion: 1,
      policyHash: created.output.contentHash,
    });
    expect(report.cases).toHaveLength(4);
    for (const row of report.cases)
      expect(row.capabilities).toEqual([
        { capabilityId: "site.inspect", mode: "observe", permissions: ["read"] },
      ]);
    expect(JSON.stringify(report)).not.toContain("NEVER_ECHO_GUIDANCE");
    expect(await f.service.executeAdmin(command)).toEqual({ ...first, replayed: true });
    expect(await effects(f)).toEqual(before);
  });
  it("includes the active site policy when evaluating an Agent override", async () => {
    const f = await runtimeFixture();
    const site = await policy(f, null, true);
    await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.policies.activate",
      targetId: site.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        configHash: site.output.contentHash,
      },
    });
    const override = await policy(f, f.created.resourceId);
    const result = npRequireAgentPolicySimulationReportV1(
      (await f.service.executeAdmin(await input(f, override))).output,
    );
    expect(result.cases.every((entry) => entry.capabilities.length === 0)).toBe(true);
  });
  it("rejects forged fixture hashes, arbitrary facts, stale versions and foreign site targets without effects", async () => {
    const f = await runtimeFixture();
    const created = await policy(f);
    const original = await input(f, created);
    const before = await effects(f);
    for (const patch of [
      { fixtureHash: `cj1:sha256:${"A".repeat(43)}` },
      {
        fixtureJson: JSON.stringify({
          schemaVersion: "np.agent-policy-simulation-fixture.v1",
          suite: "autonomy-and-quiet-hours",
          facts: "private",
        }),
      },
      { expectedVersion: 2 },
      { configHash: `cj1:sha256:${"A".repeat(43)}` },
    ]) {
      await expect(
        f.service.executeAdmin({ ...original, command: { ...original.command, ...patch } }),
      ).rejects.toThrow();
    }
    await expect(
      f.service.executeAdmin({ ...original, siteId: "draft-other" }),
    ).rejects.toMatchObject({ code: "RUNTIME_RESOURCE_UNAVAILABLE" });
    expect(await effects(f)).toEqual(before);
  });
  it("rechecks current staff access on replay and returns only the original policy snapshot", async () => {
    const f = await runtimeFixture();
    const created = await policy(f);
    const command = await input(f, created);
    const original = await f.service.executeAdmin(command);
    await f.db
      .update(npAgentPolicies)
      .set({ rowVersion: 2 })
      .where(eq(npAgentPolicies.id, created.resourceId));
    expect(await f.service.executeAdmin(command)).toEqual({ ...original, replayed: true });
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
    await expect(f.service.executeAdmin(command)).rejects.toThrow();
  });
});
