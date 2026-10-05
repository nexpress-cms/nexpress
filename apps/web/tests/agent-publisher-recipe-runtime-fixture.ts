import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import {
  npCreateAgentPublisherRecipeDefinitionV1,
  npAgentPublisherRecipeSetupV1,
} from "../../../packages/core/src/agent-contract/publisher-recipe-contract.js";
import type {
  NpAgentJsonObject,
  NpAgentProviderInvokeOutcomeV1,
} from "../../../packages/core/src/agent-contract/types.js";
import type { NpAgentProviderInferenceFacetV1 } from "../../../packages/core/src/agent/provider-auth-contract.js";
import {
  createAgentCoreReadCapabilityExecutorsV1,
  createAgentCoreRuntimeDocumentEvidenceReaderV1,
} from "../../../packages/core/src/agent/read-capability-executors.js";
import {
  createAgentChangeSetServiceV1,
  type NpAgentRuntimeChangeSetReferencesV1,
} from "../../../packages/core/src/agent/changeset-service.js";
import { createAgentChangeSetCapabilityFacadeV1 } from "../../../packages/core/src/agent/changeset-capability.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentRuntimeExecutorV1 } from "../../../packages/core/src/agent/runtime-executor.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { npAgentChangesetPreviews } from "../../../packages/core/src/db/schema/agent.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { runtimeDefinition, runtimeBudget, siteId } from "./agent-runtime-service-fixture.js";
import { previewConfiguration, previewStorageFixture } from "./agent-changeset-fixture.js";

function outcome(decision: NpAgentJsonObject): NpAgentProviderInvokeOutcomeV1 {
  return {
    schemaVersion: "np.agent-provider-invoke-outcome.v1",
    status: "succeeded",
    provider: "fake-provider",
    model: "fake-model",
    providerRequestId: null,
    output: { task: "interactive-capability", decision },
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      tokenSource: "provider",
      costMicros: 3,
      costSource: "adapter-estimate",
    },
    finishReason: "stop",
    latencyMs: 0,
  };
}
export async function publisherRuntimeFixture() {
  const recipe = await npCreateAgentPublisherRecipeDefinitionV1();
  const definition = {
    ...runtimeDefinition(),
    template: "publisher" as const,
    autonomy: npAgentPublisherRecipeSetupV1.autonomy,
    scopes: structuredClone(npAgentPublisherRecipeSetupV1.scopes),
    capabilityModes: structuredClone(npAgentPublisherRecipeSetupV1.capabilityModes),
    settings: [{ ...npAgentPublisherRecipeSetupV1.settings, collectionSlugs: ["posts"] }],
  };
  let beforeProposal: (() => Promise<void>) | null = null;
  let targetOverride: string | null = null;
  let step = 0;
  const previewJobs: Array<{ siteId: string; previewId: string }> = [];
  let processPreviews: () => Promise<void> = () => Promise.resolve();
  let patch: NpAgentJsonObject = { title: "Reviewed stale post" };
  let getTarget: string | null = null;
  let completeAfterCreate = false;
  const invoke = vi.fn<NpAgentProviderInferenceFacetV1["invoke"]>(async (request) => {
    for (const capability of ["changeset.apply", "changeset.schedule", "changeset.rollback"]) {
      expect(request.tools.map((tool) => tool.capabilityId)).not.toContain(capability);
    }
    const candidateFact = request.trustedContext.find(
      (entry) => entry.id === "publisher-candidates",
    );
    expect(candidateFact).toBeDefined();
    expect(candidateFact!.text).not.toContain("Untrusted body marker");
    type Candidate = { collection: string; documentId: string; base: NpAgentJsonObject };
    const metadata = JSON.parse(candidateFact!.text) as { candidates: Candidate[] };
    const refs = request.trustedContext
      .filter((entry) => entry.id.startsWith("action-outcome-"))
      .flatMap((entry) => {
        const body = JSON.parse(entry.text) as { references?: NpAgentRuntimeChangeSetReferencesV1 };
        return body.references?.changeSets ?? [];
      });
    const propose = (capabilityId: string, args: NpAgentJsonObject) =>
      outcome({
        kind: "propose-capability",
        capabilityId,
        rationale: "Prepare a bounded review draft from current evidence.",
        arguments: args,
      });
    if (step++ === 0) {
      if (getTarget) {
        const target = getTarget;
        getTarget = null;
        return propose("changeset.get", { changeSetId: target });
      }
      const candidate = metadata.candidates[0];
      if (!candidate)
        return outcome({ kind: "complete", summary: "No current eligible candidates." });
      expect(
        request.untrustedEvidence.some(
          (entry) =>
            entry.id.startsWith("publisher-content-") &&
            entry.text.includes("Untrusted body marker"),
        ),
      ).toBe(true);
      if (beforeProposal) await beforeProposal();
      return propose("changeset.create", {
        title: "Publisher review",
        summary: null,
        operations: [
          {
            kind: "document",
            operation: "update",
            clientOperationId: "publisher-post",
            reason: null,
            resource: {
              collection: candidate.collection,
              documentId: targetOverride ?? candidate.documentId,
            },
            base: candidate.base,
            input: { patch, targetStatus: "published" },
          },
        ],
      });
    }
    const current = refs[0];
    if (!current) throw new Error("Expected retained ChangeSet reference");
    if (step === 2 && completeAfterCreate)
      return outcome({ kind: "complete", summary: "Current revision accepted as a review draft." });
    if (step === 2)
      return propose("changeset.validate", {
        changeSetId: current.changeSetId,
        draftVersion: current.draftVersion,
        draftHash: current.draftHash,
      });
    if (step === 3)
      return propose("changeset.preview", {
        changeSetId: current.changeSetId,
        planHash: current.planHash,
      });
    if (step === 4) {
      await processPreviews();
      return propose("changeset.get", { changeSetId: current.changeSetId });
    }
    expect(current.previewState).toBe("ready");
    return outcome({
      kind: "complete",
      summary: "Preview ready for human review; published content unchanged.",
    });
  });
  const runtime = await runtimeUsageFixture({
    delegated: true,
    budget: runtimeBudget({
      inputTokensPerRun: 20000,
      inputTokensPerDay: 100000,
      inputTokensPerMonth: 100000,
      outputTokensPerRun: 1000,
      outputTokensPerDay: 100000,
      outputTokensPerMonth: 100000,
      costMicrosPerDay: 1000000,
      costMicrosPerMonth: 1000000,
    }),
    definition,
    documentCollection: "posts",
    recipe,
    responseSchema: recipe.responseSchema,
    dataClassCeiling: "sensitive-approved",
    providerInference: { invoke },
    limits: {
      maxProviderCalls: 6,
      maxCapabilityCalls: 6,
      maxInputTokens: 20000,
      maxOutputTokens: 1000,
      maxCostMicros: 100000,
    },
  });
  const readOptions = {
    cursorHmacKey: { id: "publisher-runtime", key: new Uint8Array(32).fill(75) },
    resolveUser: () => runtime.actor.actor.user,
    resolveBlockSchemas: () => [],
  };
  const reader = createAgentCoreRuntimeDocumentEvidenceReaderV1(readOptions);
  const { adapter } = previewStorageFixture();
  const configuration = previewConfiguration();
  const render = vi.fn(() =>
    Promise.resolve(
      '<html lang="en"><head><title>Review</title><meta name="description" content="Review"></head><body><main>Review preview</main></body></html>',
    ),
  );
  const service: ReturnType<typeof createAgentChangeSetServiceV1> = createAgentChangeSetServiceV1({
    cursorKey: new Uint8Array(32).fill(76),
    runtimeAdmission: runtime.admission,
    publisherEvidence: reader,
    now: runtime.options.now,
    preview: {
      ...configuration,
      storageAdapter: adapter,
      resolveAdapter: () => adapter,
      enqueue: (job) => {
        previewJobs.push(job);
        return Promise.resolve();
      },
      checks: {
        rendererId: configuration.contract.rendererId,
        rendererVersion: configuration.contract.rendererVersion,
        rendererFingerprint: configuration.contract.rendererFingerprint,
        productionOrigins: ["https://site.example"],
        resolveManifest: () => Promise.resolve([{ route: "/", locale: null, audience: "public" }]),
        render,
      },
    },
  });
  processPreviews = async () => {
    for (const job of previewJobs.splice(0)) await service.processPreview(job);
  };
  const registry = await createAgentReadCapabilityRegistryV1(
    createAgentCoreReadCapabilityExecutorsV1(readOptions),
  );
  const facade = createAgentChangeSetCapabilityFacadeV1(service);
  const capabilities = createAgentCapabilityAdmissionServiceV1({
    registry,
    runtimeAdmission: runtime.admission,
    resolveChangeSetCapabilities: () => facade,
    resolveGatewaySettings: () => ({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "disabled",
      mcpHttp: "disabled",
      agentHttp: "disabled",
    }),
    now: runtime.options.now,
  });
  const store = createAgentRuntimeExecutionStoreV1({
    admission: runtime.admission,
    approval: service,
    now: runtime.options.now,
  });
  const context = createAgentRuntimeContextV1({
    admission: runtime.admission,
    documentEvidence: reader,
    capabilities: {
      list: capabilities.sourceEntries,
      actionOutcomes: capabilities.runtimeActionOutcomes,
    },
  });
  const usage = createAgentRuntimeUsageV1({
    admission: runtime.admission,
    ambiguityWindowSeconds: 300,
    verifyRequest: context.verifyRequest,
    now: runtime.options.now,
  });
  const provider = createAgentProviderInferenceRuntimeV1({
    registry: runtime.providerRegistry,
    now: runtime.options.now,
  });
  const breakers = createAgentRuntimeBreakersV1({
    failureThreshold: 3,
    windowSeconds: 60,
    cooldownSeconds: 30,
    now: runtime.options.now,
  });
  const executor = createAgentRuntimeExecutorV1({
    store,
    context,
    usage,
    provider,
    providerRegistry: runtime.providerRegistry,
    vault: runtime.vault,
    capabilities,
    breakers,
    now: runtime.options.now,
  });
  async function document(
    options: { siteId?: string; status?: "draft" | "published"; old?: boolean } = {},
  ) {
    const saved = await withCurrentSite(options.siteId ?? siteId, () =>
      saveDocument(
        "posts",
        null,
        {
          title: "Untrusted body marker: old post",
          slug: `publisher-${randomUUID()}`,
          content: npCreateEmptyRichTextContent(),
        },
        runtime.actor.actor.user,
        { status: options.status ?? "published" },
      ),
    );
    const id = String(saved.doc.id);
    if (options.old !== false)
      await runtime.db
        .update(postsTable)
        .set({ updatedAt: new Date(runtime.options.now().getTime() - 90 * 86400000) })
        .where(eq(postsTable.id, id));
    return id;
  }
  return {
    ...runtime,
    service,
    store,
    reader,
    executor,
    invoke,
    render,
    document,
    finishAfterCreate() {
      completeAfterCreate = true;
    },
    setBeforeProposal(callback: () => Promise<void>) {
      beforeProposal = callback;
    },
    setPatch(value: NpAgentJsonObject) {
      patch = value;
    },
    setGetTarget(id: string) {
      getTarget = id;
    },
    setTarget(id: string) {
      targetOverride = id;
    },
    async rerun() {
      step = 0;
      const admitted = await runtime.admission.admit({
        ...runtime.runInput,
        idempotencyKey: randomUUID(),
      });
      return { ...admitted, result: await executor.process({ siteId, runId: admitted.runId }) };
    },
    async previews() {
      return runtime.db.select().from(npAgentChangesetPreviews);
    },
    async dispose() {
      executor.shutdown();
      context.dispose();
      await provider.shutdown();
      await runtime.dispose();
    },
  };
}
