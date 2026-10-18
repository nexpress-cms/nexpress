import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentGuardianControlsV1 } from "../../../packages/core/src/agent/guardian-controls.js";
import {
  npRequireAgentGuardianControlV1,
  NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1,
} from "../../../packages/core/src/agent-contract/guardian-controls-contract.js";
import { serializeAgentCanonicalJson } from "../../../packages/core/src/agent-contract/canonical-foundation.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npAgentRuns } from "../../../packages/core/src/db/schema/agent.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const hash = (value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
async function setup() {
  const f = await fixture();
  const state = {
    clock: new Date(),
    ready: true,
    sourceCount: 1,
    fingerprint: hash("registration-1"),
  };
  const options = {
    deploymentActorFingerprint: hash("local-deployment-actor"),
    registration: async () => ({
      sourceCount: state.sourceCount,
      ready: state.ready,
      fingerprint: state.fingerprint,
    }),
    now: () => new Date(state.clock),
  };
  const controls = createAgentGuardianControlsV1(options),
    gate = { db: f.db, siteId, sourceInstalled: true };
  async function stored() {
    const [row] = await f.db
      .select()
      .from(npSettings)
      .where(
        and(
          eq(npSettings.siteId, siteId),
          eq(npSettings.key, NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1),
        ),
      )
      .limit(1);
    return row ? npRequireAgentGuardianControlV1(row.value) : null;
  }
  return { ...f, state, options, controls, gate, stored };
}
describe.skipIf(skipIfNoTestDb())("Guardian independent persisted local controls", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("preserves explicit registration capture and independently disables despite malformed Runtime state", async () => {
    const f = await setup();
    expect(await f.controls.readCaptureAdmission(f.gate)).toMatchObject({
      state: "enabled-by-registration",
      revision: 0,
      configured: false,
    });
    expect(await f.stored()).toBeNull();
    await f.db
      .insert(npSettings)
      .values({ siteId, key: "agents.runtime", value: { corrupt: "runtime-state-marker" } })
      .onConflictDoUpdate({
        target: [npSettings.siteId, npSettings.key],
        set: { value: { corrupt: "runtime-state-marker" } },
      });
    expect(
      await f.controls.disable({ siteId, reason: "private-operator-reason-marker" }),
    ).toMatchObject({ outcome: "disabled", status: { capture: "disabled", revision: 1 } });
    expect(await f.controls.readCaptureAdmission(f.gate)).toMatchObject({
      state: "disabled",
      reason: "OPERATOR_DISABLED",
      revision: 1,
    });
    const audits = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agent.guardian.disabled"));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain("private-operator-reason-marker");
    const [runtime] = await f.db
      .select()
      .from(npSettings)
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "agents.runtime")));
    expect(runtime.value).toEqual({ corrupt: "runtime-state-marker" });
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
  });
  it("persists the exact local approval ceremony and replays a committed enable through a fresh owner", async () => {
    const f = await setup();
    await f.controls.disable({ siteId, reason: "Contain" });
    const planned = await f.controls.prepareEnable({ siteId });
    if (!planned.plan) throw new Error("Expected local plan");
    const plan = planned.plan;
    expect((await f.stored())?.currentEnablePlan).toEqual(plan);
    const reopened = createAgentGuardianControlsV1(f.options);
    expect(await reopened.enable({ siteId, plan, approval: plan.id })).toMatchObject({
      outcome: "enabled",
      status: { revision: 3, capture: "enabled", response: "separate-policy-required" },
    });
    const before = await f.db.select().from(npAuditEvents);
    f.state.clock = new Date(Date.parse(plan.expiresAt) + 1000);
    expect((await reopened.enable({ siteId, plan, approval: plan.id })).outcome).toBe("enabled");
    expect(await f.db.select().from(npAuditEvents)).toEqual(before);
    expect((await f.stored())?.lastEnableReceipt?.plan).toEqual(plan);
  });
  it("rejects expired or registration-stale plans and distinguishes malformed control from intentional disable", async () => {
    const f = await setup();
    await f.controls.disable({ siteId, reason: "Contain" });
    const result = await f.controls.prepareEnable({ siteId });
    if (!result.plan) throw new Error("Expected local plan");
    const plan = result.plan;
    f.state.fingerprint = hash("changed-registry");
    expect((await f.controls.enable({ siteId, plan, approval: plan.id })).errorCode).toBe(
      "GUARDIAN_READINESS_BLOCKED",
    );
    f.state.fingerprint = hash("registration-1");
    f.state.clock = new Date(plan.expiresAt);
    expect((await f.controls.enable({ siteId, plan, approval: plan.id })).errorCode).toBe(
      "GUARDIAN_PLAN_EXPIRED",
    );
    expect((await f.stored())?.enabled).toBe(false);
    await f.db
      .update(npSettings)
      .set({ value: { enabled: false } })
      .where(
        and(
          eq(npSettings.siteId, siteId),
          eq(npSettings.key, NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1),
        ),
      );
    await expect(f.controls.readCaptureAdmission(f.gate)).rejects.toMatchObject({
      code: "GUARDIAN_STATE_INVALID",
    });
    expect((await f.controls.disable({ siteId, reason: "Contain" })).errorCode).toBe(
      "GUARDIAN_STATE_INVALID",
    );
  });
  it("keeps the capture reader nonlocking while local mutations serialize on the existing site quota lock", async () => {
    const f = await setup();
    let entered: (() => void) | undefined, release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    const blocker = f.db.transaction(async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`np:site-quota:${siteId}`},0))`,
      );
      entered?.();
      await held;
    });
    await ready;
    try {
      expect(
        await f.db.transaction((db) => f.controls.readCaptureAdmission({ ...f.gate, db })),
      ).toMatchObject({ state: "enabled-by-registration" });
      expect((await f.controls.disable({ siteId, reason: "Contain" })).errorCode).toBe(
        "GUARDIAN_UNAVAILABLE",
      );
      expect(await f.stored()).toBeNull();
    } finally {
      release?.();
      await blocker;
    }
    expect((await f.controls.disable({ siteId, reason: "Contain" })).outcome).toBe("disabled");
  });
});
