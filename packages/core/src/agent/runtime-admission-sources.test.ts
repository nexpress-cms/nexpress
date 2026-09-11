import { describe, expect, it } from "vitest";
import {
  npDeriveAgentRuntimeAdmissionSourceRefsV1,
  npVerifyAgentRuntimeAdmissionSourcesV1,
} from "./runtime-admission-sources.js";
import {
  npCreateDisabledAgentRuntimeSettingsV1,
  npCreateInheritedAgentBudgetV1,
  type NpAgentRuntimeAdmissionSourcesV1,
} from "../agent-contract/runtime-contract.js";
import { npAgentBudgetDimensionKeysV1 } from "../agent-contract/wire-contract.js";
import {
  npResolveAgentBudgetV1,
  npAgentBudgetWindowsV1,
} from "../agent-contract/runtime-budget.js";
import { npResolveAgentPolicyV1 } from "../agent-contract/runtime-policy.js";
import { npDigestAgentRunLimitsCanonical } from "../agent-contract/canonical-bodies.js";
import { npDigestAgentBudgetSnapshotCanonical } from "../agent-contract/canonical-budget-snapshot.js";
import type {
  NpAgentBudgetSnapshotCanonicalV1,
  NpAgentRunAdmissionCanonicalV1,
} from "../agent-contract/types.js";

const digest = `cj1:sha256:${"A".repeat(43)}`;
const otherDigest = `cj1:sha256:${"B".repeat(43)}`;
const principalId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const agentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const versionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const runId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd4";
const invalid = { code: "RUNTIME_ADMISSION_INVALID", status: 409 };

async function fixture() {
  const deploymentBudget = npCreateInheritedAgentBudgetV1();
  for (const key of npAgentBudgetDimensionKeysV1)
    deploymentBudget[key] = key === "incidentAnalysisCooldownSeconds" ? 0 : 1_000;
  const frameworkRules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  frameworkRules.capabilityModes = [{ capabilityId: "site.inspect", mode: "observe" }];
  const siteRules = structuredClone(frameworkRules);
  siteRules.resources.collections = ["posts"];
  const sources: NpAgentRuntimeAdmissionSourcesV1 = {
    schemaVersion: "np.agent-runtime-admission-sources.v1",
    frameworkPolicy: {
      schemaVersion: "np.agent-policy.v1",
      instructions: "",
      rules: frameworkRules,
    },
    frameworkPolicyVersion: 2,
    sitePolicy: { schemaVersion: "np.agent-policy.v1", instructions: "", rules: siteRules },
    deploymentBudget,
    siteBudget: { ...npCreateInheritedAgentBudgetV1(), inputTokensPerDay: 10 },
  };
  const refs = await npDeriveAgentRuntimeAdmissionSourceRefsV1({ sources, settingsRevision: 3 });
  const recipe = { id: "operator.worker-not-draining", version: 1, fingerprint: digest } as const;
  const at = "2026-09-11T00:00:00.000Z";
  const budgetSnapshot: NpAgentBudgetSnapshotCanonicalV1 = {
    schemaVersion: "np.agent-budget-snapshot.v1",
    siteId: "test-site",
    principalId,
    agentId,
    recipe,
    capturedAt: at,
    sourceRefs: [
      { kind: "agent", id: agentId, version: 4, digest },
      ...refs.budgetSourceRefs,
      { kind: "recipe", id: recipe.id, version: 1, digest },
    ].sort((a, b) =>
      a.kind.localeCompare(b.kind),
    ) as NpAgentBudgetSnapshotCanonicalV1["sourceRefs"],
    limits: {
      schemaVersion: "np.agent-run-limits.v1",
      maxAttempts: 1,
      maxProviderCalls: 1,
      maxCapabilityCalls: 1,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxCostMicros: 0,
      maxWallClockSeconds: 60,
    },
    counters: {
      concurrentRuns: 0,
      concurrentProviderCalls: 0,
      runsRollingHour: 0,
      providerCallsRollingHour: 0,
      inputTokensUtcDay: 0,
      outputTokensUtcDay: 0,
      inputTokensUtcMonth: 0,
      outputTokensUtcMonth: 0,
      costMicrosUtcDay: 0,
      costMicrosUtcMonth: 0,
      incidentAnalysesFingerprintUtcDay: 0,
      directActionsRollingHour: 0,
      directActionsSubjectRollingHour: 0,
    },
    windows: npAgentBudgetWindowsV1(at),
    reservation: { runs: 1, providerCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 },
  };
  const admission: NpAgentRunAdmissionCanonicalV1 = {
    schemaVersion: "np.agent-run-admission.v1",
    siteId: "test-site",
    origin: "runtime",
    principalId,
    invocationId: null,
    triggerId: null,
    agent: { id: agentId, versionId, configHash: digest },
    lineage: {
      rootRunId: runId,
      parentRunId: null,
      causalDepth: 0,
      causalEventId: null,
      causalActionId: null,
    },
    recipe: {
      ...recipe,
      instructionTemplateId: null,
      instructionTemplateVersion: null,
      instructionDigest: null,
      responseSchemaDigest: digest,
      manualInputSchemaDigest: null,
    },
    goal: "Run operator.worker-not-draining",
    eventRef: null,
    policyRefs: refs.policyRefs,
    runLimitsHash: await npDigestAgentRunLimitsCanonical(budgetSnapshot.limits),
    budgetSnapshotHash: await npDigestAgentBudgetSnapshotCanonical(budgetSnapshot),
    idempotencyKey: "runtime:test",
    connection: null,
    admittedAt: at,
    deadlineAt: "2026-09-11T00:01:00.000Z",
  };
  return { sources, admission, budgetSnapshot };
}

async function rehashBudget(value: Awaited<ReturnType<typeof fixture>>) {
  value.admission.budgetSnapshotHash = await npDigestAgentBudgetSnapshotCanonical(
    value.budgetSnapshot,
  );
  return value;
}

describe("Runtime retained admission source evidence", () => {
  it("derives the existing policy and private budget refs with one shared settings revision", async () => {
    const value = await fixture();
    const refs = await npDeriveAgentRuntimeAdmissionSourceRefsV1({
      sources: value.sources,
      settingsRevision: 3,
    });
    expect(refs.policyRefs.map(({ kind, id, version }) => ({ kind, id, version }))).toEqual([
      { kind: "feature-setting", id: null, version: 3 },
      { kind: "framework", id: null, version: 2 },
    ]);
    expect(refs.budgetSourceRefs.map(({ kind, id, version }) => ({ kind, id, version }))).toEqual([
      { kind: "deployment", id: null, version: 1 },
      { kind: "site", id: null, version: 3 },
    ]);
    const parsed = await npVerifyAgentRuntimeAdmissionSourcesV1(value);
    expect(parsed).toEqual(value.sources);
    expect(parsed.frameworkPolicy.rules).not.toBe(value.sources.frameworkPolicy.rules);
  });

  it("makes widened current budgets and policies intersect the verified frozen source bodies", async () => {
    const value = await fixture();
    const frozen = await npVerifyAgentRuntimeAdmissionSourcesV1(value);
    const currentBudget = { ...frozen.siteBudget, inputTokensPerDay: 100 };
    expect(
      npResolveAgentBudgetV1(frozen.deploymentBudget, [frozen.siteBudget, currentBudget])
        .inputTokensPerDay,
    ).toBe(10);
    expect(
      npResolveAgentBudgetV1(frozen.deploymentBudget, [
        frozen.siteBudget,
        { ...currentBudget, inputTokensPerDay: 5 },
      ]).inputTokensPerDay,
    ).toBe(5);
    const currentRules = structuredClone(frozen.sitePolicy.rules);
    currentRules.resources.collections = null;
    expect(
      npResolveAgentPolicyV1({
        autonomy: "observe",
        capabilityModes: [{ capabilityId: "site.inspect", mode: "observe" }],
        layers: [frozen.frameworkPolicy.rules, frozen.sitePolicy.rules, currentRules],
      }).resources.collections,
    ).toEqual(["posts"]);
  });

  it("rejects source changes even when the replacement remains a valid policy or budget", async () => {
    for (const change of [
      (value: NpAgentRuntimeAdmissionSourcesV1) => {
        value.frameworkPolicyVersion += 1;
      },
      (value: NpAgentRuntimeAdmissionSourcesV1) => {
        value.frameworkPolicy.rules.providerDataMaximum = "internal-redacted";
      },
      (value: NpAgentRuntimeAdmissionSourcesV1) => {
        value.sitePolicy.rules.resources.collections = null;
      },
      (value: NpAgentRuntimeAdmissionSourcesV1) => {
        value.deploymentBudget.inputTokensPerDay = 2_000;
      },
      (value: NpAgentRuntimeAdmissionSourcesV1) => {
        value.siteBudget.inputTokensPerDay = 100;
      },
      (value: NpAgentRuntimeAdmissionSourcesV1) => {
        value.siteBudget.inputTokensPerDay = 5;
      },
    ]) {
      const value = await fixture();
      change(value.sources);
      await expect(npVerifyAgentRuntimeAdmissionSourcesV1(value)).rejects.toMatchObject(invalid);
    }
  });

  it("requires exactly one null-id framework and feature-setting ref with their frozen digests", async () => {
    for (const kind of ["framework", "feature-setting"] as const) {
      for (const change of [
        "missing",
        "duplicate",
        "wrong-id",
        "wrong-version",
        "wrong-digest",
      ] as const) {
        const value = await fixture();
        const ref = value.admission.policyRefs.find((entry) => entry.kind === kind)!;
        if (change === "missing")
          value.admission.policyRefs = value.admission.policyRefs.filter((entry) => entry !== ref);
        if (change === "duplicate")
          value.admission.policyRefs.push({ ...ref, version: ref.version + 1 });
        if (change === "wrong-id") ref.id = agentId;
        if (change === "wrong-version") ref.version += 1;
        if (change === "wrong-digest") ref.digest = otherDigest;
        value.admission.policyRefs.sort(
          (a, b) => a.kind.localeCompare(b.kind) || a.version - b.version,
        );
        await expect(npVerifyAgentRuntimeAdmissionSourcesV1(value)).rejects.toMatchObject(invalid);
      }
    }
  });

  it("rejects rehashed budget refs with a different settings revision or source domain", async () => {
    for (const change of ["revision", "id", "digest", "missing", "extra"] as const) {
      const value = await fixture();
      const ref = value.budgetSnapshot.sourceRefs.find((entry) => entry.kind === "site")!;
      if (change === "revision") ref.version += 1;
      if (change === "id") ref.id = "test-site";
      if (change === "digest")
        ref.digest = value.budgetSnapshot.sourceRefs.find(
          (entry) => entry.kind === "deployment",
        )!.digest;
      if (change === "missing")
        value.budgetSnapshot.sourceRefs = value.budgetSnapshot.sourceRefs.filter(
          (entry) => entry !== ref,
        );
      if (change === "extra")
        value.budgetSnapshot.sourceRefs.push({ kind: "policy", id: null, version: 1, digest });
      value.budgetSnapshot.sourceRefs.sort((a, b) => a.kind.localeCompare(b.kind));
      await expect(
        npVerifyAgentRuntimeAdmissionSourcesV1(await rehashBudget(value)),
      ).rejects.toMatchObject(invalid);
    }
  });

  it("binds the existing budget body to the same site, principal, Agent, recipe, time and limits", async () => {
    for (const change of [
      "site",
      "principal",
      "agent",
      "recipe",
      "time",
      "limits",
      "agent-ref",
      "recipe-ref",
    ] as const) {
      const value = await fixture();
      if (change === "site") value.budgetSnapshot.siteId = "other-site";
      if (change === "principal") value.budgetSnapshot.principalId = versionId;
      if (change === "agent") value.budgetSnapshot.agentId = versionId;
      if (change === "recipe") value.budgetSnapshot.recipe!.fingerprint = otherDigest;
      if (change === "time") value.admission.admittedAt = "2026-09-11T00:00:01.000Z";
      if (change === "limits") value.budgetSnapshot.limits.maxAttempts = 2;
      if (change === "agent-ref")
        value.budgetSnapshot.sourceRefs.find((ref) => ref.kind === "agent")!.digest = otherDigest;
      if (change === "recipe-ref")
        value.budgetSnapshot.sourceRefs.find((ref) => ref.kind === "recipe")!.version = 2;
      await expect(
        npVerifyAgentRuntimeAdmissionSourcesV1(await rehashBudget(value)),
      ).rejects.toMatchObject(invalid);
    }
  });

  it("rejects unknown fields and getters before evaluating values or deriving hashes", async () => {
    const value = await fixture();
    let reads = 0;
    const hostile = { ...value };
    Object.defineProperty(hostile, "sources", {
      enumerable: true,
      get() {
        reads += 1;
        return value.sources;
      },
    });
    await expect(npVerifyAgentRuntimeAdmissionSourcesV1(hostile)).rejects.toMatchObject(invalid);
    await expect(
      npVerifyAgentRuntimeAdmissionSourcesV1({ ...value, bypass: true } as typeof value),
    ).rejects.toMatchObject(invalid);
    await expect(
      npDeriveAgentRuntimeAdmissionSourceRefsV1({ sources: value.sources, settingsRevision: 0 }),
    ).rejects.toMatchObject(invalid);
    expect(reads).toBe(0);
  });
});
