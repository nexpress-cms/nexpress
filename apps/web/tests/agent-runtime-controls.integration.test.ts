import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import {
  createAgentRuntimeControlsV1,
  npWithAgentRuntimeControlTransactionV1,
} from "../../../packages/core/src/agent/runtime-controls.js";
import { npRequireAgentRuntimeControlV1 } from "../../../packages/core/src/agent-contract/runtime-ops-contract.js";
import { runtimeFixture, runtimeFingerprint, siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const otherActor = `cj1:sha256:${"B".repeat(43)}`;

describe.skipIf(skipIfNoTestDb())("Runtime local and staff controls", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("keeps disabled status and repeatable containment available without readiness and audits only deployment evidence", async () => {
    const f = await runtimeFixture();
    await f.db
      .delete(npSettings)
      .where(
        and(
          eq(npSettings.siteId, siteId),
          inArray(npSettings.key, ["agents.runtime", "agents.runtime.control"]),
        ),
      );
    const controls = createAgentRuntimeControlsV1({
      deploymentActorFingerprint: runtimeFingerprint,
    });
    const before = await controls.status({ siteId });
    expect(before.status).toMatchObject({
      revision: 1,
      enabled: false,
      paused: false,
      readiness: { worker: "unavailable" },
    });
    const reason = "Private operator note that must not become audit prose";
    const paused = await controls.pause({ siteId, reason });
    const repeated = await controls.pause({ siteId, reason });
    expect(paused.status).toMatchObject({ revision: 2, enabled: false, paused: true });
    expect(repeated.status?.revision).toBe(2);
    await expect(controls.prepareResume({ siteId })).rejects.toMatchObject({
      code: "RUNTIME_READINESS_BLOCKED",
    });
    const events = await f.db
      .select()
      .from(npAuditEvents)
      .where(
        and(eq(npAuditEvents.siteId, siteId), eq(npAuditEvents.action, "agent.runtime.paused")),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorKind: "system",
      actorUserId: null,
      actorMemberId: null,
      payload: { actorFingerprint: runtimeFingerprint, revision: 2 },
    });
    expect(JSON.stringify(events)).not.toContain(reason);
    expect(JSON.stringify(paused)).not.toContain("actorFingerprint");
    expect(JSON.stringify(paused)).not.toContain("reasonFingerprint");
  });

  it("persists one bounded plan and one consumed receipt, then safely replays only the same actor and plan", async () => {
    const f = await runtimeFixture();
    await f.controls.pause({ siteId, reason: "Contain runtime work" });
    const prepared = await f.controls.prepareResume({ siteId });
    const repeated = await f.controls.prepareResume({ siteId });
    const plan = prepared.plan!;
    expect(repeated.plan).toEqual(plan);
    expect(Date.parse(plan.expiresAt) - Date.parse(plan.issuedAt)).toBe(300_000);
    const resumed = await f.controls.resume({ siteId, plan, approval: plan.id });
    expect(resumed.status).toMatchObject({
      revision: plan.revision + 1,
      enabled: true,
      paused: false,
    });
    f.advance(301);
    expect((await f.controls.resume({ siteId, plan, approval: plan.id })).status?.revision).toBe(
      resumed.status?.revision,
    );
    const other = createAgentRuntimeControlsV1({ deploymentActorFingerprint: otherActor });
    await expect(other.resume({ siteId, plan, approval: plan.id })).rejects.toMatchObject({
      code: "RUNTIME_PLAN_INVALID",
    });
    const [row] = await f.db
      .select()
      .from(npSettings)
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "agents.runtime.control")));
    expect(npRequireAgentRuntimeControlV1(row.value)).toMatchObject({
      currentResumePlan: null,
      lastResumeReceipt: { plan, revision: plan.revision + 1 },
    });
    const events = await f.db
      .select({ action: npAuditEvents.action })
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.siteId, siteId),
          inArray(npAuditEvents.action, ["agent.runtime.resume_planned", "agent.runtime.resumed"]),
        ),
      );
    expect(events.map((row) => row.action).sort()).toEqual([
      "agent.runtime.resume_planned",
      "agent.runtime.resumed",
    ]);
  });

  it("rejects tampering, cross-site artifacts, and a missing exact approval without changing containment", async () => {
    const f = await runtimeFixture();
    await f.controls.pause({ siteId, reason: "Contain runtime work" });
    const plan = (await f.controls.prepareResume({ siteId })).plan!;
    for (const altered of [
      { ...plan, id: randomUUID() },
      { ...plan, actorFingerprint: otherActor },
      { ...plan, revision: plan.revision + 1 },
      { ...plan, settingsHash: otherActor },
    ])
      await expect(
        f.controls.resume({ siteId, plan: altered, approval: altered.id }),
      ).rejects.toMatchObject({ code: "RUNTIME_PLAN_INVALID" });
    await expect(
      f.controls.resume({ siteId: "draft-other", plan, approval: plan.id }),
    ).rejects.toMatchObject({ code: "RUNTIME_PLAN_INVALID" });
    await expect(f.controls.resume({ siteId, plan, approval: randomUUID() })).rejects.toMatchObject(
      { code: "RUNTIME_APPROVAL_REQUIRED" },
    );
    expect((await f.controls.status({ siteId })).status).toMatchObject({
      revision: plan.revision,
      paused: true,
    });
  });

  it("expires an unconsumed plan and rechecks a changed readiness fingerprint despite all checks remaining ready", async () => {
    const f = await runtimeFixture();
    await f.controls.pause({ siteId, reason: "Contain runtime work" });
    const expired = (await f.controls.prepareResume({ siteId })).plan!;
    f.advance(300);
    await expect(
      f.controls.resume({ siteId, plan: expired, approval: expired.id }),
    ).rejects.toMatchObject({ code: "RUNTIME_PLAN_EXPIRED" });
    const current = (await f.controls.prepareResume({ siteId })).plan!;
    f.state.fingerprint = otherActor;
    await expect(
      f.controls.resume({ siteId, plan: current, approval: current.id }),
    ).rejects.toMatchObject({ code: "RUNTIME_READINESS_BLOCKED" });
    const changed = (await f.controls.prepareResume({ siteId })).plan!;
    expect(changed.readinessFingerprint).toBe(otherActor);
    await expect(
      f.controls.resume({ siteId, plan: current, approval: current.id }),
    ).rejects.toMatchObject({ code: "RUNTIME_PLAN_INVALID" });
    expect((await f.controls.resume({ siteId, plan: changed, approval: changed.id })).outcome).toBe(
      "resumed",
    );
  });

  it("fails closed on missing or throwing readiness while leaving emergency pause available", async () => {
    const f = await runtimeFixture();
    await f.controls.pause({ siteId, reason: "Contain runtime work" });
    const plan = (await f.controls.prepareResume({ siteId })).plan!;
    for (const readiness of [
      undefined,
      async () => {
        throw new Error("private-provider-locator-marker");
      },
    ]) {
      const controls = createAgentRuntimeControlsV1({
        deploymentActorFingerprint: runtimeFingerprint,
        readiness,
      });
      await expect(controls.resume({ siteId, plan, approval: plan.id })).rejects.toMatchObject({
        code: "RUNTIME_READINESS_BLOCKED",
      });
      const result = await controls.status({ siteId });
      expect(result.status?.readiness.worker).toBe("unavailable");
      expect(JSON.stringify(result)).not.toContain("private-provider-locator-marker");
    }
    f.state.ready = false;
    expect((await f.controls.pause({ siteId, reason: "Repeat containment" })).status?.paused).toBe(
      true,
    );
  });

  it("makes a later pause invalidate the reviewed plan and makes repeated containment idempotent", async () => {
    const f = await runtimeFixture();
    await f.controls.pause({ siteId, reason: "Contain runtime work" });
    const plan = (await f.controls.prepareResume({ siteId })).plan!;
    const paused = await f.controls.pause({ siteId, reason: "New operator containment" });
    expect(paused.status?.revision).toBe(plan.revision + 1);
    await expect(f.controls.resume({ siteId, plan, approval: plan.id })).rejects.toMatchObject({
      code: "RUNTIME_PLAN_INVALID",
    });
    expect((await f.controls.pause({ siteId, reason: "Same containment" })).status?.revision).toBe(
      paused.status?.revision,
    );
  });

  it("shares settings CAS and outer-transaction atomicity while configuration changes invalidate reviewed plans", async () => {
    const f = await runtimeFixture();
    const initial = (await f.controls.status({ siteId })).status!;
    await expect(
      f.db.transaction(async (db) => {
        await f.controls.pauseInTransaction({
          db: db as typeof f.db,
          siteId,
          expectedRevision: initial.revision,
          actorFingerprint: runtimeFingerprint,
          reason: "Rollback containment transaction",
        });
        throw new Error("test transaction rollback");
      }),
    ).rejects.toThrow("test transaction rollback");
    expect((await f.controls.status({ siteId })).status?.paused).toBe(false);
    await f.controls.pause({ siteId, reason: "Contain runtime work" });
    const plan = (await f.controls.prepareResume({ siteId })).plan!;
    await expect(
      npWithAgentRuntimeControlTransactionV1(siteId, ({ db, settings }) =>
        f.controls.updateInTransaction({
          db,
          siteId,
          expectedRevision: plan.revision - 1,
          actorFingerprint: runtimeFingerprint,
          settings,
        }),
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_REVISION_CONFLICT" });
    await npWithAgentRuntimeControlTransactionV1(siteId, ({ db, revision, settings }) =>
      f.controls.updateInTransaction({
        db,
        siteId,
        expectedRevision: revision,
        actorFingerprint: runtimeFingerprint,
        settings: { ...settings, allowedProviderIds: ["fake-provider"] },
      }),
    );
    await expect(f.controls.resume({ siteId, plan, approval: plan.id })).rejects.toMatchObject({
      code: "RUNTIME_PLAN_INVALID",
    });
    expect((await f.controls.status({ siteId })).status?.paused).toBe(true);
  });

  it("routes staff resume through current Admin admission without inventing a local artifact", async () => {
    const f = await runtimeFixture();
    await f.controls.pause({ siteId, reason: "Contain runtime work" });
    const plan = (await f.controls.prepareResume({ siteId })).plan!;
    const command = {
      reason: "Reviewed staff resume",
      expectedVersion: plan.revision,
      idempotencyKey: randomUUID(),
    };
    f.state.ready = false;
    await expect(
      f.service.executeAdmin({
        siteId,
        actor: f.actor.actor,
        operationId: "agents.runtime.resume",
        targetId: null,
        command,
      }),
    ).rejects.toBeDefined();
    f.state.ready = true;
    await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.runtime.resume",
      targetId: null,
      command,
    });
    const repeated = await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.runtime.resume",
      targetId: null,
      command,
    });
    expect(repeated.replayed).toBe(true);
    expect((await f.controls.status({ siteId })).status).toMatchObject({
      revision: plan.revision + 1,
      paused: false,
    });
    await expect(f.controls.resume({ siteId, plan, approval: plan.id })).rejects.toMatchObject({
      code: "RUNTIME_PLAN_INVALID",
    });
    const [row] = await f.db
      .select()
      .from(npSettings)
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "agents.runtime.control")));
    expect(npRequireAgentRuntimeControlV1(row.value)).toMatchObject({
      currentResumePlan: null,
      lastResumeReceipt: null,
    });
  });
});
