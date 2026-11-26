import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentOperatorServiceV1,
  type NpAgentOperatorAuditJobV1,
  type NpAgentOperatorHostV1,
} from "../../../packages/core/src/agent/operator-service.js";
import {
  createAgentOperatorCapabilityFacadeV1,
  type NpAgentOperatorCapabilityFacadeV1,
} from "../../../packages/core/src/agent/operator-capability.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { createAgentMcpTaskServiceV1 } from "../../../packages/core/src/agent/mcp-task-service.js";
import { NpAgentGatewayError } from "../../../packages/core/src/agent/admin-admission.js";
import {
  npAgentActions,
  npAgentInvocations,
  npAgentOperatorPlans,
  npAgentServiceTokens,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npRequireAgentOperatorCapabilityInvocationRequestV1 } from "../../../packages/core/src/agent-contract/operator-capability-contract.js";
import { fixture, principalFixture, siteId } from "./agent-changeset-fixture.js";
import {
  runtimeFixture,
  runtimeDefinition,
  runtimeRecipes,
} from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const auditInput = { families: ["contracts"], collections: ["posts"], maxTargets: 5 };
function auditRequest(key = randomUUID()) {
  return npRequireAgentOperatorCapabilityInvocationRequestV1({
    schemaVersion: "np.agent-invocation-request.v1",
    capabilityId: "audit.run",
    arguments: { input: auditInput, idempotencyKey: key },
  });
}
function planRequest(key = randomUUID()) {
  return npRequireAgentOperatorCapabilityInvocationRequestV1({
    schemaVersion: "np.agent-invocation-request.v1",
    capabilityId: "ops.plan",
    arguments: {
      input: { action: "migration.plan", target: { kind: "site" } },
      idempotencyKey: key,
    },
  });
}
async function setup(taskMode = false) {
  const f = await fixture();
  const p = await principalFixture(
    f,
    false,
    {},
    ["audit:run", "ops:plan"],
    "propose",
    taskMode ? { transport: "mcp-http" } : {},
  );
  const registry = await createAgentReadCapabilityRegistryV1(
    createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "operator-test", key: new Uint8Array(32).fill(63) },
      resolveBlockSchemas: () => [],
      resolveUser: () => f.actor.actor.user,
    }),
  );
  let facade: NpAgentOperatorCapabilityFacadeV1 | null = null;
  const admission = createAgentCapabilityAdmissionServiceV1({
    registry,
    resolveOperatorCapabilities: () => facade,
    resolveGatewaySettings: () => p.gatewaySettings,
  });
  const state = { allowed: true, audits: 0, plans: 0, failAudit: false, flipAfterAudit: false };
  const jobs: NpAgentOperatorAuditJobV1[] = [];
  const host: NpAgentOperatorHostV1 = {
    assertAccess: async ({ siteId: current }) => {
      if (!state.allowed || current !== siteId)
        throw new NpAgentGatewayError("FORBIDDEN", 403, "Not available.");
    },
    audit: async ({ input }) => {
      state.audits++;
      if (state.failAudit) throw new Error("private audit backend failed");
      if (state.flipAfterAudit) state.allowed = false;
      return {
        checks: [
          {
            id: "contracts.posts",
            family: "contracts",
            status: input.collections.includes("posts") ? "pass" : "unknown",
            evidenceRefs: ["schema:posts"],
          },
        ],
      };
    },
    plan: async ({ input, planId }) => {
      state.plans++;
      return {
        artifact: {
          schemaVersion: "fixture.migration-plan.v1",
          planId,
          operation: input,
          privatePath: "/private/owner/project",
        },
        contractId: "ops.migration",
        projectCommand: "pnpm np ops migration plan",
        checks: [{ id: "migration.owner", status: "pass" }],
      };
    },
  };
  let refresh: ((job: NpAgentOperatorAuditJobV1) => Promise<void>) | undefined;
  const tasks = taskMode
    ? createAgentMcpTaskServiceV1({
        admission,
        cursorKey: { id: "operator-tasks", key: new Uint8Array(32).fill(64) },
        refreshInvocation: async (job) => {
          if (!refresh) throw new Error("Missing operator owner");
          await refresh(job);
        },
      })
    : undefined;
  const service = createAgentOperatorServiceV1({
    admission,
    host,
    resolveTransportAudience: p.gateway.getTransportAudience,
    enqueueAudit: async (job) => {
      jobs.push(job);
      return randomUUID();
    },
    tasks,
  });
  refresh = service.refreshInvocation;
  facade = createAgentOperatorCapabilityFacadeV1(service);
  return {
    ...f,
    ...p,
    admission,
    host,
    state,
    jobs,
    service,
    facade,
    tasks,
    invoke: (
      request: ReturnType<typeof auditRequest>,
      taskRequest?: { requestedTtlMs: number | null },
    ) => admission.invoke({ authentication: p.authentication, request, taskRequest }),
  };
}

describe.skipIf(skipIfNoTestDb())("Operator retained diagnostics", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);
  it("queues a real audit and returns the retained result on exact retry without repeating checks", async () => {
    const f = await setup();
    const request = auditRequest();
    const admitted = await f.invoke(request);
    expect(admitted.output).toMatchObject({ state: "queued", checks: [], digest: null });
    expect(f.state.audits).toBe(0);
    expect(f.jobs).toHaveLength(1);
    const [invocation] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, admitted.invocationId));
    const [audit] = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.id, invocation.auditEventId));
    expect(admitted.output).toHaveProperty("auditId", audit.id);
    await f.service.processAudit(f.jobs[0]);
    const result = await f.invoke(request);
    expect(result.output).toMatchObject({
      state: "completed",
      checks: [{ family: "contracts", status: "pass" }],
    });
    expect(f.state.audits).toBe(1);
    await f.service.processAudit(f.jobs[0]);
    expect(f.state.audits).toBe(1);
    await expect(
      f.invoke({
        ...request,
        arguments: { ...request.arguments, input: { ...auditInput, maxTargets: 6 } },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(JSON.stringify(result)).not.toContain("privatePath");
  });
  it("requires current permission before work, after checks, and retained read", async () => {
    const f = await setup();
    const request = auditRequest();
    await f.invoke(request);
    f.state.allowed = false;
    await expect(f.service.processAudit(f.jobs[0])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.state.audits).toBe(0);
    f.state.allowed = true;
    f.state.flipAfterAudit = true;
    await expect(f.service.processAudit(f.jobs[0])).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [row] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, f.jobs[0].invocationId));
    expect(row.state).toBe("accepted");
    f.state.flipAfterAudit = false;
    f.state.allowed = true;
    await f.service.processAudit(f.jobs[0]);
    f.state.allowed = false;
    await expect(f.invoke(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("does not fabricate completion on a backend error, credential revocation, or wrong site", async () => {
    const f = await setup();
    await f.invoke(auditRequest());
    f.state.failAudit = true;
    await expect(f.service.processAudit(f.jobs[0])).rejects.toThrow("private audit backend failed");
    const [row] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, f.jobs[0].invocationId));
    expect(row.outputRedacted).toMatchObject({ state: "queued", digest: null });
    await expect(
      f.service.processAudit({ ...f.jobs[0], siteId: "draft-other" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.db
      .update(npAgentServiceTokens)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(npAgentServiceTokens.id, f.authentication.serviceToken.id));
    await expect(f.service.processAudit(f.jobs[0])).rejects.toMatchObject({
      code: "AUTHORIZATION_CHANGED",
    });
  });
  it("persists the actual private owner artifact and rejects tampering or executable plans", async () => {
    const f = await setup();
    const request = planRequest();
    const result = await f.invoke(request);
    expect(result.output).toMatchObject({
      execution: { kind: "local-cli-handoff", contractId: "ops.migration" },
    });
    expect(JSON.stringify(result)).not.toContain("/private/");
    const [artifact] = await f.db
      .select()
      .from(npAgentOperatorPlans)
      .where(eq(npAgentOperatorPlans.invocationId, result.invocationId));
    expect(artifact.artifactCanonical).toHaveProperty("privatePath", "/private/owner/project");
    expect(await f.invoke(request)).toEqual(result);
    expect(f.state.plans).toBe(1);
    await f.db
      .update(npAgentOperatorPlans)
      .set({ artifactCanonical: { tampered: true } })
      .where(eq(npAgentOperatorPlans.id, artifact.id));
    await expect(f.invoke(request)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const executable = npRequireAgentOperatorCapabilityInvocationRequestV1({
      schemaVersion: "np.agent-invocation-request.v1",
      capabilityId: "ops.plan",
      arguments: {
        input: { action: "cache.revalidate", target: { kind: "site" } },
        idempotencyKey: randomUUID(),
      },
    });
    await expect(f.invoke(executable)).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
    expect(f.state.plans).toBe(1);
  });
  it("uses the existing MCP task owner and cancellation prevents queued checks", async () => {
    const f = await setup(true);
    if (!f.tasks) throw new Error("Missing tasks");
    const request = auditRequest();
    const admitted = await f.invoke(request, { requestedTtlMs: 60000 });
    expect(admitted.task?.status).toBe("working");
    if (!admitted.task) throw new Error("Missing task");
    await f.tasks.cancel(f.authentication, admitted.task.taskId);
    await expect(f.service.processAudit(f.jobs[0])).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.audits).toBe(0);
    const next = await f.invoke(auditRequest(), {
      requestedTtlMs: 60000,
    });
    if (!next.task) throw new Error("Missing task");
    await f.service.processAudit(f.jobs[1]);
    expect((await f.tasks.get(f.authentication, next.task.taskId)).status).toBe("completed");
    expect((await f.tasks.result(f.authentication, next.task.taskId)).kind).toBe("tool_result");
    f.state.allowed = false;
    await expect(f.tasks.get(f.authentication, next.task.taskId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(f.tasks.result(f.authentication, next.task.taskId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const unguarded = createAgentMcpTaskServiceV1({
      admission: f.admission,
      cursorKey: { id: "other-tasks", key: new Uint8Array(32).fill(66) },
    });
    await expect(unguarded.result(f.authentication, next.task.taskId)).rejects.toMatchObject({
      mcpCode: -32602,
    });
    f.state.allowed = true;
    let release: () => void = () => {
      throw new Error("Collector not started");
    };
    let began: () => void = () => {
      throw new Error("Collector not observed");
    };
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.host.audit = async () => {
      began();
      await hold;
      return {
        checks: [
          {
            id: "contracts.posts",
            family: "contracts",
            status: "pass",
            evidenceRefs: ["schema:posts"],
          },
        ],
      };
    };
    const raced = await f.invoke(auditRequest(), { requestedTtlMs: 60000 });
    if (!raced.task) throw new Error("Missing task");
    const work = f.service.processAudit(f.jobs[2]);
    await started;
    const cancellation = expect(
      f.tasks.cancel(f.authentication, raced.task.taskId),
    ).rejects.toMatchObject({ mcpCode: -32602 });
    release();
    await work;
    await cancellation;
    expect((await f.tasks.get(f.authentication, raced.task.taskId)).status).toBe("completed");
  });
  it("completes a bounded Runtime audit before returning and verifies retained output", async () => {
    const definition = runtimeDefinition();
    definition.scopes = ["audit:run", "ops:plan", "site:read"];
    definition.autonomy = "advise";
    definition.capabilityModes = [
      { capabilityId: "audit.run", mode: "advise" },
      { capabilityId: "ops.plan", mode: "advise" },
    ];
    const recipes = runtimeRecipes();
    recipes.recipes[0].capabilityIds = ["audit.run", "ops.plan"];
    const f = await runtimeFixture(undefined, true, {
      delegated: true,
      definition,
      recipes,
      maxCapabilityCalls: 2,
    });
    const registry = await createAgentReadCapabilityRegistryV1(
      createAgentCoreReadCapabilityExecutorsV1({
        cursorHmacKey: { id: "runtime-operator", key: new Uint8Array(32).fill(65) },
        resolveBlockSchemas: () => [],
        resolveUser: () => f.actor.actor.user,
      }),
    );
    let facade: NpAgentOperatorCapabilityFacadeV1 | null = null;
    const admission = createAgentCapabilityAdmissionServiceV1({
      registry,
      runtimeAdmission: f.admission,
      resolveOperatorCapabilities: () => facade,
      resolveGatewaySettings: () => ({
        schemaVersion: "np.agent-gateway-settings.v1",
        stdio: "disabled",
        mcpHttp: "disabled",
        agentHttp: "disabled",
      }),
    });
    let queued = 0,
      audits = 0;
    const service = createAgentOperatorServiceV1({
      admission,
      runtimeAdmission: f.admission,
      resolveTransportAudience: async () => "https://unused.example",
      enqueueAudit: async () => {
        queued++;
        return randomUUID();
      },
      host: {
        assertAccess: async () => {},
        audit: async () => {
          audits++;
          return {
            checks: [
              {
                id: "contracts.posts",
                family: "contracts",
                status: "pass",
                evidenceRefs: ["schema:posts"],
              },
            ],
          };
        },
        plan: async () => ({
          artifact: { schemaVersion: "fixture.plan.v1", steps: ["inspect"] },
          contractId: "ops.migration",
          projectCommand: "pnpm np ops migration plan",
          checks: [{ id: "owner", status: "pass" }],
        }),
      },
    });
    facade = createAgentOperatorCapabilityFacadeV1(service);
    const { runId } = await f.admission.admit(f.runInput);
    const store = createAgentRuntimeExecutionStoreV1({
      admission: f.admission,
      now: f.options.now,
    });
    const { claim } = await store.claim({ siteId, runId });
    if (!claim) throw new Error("Missing runtime claim");
    const request = auditRequest();
    const result = await admission.invokeRuntime({ siteId, runId, claim, sequence: 1, request });
    expect(result.output).toMatchObject({ state: "completed" });
    expect(queued).toBe(0);
    expect(audits).toBe(1);
    expect(await admission.invokeRuntime({ siteId, runId, claim, sequence: 1, request })).toEqual(
      result,
    );
    expect(audits).toBe(1);
    const [retained] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, result.invocationId));
    expect(retained.idempotencyKey).toBe(request.arguments.idempotencyKey);
    expect(await admission.invokeRuntime({ siteId, runId, claim, sequence: 2, request })).toEqual(
      result,
    );
    expect(audits).toBe(1);
    const outcomes = await f.admission.withCurrentRun({ siteId, runId, claim }, (current) =>
      admission.runtimeActionOutcomes(current),
    );
    expect(outcomes[0]).toMatchObject({
      capabilityId: "audit.run",
      operatorOutput: { state: "completed" },
    });
    const planned = await admission.invokeRuntime({
      siteId,
      runId,
      claim,
      sequence: 2,
      request: planRequest(),
    });
    expect(planned.output).toMatchObject({ execution: { kind: "local-cli-handoff" } });
    const [action] = await f.db
      .select()
      .from(npAgentActions)
      .where(
        and(
          eq(npAgentActions.siteId, siteId),
          eq(npAgentActions.runId, runId),
          eq(npAgentActions.capabilityId, "audit.run"),
        ),
      );
    await f.db
      .update(npAgentActions)
      .set({ inputCanonical: { ...auditInput, maxTargets: 99 } })
      .where(eq(npAgentActions.id, action.id));
    const hidden = await f.admission.withCurrentRun({ siteId, runId, claim }, (current) =>
      admission.runtimeActionOutcomes(current),
    );
    expect(hidden.some((outcome) => outcome.capabilityId === "audit.run")).toBe(false);
  });
});
