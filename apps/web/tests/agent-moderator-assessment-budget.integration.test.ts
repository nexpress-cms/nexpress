import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npRequireAgentModeratorAssessmentBudgetV1 } from "../../../packages/core/src/agent/moderator-assessment-budget.js";
import {
  npCreateAgentModeratorAssessmentRecipeDefinitionV1,
  npAgentModeratorAssessmentRecipeSetupV1,
} from "../../../packages/core/src/agent-contract/moderator-assessment-recipe-contract.js";
import { serializeAgentCanonicalJson } from "../../../packages/core/src/agent-contract/canonical-foundation.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import {
  npAgentIncidents,
  npAgentProviderCalls,
} from "../../../packages/core/src/db/schema/agent.js";
import type { NpAgentModeratorAssessmentEvidenceV1 } from "../../../packages/core/src/agent-contract/moderator-assessment-contract.js";
import type { NpAgentRuntimeRunContextV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import type {
  NpAgentProviderRequestCanonicalV1,
  NpAgentProviderInvokeOutcomeV1,
} from "../../../packages/core/src/agent-contract/types.js";
import { runtimeDefinition, siteId } from "./agent-runtime-service-fixture.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
const fixtures: Array<Awaited<ReturnType<typeof runtimeUsageFixture>>> = [];
async function setup() {
  const recipe = await npCreateAgentModeratorAssessmentRecipeDefinitionV1();
  const definition = runtimeDefinition();
  definition.template = "moderator";
  definition.autonomy = "observe";
  definition.scopes = [...npAgentModeratorAssessmentRecipeSetupV1.scopes];
  definition.capabilityModes = structuredClone(
    npAgentModeratorAssessmentRecipeSetupV1.capabilityModes,
  );
  definition.settings = [
    { ...npAgentModeratorAssessmentRecipeSetupV1.settings, collectionSlugs: ["posts"] },
  ];
  const f = await runtimeUsageFixture({
    delegated: true,
    definition,
    recipe,
    responseSchema: recipe.responseSchema,
    dataClassCeiling: "sensitive-approved",
  });
  fixtures.push(f);
  const incidentId = randomUUID(),
    fingerprint = "fixture.semantic-analysis";
  await f.db.insert(npAgentIncidents).values({
    id: incidentId,
    siteId,
    category: "spam",
    status: "open",
    severity: "medium",
    fingerprint,
    title: "Synthetic analysis budget case",
    summary: "No provider is invoked.",
    firstObservedAt: f.options.now(),
    lastObservedAt: f.options.now(),
  });
  const metadata: NpAgentModeratorAssessmentEvidenceV1 = {
    schemaVersion: "np.agent-moderator-assessment-evidence.v1",
    observedAt: f.options.now().toISOString(),
    incident: { id: incidentId, versionNumber: 1, fingerprint },
    truncated: true,
    sources: [],
  };
  async function request(
    runId = f.runId,
    selected = metadata,
    overrides: Partial<NpAgentProviderRequestCanonicalV1> = {},
  ) {
    const digest = `cj1:sha256:${createHash("sha256").update("np.agent-runtime-moderator-assessment.v1\0").update(serializeAgentCanonicalJson(selected)).digest("base64url")}`;
    const result = await f.request({
      runId,
      task: "moderation-classification",
      dataClass: "sensitive-approved",
      instruction: {
        ...recipe.instruction!,
        classification: {
          sourceDigest: recipe.instruction!.digest,
          dataClass: "public-only",
          classifierId: "fixture.code",
          classifierVersion: 1,
        },
      },
      trustedContext: [
        {
          id: "moderator-assessment",
          kind: "server-fact",
          digest,
          classification: {
            sourceDigest: digest,
            dataClass: "sensitive-approved",
            classifierId: "fixture.current-source",
            classifierVersion: 1,
          },
          text: serializeAgentCanonicalJson(selected),
        },
      ],
      ...overrides,
    });
    return {
      ...result,
      recipe: { ...result.recipe, id: recipe.id },
      dataClassCeiling: "sensitive-approved" as const,
    };
  }
  // An explicit test-only current-context verifier; no provider or inference adapter is called.
  const usage = createAgentRuntimeUsageV1({
    admission: f.admission,
    ambiguityWindowSeconds: 60,
    now: f.options.now,
    verifyRequest: () => true,
  });
  async function check(
    input: NpAgentProviderRequestCanonicalV1,
    values: {
      siteLimit?: number;
      agentLimit?: number;
      cooldown?: number;
      at?: Date;
      existingCallId?: string;
    } = {},
  ) {
    return f.admission.withCurrentRun({ siteId, runId: input.runId }, (context) => {
      const bounded: NpAgentRuntimeRunContextV1 = {
        ...context,
        now: values.at ?? context.now,
        siteBudget: {
          ...context.siteBudget,
          incidentAnalysesPerFingerprintPerDay: values.siteLimit ?? 100,
          incidentAnalysisCooldownSeconds: values.cooldown ?? 0,
        },
        agentBudget: {
          ...context.agentBudget,
          incidentAnalysesPerFingerprintPerDay: values.agentLimit ?? 100,
          incidentAnalysisCooldownSeconds: values.cooldown ?? 0,
        },
      };
      return npRequireAgentModeratorAssessmentBudgetV1(
        bounded,
        input,
        values.existingCallId ? { existingCallId: values.existingCallId } : {},
      );
    });
  }
  async function anotherRun() {
    return (await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() })).runId;
  }
  async function releaseUnsent(input: NpAgentProviderRequestCanonicalV1) {
    const outcome: NpAgentProviderInvokeOutcomeV1 = {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "failed",
      provider: input.provider,
      model: input.model,
      providerRequestId: null,
      output: null,
      errorClass: "transient",
      safeCode: "SYNTHETIC_TRANSIENT",
      retryable: true,
      dispatchState: "not-dispatched",
      usage: null,
      finishReason: null,
      latencyMs: 0,
    };
    return usage.reconcile({
      siteId,
      providerCallId: input.providerCallId,
      response: await f.response(input, outcome),
    });
  }
  return { ...f, usage, request, check, metadata, anotherRun, releaseUnsent };
}
describe.skipIf(skipIfNoTestDb())("Moderator fingerprint budget before provider dispatch", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
  });
  afterAll(closeTestDb);
  it("reserves once and checks both site/Agent caps and cooldown without double-counting its own dispatch", async () => {
    const f = await setup(),
      first = await f.request();
    await f.check(first, { siteLimit: 1, agentLimit: 1 });
    await f.usage.reserve({ siteId, runId: first.runId, request: first });
    await f.check(first, { siteLimit: 1, agentLimit: 1, existingCallId: first.providerCallId });
    const second = await f.request(await f.anotherRun());
    await f.check(second, { siteLimit: 2, agentLimit: 2, cooldown: 0 });
    await f.releaseUnsent(first);
    await expect(f.check(second, { siteLimit: 1 })).rejects.toMatchObject({
      code: "RUNTIME_BUDGET_BLOCKED",
    });
    await expect(f.check(second, { agentLimit: 1 })).rejects.toMatchObject({
      code: "RUNTIME_BUDGET_BLOCKED",
    });
    await expect(f.check(second, { cooldown: 3600 })).rejects.toMatchObject({
      code: "RUNTIME_BUDGET_BLOCKED",
    });
    await expect(
      f.check(second, { cooldown: 3600, at: new Date(f.options.now().getTime() + 3600000) }),
    ).resolves.toBeUndefined();
    await expect(
      f.check(second, {
        siteLimit: 1,
        agentLimit: 1,
        at: new Date(f.options.now().getTime() + 86400000),
      }),
    ).resolves.toBeUndefined();
  });
  it("permits an owned explicit retry as the same analysis but rejects a fresh turn or changed Incident under that Run", async () => {
    const f = await setup(),
      first = await f.request();
    await f.usage.reserve({ siteId, runId: first.runId, request: first });
    await f.releaseUnsent(first);
    const retry = await f.request(f.runId, f.metadata, {
      providerCallId: randomUUID(),
      idempotencyKey: randomUUID(),
      sequence: 2,
      retryOfId: first.providerCallId,
    });
    await f.check(retry, { siteLimit: 1, agentLimit: 1, cooldown: 3600 });
    await f.usage.reserve({ siteId, runId: retry.runId, request: retry });
    await f.check(retry, {
      siteLimit: 1,
      agentLimit: 1,
      cooldown: 3600,
      existingCallId: retry.providerCallId,
    });
    const extra = await f.request(f.runId, f.metadata, {
      providerCallId: randomUUID(),
      idempotencyKey: randomUUID(),
      sequence: 3,
      retryOfId: null,
    });
    await expect(f.check(extra)).rejects.toMatchObject({ code: "RUNTIME_BUDGET_BLOCKED" });
    const changed = await f.request(
      f.runId,
      {
        ...f.metadata,
        incident: { ...f.metadata.incident!, fingerprint: "fixture.other-analysis" },
      },
      {
        providerCallId: randomUUID(),
        idempotencyKey: randomUUID(),
        sequence: 3,
        retryOfId: first.providerCallId,
      },
    );
    await expect(f.check(changed)).rejects.toMatchObject({ code: "RUNTIME_BUDGET_BLOCKED" });
  });
  it("fails closed for missing recent diagnostics and keeps a corrupt reserved call undispatched", async () => {
    const f = await setup(),
      first = await f.request();
    await f.usage.reserve({ siteId, runId: first.runId, request: first });
    await f.db
      .update(npAgentProviderCalls)
      .set({ requestRedacted: null })
      .where(eq(npAgentProviderCalls.id, first.providerCallId));
    await expect(f.check(first, { existingCallId: first.providerCallId })).rejects.toMatchObject({
      code: "RUNTIME_BUDGET_UNAVAILABLE",
    });
    const other = await f.request(await f.anotherRun(), {
      ...f.metadata,
      incident: { ...f.metadata.incident!, fingerprint: "fixture.other" },
    });
    await expect(f.check(other)).rejects.toMatchObject({ code: "RUNTIME_BUDGET_UNAVAILABLE" });
    await expect(
      f.usage.beginDispatch({ siteId, runId: first.runId, request: first }),
    ).rejects.toBeInstanceOf(Error);
    expect((await f.call()).state).toBe("reserved");
  });
  it("does not share the target counter with another fingerprint and rejects unbound metadata before reserving", async () => {
    const f = await setup(),
      first = await f.request();
    await f.usage.reserve({ siteId, runId: first.runId, request: first });
    await f.releaseUnsent(first);
    const other = await f.request(await f.anotherRun(), {
      ...f.metadata,
      incident: { ...f.metadata.incident!, fingerprint: "fixture.other" },
    });
    await f.check(other, { siteLimit: 1, agentLimit: 1, cooldown: 3600 });
    const corrupted = structuredClone(other);
    corrupted.trustedContext[0].digest = `cj1:sha256:${"A".repeat(43)}`;
    await expect(f.check(corrupted)).rejects.toMatchObject({ code: "RUNTIME_BUDGET_UNAVAILABLE" });
    expect(await f.db.select().from(npAgentProviderCalls)).toHaveLength(1);
  });
  it("never frees an ambiguous analysis with time passage and blocks a second dispatch without adding a call", async () => {
    const f = await setup(),
      first = await f.request();
    const other = await f.request(await f.anotherRun());
    await f.usage.reserve({ siteId, runId: first.runId, request: first });
    await f.usage.beginDispatch({ siteId, runId: first.runId, request: first });
    const ambiguous: NpAgentProviderInvokeOutcomeV1 = {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "ambiguous",
      provider: first.provider,
      model: first.model,
      providerRequestId: null,
      output: null,
      errorClass: "timeout",
      safeCode: "SYNTHETIC_TIMEOUT",
      retryable: false,
      dispatchState: "unknown",
      usage: null,
      finishReason: null,
      latencyMs: 0,
    };
    await f.usage.reconcile({
      siteId,
      providerCallId: first.providerCallId,
      response: await f.response(first, ambiguous),
    });
    await expect(
      f.check(other, {
        siteLimit: 1000,
        agentLimit: 1000,
        cooldown: 0,
        at: new Date(f.options.now().getTime() + 2 * 86400000),
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_BUDGET_BLOCKED" });
    await expect(
      f.usage.reserve({ siteId, runId: other.runId, request: other }),
    ).rejects.toMatchObject({ code: "RUNTIME_USAGE_UNKNOWN" });
    expect(await f.db.select().from(npAgentProviderCalls)).toHaveLength(1);
    expect((await f.call()).state).toBe("ambiguous");
  });
});
