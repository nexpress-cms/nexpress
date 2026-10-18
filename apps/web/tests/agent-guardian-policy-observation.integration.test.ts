import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentRuntimeServiceV1,
  npBuildAgentRuntimeDefinitionInputV1,
  type NpAgentRuntimeServiceOptionsV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { createAgentGuardianSecurityObservationServiceV1 } from "../../../packages/core/src/agent/guardian-security-observation.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { npRequireAgentSecurityTransitionPayloadV1 } from "../../../packages/core/src/agent-contract/guardian-security-contract.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentInvocations,
  npAgentPolicies,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Observer = NonNullable<NpAgentRuntimeServiceOptionsV1["securityObservations"]>;
type Recorded = Parameters<Observer["recordPolicy"]>[0];
const sourceAction = "test.guardian.policy-source";

async function setup() {
  const f = await runtimeFixture();
  const prepared = new WeakSet<object>();
  const records: Recorded[] = [];
  const failures = { prepare: false, record: false };
  const observer: Observer = {
    preparePolicy: vi.fn(async ({ db, siteId: sourceSiteId }) => {
      expect(sourceSiteId).toBe(siteId);
      if (failures.prepare) throw new Error("Synthetic source preparation failure");
      prepared.add(db);
    }),
    recordPolicy: vi.fn(async (input) => {
      expect(prepared.has(input.db)).toBe(true);
      expect(input.siteId).toBe(siteId);
      expect(input.actorUserId).toBe(f.actor.actor.user.id);
      expect(input.occurredAt).toEqual(f.options.now());
      const [policy] = await input.db
        .select()
        .from(npAgentPolicies)
        .where(eq(npAgentPolicies.id, input.transition.policyId));
      expect(policy).toMatchObject(input.transition.current);
      expect(policy.agentId).toBe(input.transition.agentId);
      const [invocation] = await input.db
        .select()
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.id, input.invocationId));
      expect(invocation).toMatchObject({
        siteId,
        staffUserId: input.actorUserId,
        state: "started",
      });
      records.push(input);
      // This injected source marker proves its writes share the policy transaction.
      // The concrete collector's canonical Event/receipt tests own its evidence format.
      await input.db.insert(npAuditEvents).values({
        siteId,
        actorKind: "staff",
        actorUserId: input.actorUserId,
        action: sourceAction,
        targetType: "agent-policy",
        targetId: input.transition.policyId,
        payload: { transitionId: input.transitionId, invocationId: input.invocationId },
        createdAt: input.occurredAt,
      });
      if (failures.record) throw new Error("Synthetic source recording failure");
    }),
  };
  const options: NpAgentRuntimeServiceOptionsV1 = { ...f.options, securityObservations: observer };
  const service = createAgentRuntimeServiceV1(options);
  // Installation is captured; mutating the options object cannot silently remove it.
  options.securityObservations = undefined;
  const definition = {
    schemaVersion: "np.agent-policy-definition.v1",
    agentId: null,
    name: "Observed site policy",
    instructions: "Synthetic policy input is not observation authority.",
    rules: structuredClone(f.settings.defaultPolicyRules),
  };
  const createInput = () => ({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.policies.create" as const,
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      ...npBuildAgentRuntimeDefinitionInputV1(definition),
    },
  });
  async function create() {
    const input = createInput();
    return { input, result: await service.executeAdmin(input) };
  }
  function activateInput(policy: { resourceId: string; output: { [key: string]: unknown } }) {
    return {
      siteId,
      actor: f.actor.actor,
      operationId: "agents.policies.activate" as const,
      targetId: policy.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: policy.output.rowVersion,
        configHash: policy.output.contentHash,
      },
    };
  }
  async function snapshot() {
    return {
      policies: await f.db.select().from(npAgentPolicies).orderBy(asc(npAgentPolicies.id)),
      invocations: await f.db.select().from(npAgentInvocations).orderBy(asc(npAgentInvocations.id)),
      audits: await f.db.select().from(npAuditEvents).orderBy(asc(npAuditEvents.id)),
    };
  }
  return {
    ...f,
    service,
    observer,
    failures,
    records,
    definition,
    createInput,
    create,
    activateInput,
    snapshot,
  };
}

describe.skipIf(skipIfNoTestDb())("Transactional Guardian policy observations", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("persists real policy source Events and verifies one signed activation Incident without replaying source writes", async () => {
    const f = await runtimeFixture();
    const never = () => Promise.reject(new Error("Policy observation must not dispatch Runtime"));
    const events = createAgentRuntimeEventServiceV1({
      admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
      deploymentAuthority: {
        policyId: "guardian-policy-source-fixture",
        fingerprint: `cj1:sha256:${"A".repeat(43)}`,
        scopes: [],
      },
      enqueueRun: never,
      now: f.options.now,
    });
    const source = createAgentGuardianSecurityObservationServiceV1({
      actorKey: { id: "guardian-policy-source-key", bytes: new Uint8Array(32).fill(87) },
      isInstalledSite: async (id) => id === siteId,
      authorize: async () => {},
      events,
      now: f.options.now,
    });
    const captured: Recorded[] = [];
    const service = createAgentRuntimeServiceV1({
      ...f.options,
      securityObservations: {
        preparePolicy: source.preparePolicy,
        recordPolicy: async (input) => {
          await source.recordPolicy(input);
          captured.push(input);
        },
      },
    });
    const create = {
      siteId,
      actor: f.actor.actor,
      operationId: "agents.policies.create" as const,
      targetId: null,
      command: {
        idempotencyKey: randomUUID(),
        ...npBuildAgentRuntimeDefinitionInputV1({
          schemaVersion: "np.agent-policy-definition.v1",
          agentId: null,
          name: "Concrete source policy",
          instructions: "Synthetic policy instructions are not security evidence.",
          rules: structuredClone(f.settings.defaultPolicyRules),
        }),
      },
    };
    const created = await service.executeAdmin(create);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(0);
    const activate = {
      siteId,
      actor: f.actor.actor,
      operationId: "agents.policies.activate" as const,
      targetId: created.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: created.output.rowVersion,
        configHash: created.output.contentHash,
      },
    };
    await service.executeAdmin(activate);
    const retainedEvents = await f.db.select().from(npAgentEvents).orderBy(asc(npAgentEvents.id));
    const retainedReceipts = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agent.guardian_security.source"))
      .orderBy(asc(npAuditEvents.id));
    expect(retainedEvents).toHaveLength(2);
    expect(retainedReceipts).toHaveLength(2);
    expect(captured).toHaveLength(2);
    for (const observation of captured) {
      const row = retainedEvents.find((event) => {
        const payload = npRequireAgentSecurityTransitionPayloadV1(event.payload);
        return payload.transitionId === observation.transitionId;
      });
      if (!row) throw new Error("Missing actual policy Event");
      const payload = npRequireAgentSecurityTransitionPayloadV1(row.payload);
      expect(payload.kind).toBe("agent.policy.changed");
      expect(payload.transition).toEqual(observation.transition);
      const receipt = retainedReceipts.find((audit) => audit.id === payload.sourceReceiptId);
      expect(receipt).toMatchObject({
        siteId,
        actorKind: "staff",
        actorUserId: f.actor.actor.user.id,
        targetType: "agent-event",
        targetId: row.id,
        payload: {
          schemaVersion: "np.agent-guardian-security-source.v1",
          eventId: row.id,
          eventHash: row.eventHash,
          invocationId: observation.invocationId,
        },
      });
      const [invocation] = await f.db
        .select()
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.id, observation.invocationId));
      expect(invocation).toMatchObject({ state: "completed", resultId: created.resourceId });
    }
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(88),
      now: f.options.now,
      canReadIncident: () => false,
      canReadStaffIncident: async ({ incident, context }) => {
        try {
          await source.evidence({ db: f.db, siteId: context.siteId, incident });
          return true;
        } catch {
          return false;
        }
      },
    });
    const incidents = await f.db.select().from(npAgentIncidents);
    expect(incidents).toHaveLength(1);
    const { incident } = await reads.staff.get(
      { incidentId: incidents[0].id },
      { siteId, actor: f.actor.actor },
    );
    const verified = await source.evidence({ db: f.db, siteId, incident });
    expect(verified).toEqual([
      expect.objectContaining({
        detectorId: "guardian.policy-activated",
        basis: "committed-transition",
        targetKind: "agent-policy",
      }),
    ]);
    expect(JSON.stringify(verified)).not.toContain(created.resourceId);
    expect(JSON.stringify(verified)).not.toMatch(
      /invocationId|sourceMac|actorUserId|instructions/u,
    );
    expect(await service.executeAdmin(create)).toMatchObject({ replayed: true });
    expect(await service.executeAdmin(activate)).toMatchObject({ replayed: true });
    await f.db.transaction(async (db) => {
      await source.preparePolicy({ db, siteId });
      await source.recordPolicy({ ...captured[1], db });
    });
    expect(await f.db.select().from(npAgentEvents).orderBy(asc(npAgentEvents.id))).toEqual(
      retainedEvents,
    );
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agent.guardian_security.source"))
        .orderBy(asc(npAuditEvents.id)),
    ).toEqual(retainedReceipts);
    expect(await source.evidence({ db: f.db, siteId, incident })).toEqual(verified);
    expect(await f.db.select().from(npAgentRuns)).toEqual([]);

    const receipt = retainedReceipts.find(
      (audit) => audit.payload.invocationId === captured[1].invocationId,
    );
    if (!receipt) throw new Error("Missing activation source receipt");
    await f.db
      .update(npAuditEvents)
      .set({ payload: { ...receipt.payload, sourceMac: `hmac-sha256:${"A".repeat(43)}` } })
      .where(eq(npAuditEvents.id, receipt.id));
    await expect(source.evidence({ db: f.db, siteId, incident })).rejects.toThrow();
  });

  it("records actual create, draft update, activation and retirement once under their real invocations", async () => {
    const f = await setup();
    const first = await f.create();
    expect(await f.service.executeAdmin(first.input)).toMatchObject({ replayed: true });
    f.definition.instructions = "Updated synthetic policy";
    const update = {
      siteId,
      actor: f.actor.actor,
      operationId: "agents.policies.update" as const,
      targetId: first.result.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: first.result.output.rowVersion,
        configHash: first.result.output.contentHash,
        ...npBuildAgentRuntimeDefinitionInputV1(f.definition),
      },
    };
    const updated = await f.service.executeAdmin(update);
    expect(await f.service.executeAdmin(update)).toMatchObject({ replayed: true });
    const activate = f.activateInput(updated);
    await f.service.executeAdmin(activate);
    expect(await f.service.executeAdmin(activate)).toMatchObject({ replayed: true });
    const second = await f.create();
    const replace = f.activateInput(second.result);
    await f.service.executeAdmin(replace);
    expect(await f.service.executeAdmin(replace)).toMatchObject({ replayed: true });

    expect(
      f.records.map(({ transition }) => [
        transition.previous?.status ?? null,
        transition.current.status,
      ]),
    ).toEqual([
      [null, "draft"],
      ["draft", "draft"],
      ["draft", "active"],
      [null, "draft"],
      ["active", "retired"],
      ["draft", "active"],
    ]);
    expect(f.records[0].transition.current).toMatchObject({ version: 1, rowVersion: 1 });
    expect(f.records[1].transition.previous).toEqual(f.records[0].transition.current);
    expect(f.records[1].transition.current.rowVersion).toBe(2);
    expect(f.records[1].transition.current.contentHash).not.toBe(
      f.records[0].transition.current.contentHash,
    );
    expect(f.records[4].transition.previous).toEqual(f.records[2].transition.current);
    expect(f.records[4].transition.current.rowVersion).toBe(4);
    expect(f.records[3].transition.current.version).toBe(2);
    expect(new Set(f.records.map((record) => record.transitionId)).size).toBe(6);
    expect(new Set(f.records.map((record) => record.invocationId)).size).toBe(5);
    expect(f.records[4].invocationId).toBe(f.records[5].invocationId);
    const markers = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, sourceAction));
    expect(markers).toHaveLength(6);
  });

  it("does not prepare or record validation and emits no source fact for a stale command", async () => {
    const f = await setup();
    const created = await f.create();
    vi.mocked(f.observer.preparePolicy).mockClear();
    vi.mocked(f.observer.recordPolicy).mockClear();
    await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.policies.validate",
      targetId: created.result.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        configHash: created.result.output.contentHash,
      },
    });
    expect(f.observer.preparePolicy).not.toHaveBeenCalled();
    expect(f.observer.recordPolicy).not.toHaveBeenCalled();
    const before = await f.snapshot();
    await expect(
      f.service.executeAdmin({
        ...f.activateInput(created.result),
        command: {
          idempotencyKey: randomUUID(),
          expectedVersion: 99,
          configHash: created.result.output.contentHash,
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_VERSION_CONFLICT" });
    expect(f.observer.preparePolicy).toHaveBeenCalledOnce();
    expect(f.observer.recordPolicy).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  });

  it("rolls creation, invocation, audit and source writes back when recording fails", async () => {
    const f = await setup();
    const input = f.createInput();
    const before = await f.snapshot();
    f.failures.record = true;
    await expect(f.service.executeAdmin(input)).rejects.toThrow(
      "Synthetic source recording failure",
    );
    expect(await f.snapshot()).toEqual(before);
    f.failures.record = false;
    expect(await f.service.executeAdmin(input)).toMatchObject({ replayed: false });
  });

  it("rolls a draft update back with the source callback", async () => {
    const f = await setup();
    const created = await f.create();
    const before = await f.snapshot();
    f.definition.instructions = "Must roll back";
    f.failures.record = true;
    await expect(
      f.service.executeAdmin({
        siteId,
        actor: f.actor.actor,
        operationId: "agents.policies.update",
        targetId: created.result.resourceId,
        command: {
          idempotencyKey: randomUUID(),
          expectedVersion: 1,
          configHash: created.result.output.contentHash,
          ...npBuildAgentRuntimeDefinitionInputV1(f.definition),
        },
      }),
    ).rejects.toThrow("Synthetic source recording failure");
    expect(await f.snapshot()).toEqual(before);
  });

  it.each(["retired", "active"] as const)(
    "rolls replacement retirement and activation back when the %s source callback fails",
    async (failedStatus) => {
      const f = await setup();
      const first = await f.create();
      await f.service.executeAdmin(f.activateInput(first.result));
      const second = await f.create();
      const input = f.activateInput(second.result);
      const before = await f.snapshot();
      const record = f.observer.recordPolicy;
      f.observer.recordPolicy = async (source) => {
        await record(source);
        if (source.transition.current.status === failedStatus)
          throw new Error("Synthetic activation source failure");
      };
      await expect(f.service.executeAdmin(input)).rejects.toThrow(
        "Synthetic activation source failure",
      );
      expect(await f.snapshot()).toEqual(before);
      f.observer.recordPolicy = record;
      expect(await f.service.executeAdmin(input)).toMatchObject({ replayed: false });
    },
  );

  it("fails preparation before admission writes and leaves an absent source owner inactive", async () => {
    const f = await setup();
    const input = f.createInput();
    const before = await f.snapshot();
    f.failures.prepare = true;
    await expect(f.service.executeAdmin(input)).rejects.toThrow(
      "Synthetic source preparation failure",
    );
    expect(f.observer.recordPolicy).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
    const absent = createAgentRuntimeServiceV1(f.options);
    const created = await absent.executeAdmin(input);
    await absent.executeAdmin(f.activateInput(created));
    expect(await absent.executeAdmin(input)).toMatchObject({ replayed: true });
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    expect(
      await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.action, sourceAction)),
    ).toEqual([]);
  });
});
