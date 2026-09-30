import { describe, expect, it } from "vitest";
import type { NpAgentJsonObject, NpAgentJsonSchema } from "./types.js";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import {
  npAgentAuditCheckFamilies,
  npAgentOpsCheckFamilies,
  npAgentAuditRunInputSchemaV1,
  npAgentOpsStatusInputSchemaV1,
  npAgentOpsPlanInputSchemaV1,
  npAgentOpsPlanOutputSchemaV1,
  npAgentOpsExecuteInputSchemaV1,
  npAgentOpsExecuteOutputSchemaV1,
  npRequireAgentOpsExecuteInputV1,
  npRequireAgentOpsExecuteOutputV1,
  npAgentOperatorCapabilityDescriptorsV1,
  npBuildAgentOperatorCapabilityDefinitionCanonicalV1,
  npDigestAgentOpsStatusReportV1,
  npRequireAgentAuditRunInputV1,
  npRequireAgentAuditRunOutputV1,
  npRequireAgentOpsStatusInputV1,
  npRequireAgentOpsStatusOutputV1,
  npRequireAgentOpsPlanInputV1,
  npRequireAgentOpsPlanOutputV1,
  npRequireAgentOperatorCapabilityInvocationRequestV1,
  npRequireAgentOperatorCapabilityInputV1,
  npRequireAgentOperatorCapabilityOutputV1,
  npRequireAgentOperatorCapabilityInvocationResultV1,
  type NpAgentOpsPlanInputV1,
} from "./operator-capability-contract.js";

const id = "01990000-0000-7000-8000-000000000001";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const report = () => ({
  schemaVersion: "np.ops.v1",
  ok: true,
  status: "ready",
  summary: { total: 1, errors: 0, warnings: 0 },
  nextCommand: null,
  projectNextCommand: null,
  checks: [{ id: "jobs.status", state: "ok", label: "Jobs" }],
});
const queued = () => ({
  schemaVersion: "np.agent-audit.v1",
  auditId: id,
  state: "queued",
  checks: [],
  digest: null,
});
const plan = () => ({
  schemaVersion: "np.agent-ops-plan.v1",
  planId: id,
  planDigest: digest,
  checks: [{ id: "migration.status", status: "pass" }],
  expiresAt: "2026-09-29T12:00:00.000Z",
  operation: { action: "migration.plan", target: { kind: "site" } },
  execution: {
    kind: "local-cli-handoff",
    contractId: "ops.migrate",
    planArtifactId: id,
    projectCommand: "pnpm --silent run ops:migrate -- plan --json",
  },
});

describe("Operator capability contracts", () => {
  it("accepts advertised unordered family selections and the documented collection bound", () => {
    const audit = {
      families: [...npAgentAuditCheckFamilies],
      collections: Array.from({ length: 64 }, (_, i) => `collection-${i}`),
      maxTargets: 1000,
    };
    const status = { families: [...npAgentOpsCheckFamilies] };
    npRequireAgentProviderSchemaValueV1(npAgentAuditRunInputSchemaV1, audit);
    npRequireAgentProviderSchemaValueV1(npAgentOpsStatusInputSchemaV1, status);
    expect(npRequireAgentAuditRunInputV1(audit)).toEqual(audit);
    expect(npRequireAgentOpsStatusInputV1(status)).toEqual(status);
    for (const invalid of [
      { ...audit, families: [] },
      { ...audit, families: ["jobs", "jobs"] },
      { ...audit, collections: [...audit.collections, "extra"] },
      { ...audit, collections: ["posts", "posts"] },
      { ...audit, maxTargets: 1001 },
      { ...audit, maxTargets: 0 },
      { ...audit, siteId: "other" },
    ]) {
      expect(() => npRequireAgentAuditRunInputV1(invalid)).toThrow();
      expect(() =>
        npRequireAgentProviderSchemaValueV1(npAgentAuditRunInputSchemaV1, invalid),
      ).toThrow();
    }
  });

  it("rejects hostile input without invoking accessors or accepting prototypes", () => {
    let reads = 0;
    const getter = Object.defineProperty({}, "families", {
      enumerable: true,
      get() {
        reads += 1;
        return ["jobs"];
      },
    });
    const sparse = new Array<string>(1);
    const cyclic: Record<string, unknown> = {};
    cyclic.families = cyclic;
    for (const value of [
      getter,
      { families: sparse },
      cyclic,
      Object.assign(new Date(), { families: ["jobs"] }),
      { families: ["jobs"], hidden: undefined },
    ])
      expect(() => npRequireAgentOpsStatusInputV1(value)).toThrow();
    expect(reads).toBe(0);
  });

  it("keeps queued audits evidence-free and completed audits bounded and explicit", () => {
    expect(npRequireAgentAuditRunOutputV1(queued())).toEqual(queued());
    const completed = {
      ...queued(),
      state: "completed",
      digest,
      checks: [
        { id: "content.unavailable", family: "content", status: "unknown", evidenceRefs: [] },
      ],
    };
    expect(npRequireAgentAuditRunOutputV1(completed)).toEqual(completed);
    for (const value of [
      { ...queued(), digest },
      { ...queued(), checks: completed.checks },
      { ...completed, digest: null },
      { ...completed, checks: [] },
      { ...completed, checks: [...completed.checks, ...completed.checks] },
      {
        ...completed,
        checks: [{ ...completed.checks[0], evidenceRefs: ["source:1", "source:1"] }],
      },
      { ...completed, rawError: "database credentials" },
    ])
      expect(() => npRequireAgentAuditRunOutputV1(value)).toThrow();
  });

  it("rejects contradictory operational readiness and derives stable report digests", async () => {
    const output = { schemaVersion: "np.agent-ops-status.v1", report: report(), digest };
    expect(npRequireAgentOpsStatusOutputV1(output)).toEqual(output);
    for (const changed of [
      { ...report(), ok: false },
      { ...report(), status: "blocked" },
      { ...report(), summary: { total: 1, errors: 1, warnings: 0 } },
      { ...report(), checks: [...report().checks, ...report().checks] },
      { ...report(), checks: [{ ...report().checks[0], label: " leading" }] },
      { ...report(), checks: [{ ...report().checks[0], detail: "line\nbreak" }] },
      { ...report(), nextCommand: "arbitrary command" },
      { ...report(), locator: "/private" },
    ])
      expect(() => npRequireAgentOpsStatusOutputV1({ ...output, report: changed })).toThrow();
    const first = await npDigestAgentOpsStatusReportV1(report());
    const reordered = Object.fromEntries(Object.entries(report()).reverse());
    expect(await npDigestAgentOpsStatusReportV1(reordered)).toBe(first);
    expect(
      await npDigestAgentOpsStatusReportV1({
        ...report(),
        checks: [{ ...report().checks[0], label: "Queue" }],
      }),
    ).not.toBe(first);
  });

  it("binds every plan action to its exact target without granting execution", () => {
    const cases: NpAgentOpsPlanInputV1[] = [
      { action: "cache.revalidate", target: { kind: "site" } },
      {
        action: "cache.revalidate",
        target: { kind: "document", collection: "posts", documentSlug: "first" },
      },
      { action: "agent.run.retry", target: { kind: "run", runId: id } },
      { action: "agent.run.cancel", target: { kind: "run", runId: id } },
      { action: "migration.plan", target: { kind: "site" } },
      { action: "restore.plan", target: { kind: "backup", manifestId: "manifest-1" } },
      { action: "storage.migration.plan", target: { kind: "storage", adapterId: "local" } },
      {
        action: "plugin.change.plan",
        target: { kind: "plugin", pluginId: "search", operation: "disable" },
      },
      {
        action: "queue.global.plan",
        target: { kind: "queue", operation: "retry-failed", jobName: null },
      },
    ];
    for (const value of cases) {
      expect(npRequireAgentOpsPlanInputV1(value)).toEqual(value);
      npRequireAgentProviderSchemaValueV1(npAgentOpsPlanInputSchemaV1, value);
      expect(() =>
        npRequireAgentOpsPlanInputV1({ ...value, target: { ...value.target, siteId: "other" } }),
      ).toThrow();
    }
    for (const value of [
      { action: "migration.plan", target: { kind: "backup", manifestId: "x" } },
      {
        action: "queue.global.plan",
        target: { kind: "queue", operation: "resume", jobName: null },
      },
      { action: "agent.run.retry", target: { kind: "run", runId: "run" } },
      { action: "ops.execute", target: { kind: "site" } },
    ])
      expect(() => npRequireAgentOpsPlanInputV1(value)).toThrow();
    expect(npRequireAgentOpsPlanOutputV1(plan())).toEqual(plan());
    const executable = {
      ...plan(),
      operation: cases[0],
      execution: {
        kind: "agent-executable",
        approvalId: id,
        approvalResource: `/admin/agents/approvals/${id}`,
      },
    };
    expect(npRequireAgentOpsPlanOutputV1(executable)).toEqual(executable);
    const executionSchema = (npAgentOpsPlanOutputSchemaV1.properties as NpAgentJsonObject)
      .execution as NpAgentJsonSchema;
    npRequireAgentProviderSchemaValueV1(executionSchema, executable.execution);
    for (const approvalResource of [
      `nexpress://approvals/${id}`,
      `https://example.test/admin/agents/approvals/${id}`,
      `/admin/agents/approvals/${id}?redirect=other`,
      "/admin/agents/approvals/not-a-uuid",
    ])
      expect(() =>
        npRequireAgentProviderSchemaValueV1(executionSchema, {
          ...executable.execution,
          approvalResource,
        }),
      ).toThrow();
    for (const value of [
      { ...plan(), execution: executable.execution },
      { ...executable, execution: plan().execution },
      { ...plan(), expiresAt: "2026-09-29T21:00:00+09:00" },
      { ...plan(), execution: { ...plan().execution, projectCommand: "pnpm\nexecute" } },
      { ...executable, execution: { ...executable.execution, approvalResource: "not a resource" } },
      {
        ...executable,
        execution: { ...executable.execution, approvalResource: `nexpress://approvals/${id}` },
      },
      {
        ...executable,
        execution: {
          ...executable.execution,
          approvalResource: "/admin/agents/approvals/01990000-0000-7000-8000-000000000002",
        },
      },
    ])
      expect(() => npRequireAgentOpsPlanOutputV1(value)).toThrow();
  });

  it("accepts only exact approved execution bindings and closed site-owned actions", () => {
    const common = { planId: id, planDigest: digest, approvalId: id };
    const cases: NpAgentJsonObject[] = [
      { ...common, action: "cache.revalidate", target: { kind: "site" } },
      {
        ...common,
        action: "cache.revalidate",
        target: { kind: "collection", collection: "posts" },
      },
      {
        ...common,
        action: "cache.revalidate",
        target: { kind: "document", collection: "posts", documentSlug: "first" },
      },
      { ...common, action: "cache.revalidate", target: { kind: "navigation", location: "header" } },
      { ...common, action: "agent.run.retry", failedRunId: id },
      { ...common, action: "agent.run.cancel", runId: id },
    ];
    for (const value of cases) {
      expect(npRequireAgentOpsExecuteInputV1(value)).toEqual(value);
      npRequireAgentProviderSchemaValueV1(npAgentOpsExecuteInputSchemaV1, value);
      const request = {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "ops.execute",
        arguments: { input: value, idempotencyKey: "execute:1" },
      };
      expect(npRequireAgentOperatorCapabilityInvocationRequestV1(request)).toEqual(request);
      const invalidBindings: NpAgentJsonObject[] = [
        { ...value, approvalId: null },
        { ...value, planId: "invalid" },
        { ...value, planDigest: "unbound" },
        { ...value, siteId: id },
        { ...value, command: "pnpm ops:execute" },
      ];
      for (const invalid of invalidBindings) {
        expect(() => npRequireAgentOpsExecuteInputV1(invalid)).toThrow();
        expect(() =>
          npRequireAgentProviderSchemaValueV1(npAgentOpsExecuteInputSchemaV1, invalid),
        ).toThrow();
      }
    }
    const invalidOperations: NpAgentJsonObject[] = [
      { ...common, action: "restore.plan", target: { kind: "backup", manifestId: "backup-1" } },
      { ...common, action: "agent.run.retry", runId: id },
      { ...common, action: "agent.run.cancel", failedRunId: id },
      { ...common, action: "agent.run.retry", failedRunId: id, runId: id },
      { ...common, action: "cache.revalidate", target: { kind: "site", siteId: id } },
      { ...common, action: "cache.revalidate", target: { kind: "path", path: "/admin" } },
    ];
    for (const invalid of invalidOperations) {
      expect(() => npRequireAgentOpsExecuteInputV1(invalid)).toThrow();
      expect(() =>
        npRequireAgentProviderSchemaValueV1(npAgentOpsExecuteInputSchemaV1, invalid),
      ).toThrow();
    }
    const definition = npBuildAgentOperatorCapabilityDefinitionCanonicalV1("ops.execute");
    expect(definition.capabilities[0].descriptor).toMatchObject({
      requiredScopes: ["ops:execute"],
      risk: "sensitive",
      approval: "human",
      execution: "durable",
      idempotency: "required",
      effectProfiles: [
        {
          id: "ops.execute",
          kind: "mutation",
          reversibility: "none",
          minimumGatewayExposure: "approved-execute",
          verifierId: "ops.execute.verify",
          compensatorId: null,
        },
      ],
    });
  });

  it("keeps execution results terminal, bounded and evidence-only", () => {
    const output = {
      schemaVersion: "np.agent-ops-execution.v1",
      planId: id,
      action: "cache.revalidate",
      state: "succeeded",
      resultDigest: digest,
      verificationRefs: ["audit:1"],
    };
    for (const state of ["succeeded", "failed", "conflicted"]) {
      const value = { ...output, state };
      expect(npRequireAgentOpsExecuteOutputV1(value)).toEqual(value);
      npRequireAgentProviderSchemaValueV1(npAgentOpsExecuteOutputSchemaV1, value);
      const result = {
        schemaVersion: "np.agent-operator-invocation-result.v1",
        capabilityId: "ops.execute",
        invocationId: id,
        output: value,
      };
      expect(npRequireAgentOperatorCapabilityInvocationResultV1(result)).toEqual(result);
    }
    for (const value of [
      { ...output, state: "queued" },
      { ...output, action: "queue.global.plan" },
      { ...output, resultDigest: null },
      { ...output, verificationRefs: ["audit:1", "audit:1"] },
      { ...output, verificationRefs: Array.from({ length: 33 }, (_, i) => `audit:${i}`) },
      { ...output, verificationRefs: ["unsafe reference"] },
      { ...output, artifact: { credentials: "hidden" } },
    ]) {
      expect(() => npRequireAgentOpsExecuteOutputV1(value)).toThrow();
      expect(() =>
        npRequireAgentProviderSchemaValueV1(npAgentOpsExecuteOutputSchemaV1, value),
      ).toThrow();
    }
  });

  it("requires idempotency and binds selected invocation output to its capability", () => {
    const request = {
      schemaVersion: "np.agent-invocation-request.v1",
      capabilityId: "audit.run",
      arguments: {
        input: { families: ["jobs"], collections: [], maxTargets: 10 },
        idempotencyKey: "audit:1",
      },
    };
    expect(npRequireAgentOperatorCapabilityInvocationRequestV1(request)).toEqual(request);
    for (const key of [null, "", "x".repeat(257), "with space"])
      expect(() =>
        npRequireAgentOperatorCapabilityInvocationRequestV1({
          ...request,
          arguments: { ...request.arguments, idempotencyKey: key },
        }),
      ).toThrow();
    const result = {
      schemaVersion: "np.agent-operator-invocation-result.v1",
      invocationId: id,
      capabilityId: "audit.run",
      output: queued(),
    };
    expect(npRequireAgentOperatorCapabilityInvocationResultV1(result)).toEqual(result);
    expect(() =>
      npRequireAgentOperatorCapabilityInvocationResultV1({ ...result, capabilityId: "ops.plan" }),
    ).toThrow();
    for (const capabilityId of ["ops.status", "ops.execute"])
      expect(() =>
        npRequireAgentOperatorCapabilityInvocationRequestV1({ ...request, capabilityId }),
      ).toThrow();
    const parseInput = npRequireAgentOperatorCapabilityInputV1 as (
      id: string,
      value: unknown,
    ) => unknown;
    const parseOutput = npRequireAgentOperatorCapabilityOutputV1 as (
      id: string,
      value: unknown,
    ) => unknown;
    expect(() => parseInput("ops.execute", plan().operation)).toThrow();
    expect(() => parseOutput("ops.execute", plan())).toThrow();
    for (const id of ["audit.run", "ops.plan"] as const) {
      const definition = npBuildAgentOperatorCapabilityDefinitionCanonicalV1(id);
      expect(definition.capabilities[0].descriptor).toEqual(
        npAgentOperatorCapabilityDescriptorsV1[id],
      );
      expect(definition.capabilities[0].descriptor).toMatchObject({
        idempotency: "required",
        risk: "read",
        approval: "none",
        effectProfiles: [
          { id: "domain.read", minimumGatewayExposure: id === "audit.run" ? "read" : "propose" },
        ],
      });
    }
  });
});
