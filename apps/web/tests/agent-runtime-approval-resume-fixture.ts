import { vi } from "vitest";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import type { NpAgentProviderInvokeOutcomeV1 } from "../../../packages/core/src/agent-contract/types.js";
import {
  createAgentRuntimeExecutorV1,
  type NpAgentRuntimeExecutorV1,
} from "../../../packages/core/src/agent/runtime-executor.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { createAgentChangeSetCapabilityFacadeV1 } from "../../../packages/core/src/agent/changeset-capability.js";
import { npAgentDisabledGatewaySettingsV1 } from "../../../packages/core/src/agent-contract/types.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createAgentChangeSetServiceV1 } from "../../../packages/core/src/agent/changeset-service.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import {
  npBuildAgentChangeSetCapabilityDefinitionCanonicalV1,
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  npRequireAgentChangeSetExecutionOutputV1,
  type NpAgentChangeSetCapabilityIdV1,
  type NpAgentChangeSetCapabilityInvocationRequestV1,
} from "../../../packages/core/src/agent-contract/installed-capability-contract.js";
import {
  npAgentActions,
  npAgentChangesetValidationAttempts,
  npAgentChangesetPreviews,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  runtimeFixture,
  runtimeDefinition,
  runtimeBudget,
  runtimeRecipes,
  runtimeFingerprint,
  siteId,
} from "./agent-runtime-service-fixture.js";
import { previewConfiguration, previewStorageFixture } from "./agent-changeset-fixture.js";
import { decideApproval } from "./agent-changeset-execution-fixture.js";

/** Shared real delegated Run/ChangeSet fixture with optional explicit fake provider host. */
export async function runtimeApprovalResumeFixture(
  operation: "apply" | "schedule" = "apply",
  options: {
    provider?: boolean;
    rollback?: boolean;
    separateRequester?: boolean;
    queuedWork?: {
      kind: "validation" | "preview";
      check: (input: {
        fixture:
          | Awaited<ReturnType<typeof runtimeFixture>>
          | Awaited<ReturnType<typeof runtimeUsageFixture>>;
        service: ReturnType<typeof createAgentChangeSetServiceV1>;
        job: { siteId: string; id: string };
      }) => Promise<never>;
    };
  } = {},
) {
  const definition = runtimeDefinition();
  definition.autonomy = "approved";
  definition.scopes = [
    "changeset:apply",
    "changeset:read",
    "changeset:write",
    "content:draft",
    "content:publish",
    "content:read",
    "settings:read",
    "settings:write",
    "site:read",
  ];
  definition.capabilityModes = [
    "changeset.apply",
    "changeset.create",
    "changeset.preview",
    ...(options.rollback ? ["changeset.rollback"] : []),
    "changeset.schedule",
    "changeset.validate",
  ].map((capabilityId) => ({
    capabilityId: capabilityId as NpAgentChangeSetCapabilityIdV1,
    mode: "approved",
  }));
  const recipes = runtimeRecipes();
  recipes.recipes[0].capabilityIds = definition.capabilityModes.map((row) => row.capabilityId);
  const providerInvoke = vi.fn((): Promise<NpAgentProviderInvokeOutcomeV1> =>
    Promise.resolve({
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "succeeded",
      provider: "fake-provider",
      model: "fake-model",
      providerRequestId: null,
      output: {
        task: "interactive-capability",
        decision: { kind: "complete", summary: "Approved execution completed" },
      },
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
    }),
  );
  const providerFixture = options.provider
    ? await runtimeUsageFixture({
        delegated: true,
        definition,
        budget: runtimeBudget({
          inputTokensPerRun: 20_000,
          inputTokensPerDay: 100_000,
          inputTokensPerMonth: 100_000,
          outputTokensPerRun: 1_000,
          outputTokensPerDay: 100_000,
          outputTokensPerMonth: 100_000,
          costMicrosPerDay: 1_000_000,
          costMicrosPerMonth: 1_000_000,
        }),
        dataClassCeiling: "sensitive-approved",
        providerInference: { invoke: providerInvoke },
        limits: {
          maxCapabilityCalls: 12,
          maxAttempts: 8,
          maxInputTokens: 20_000,
          maxOutputTokens: 1_000,
          maxCostMicros: 100_000,
        },
      })
    : null;
  const f =
    providerFixture ??
    (await runtimeFixture(undefined, true, {
      delegated: true,
      definition,
      recipes,
      maxCapabilityCalls: 12,
      maxAttempts: 8,
    }));
  const { adapter } = previewStorageFixture();
  const configuration = previewConfiguration();
  const applyJobs: unknown[] = [];
  const service = createAgentChangeSetServiceV1({
    cursorKey: new Uint8Array(32).fill(44),
    ...(options.queuedWork?.kind === "validation" ? { inlineValidationOperationLimit: 0 } : {}),
    runtimeAdmission: f.admission,
    now: f.options.now,
    secretRequestDigestKey: { id: "runtime-execution-request", key: new Uint8Array(32).fill(72) },
    reauthentication: {
      verify: () => ({
        reauthenticatedAt: f.options.now().toISOString(),
        sessionFactFingerprint: runtimeFingerprint,
      }),
    },
    approvals: {
      integrityKeys: {
        active: {
          owner: "approval-integrity",
          id: "runtime-execution",
          bytes: new Uint8Array(32).fill(71),
        },
      },
      challengeKeys: {
        active: { id: "runtime-execution-challenge", key: new Uint8Array(32).fill(73) },
      },
      lifetimeSeconds: 600,
      resolveExecutionBinding: ({ intendedOperation }) =>
        Promise.resolve(
          npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(`changeset.${intendedOperation}`),
        ),
    },
    execution: {
      resolveIntent: () => Promise.resolve({ enabled: true, paused: false }),
      verificationFingerprint: runtimeFingerprint,
      verifyConvergence: () => Promise.resolve({ status: "passed", evidenceRefs: [] }),
      enqueueApply: (job) => {
        applyJobs.push(job);
        return Promise.resolve();
      },
    },
    preview: {
      ...configuration,
      storageAdapter: adapter,
      resolveAdapter: () => adapter,
      checks: {
        rendererId: configuration.contract.rendererId,
        rendererVersion: configuration.contract.rendererVersion,
        rendererFingerprint: configuration.contract.rendererFingerprint,
        productionOrigins: ["https://site.example"],
        resolveManifest: () => Promise.resolve([{ route: "/", locale: null, audience: "public" }]),
        render: () =>
          Promise.resolve(
            '<html lang="en"><head><title>Review</title><meta name="description" content="Review"></head><body><main>Preview</main></body></html>',
          ),
      },
    },
  });
  const store = createAgentRuntimeExecutionStoreV1({
    admission: f.admission,
    approval: service,
    now: f.options.now,
  });
  const admitted = providerFixture
    ? { runId: providerFixture.runId }
    : await f.admission.admit(f.runInput);
  let input = { siteId, runId: admitted.runId };
  const creatorInput = input;
  const acquired = await store.claim(input);
  if (!acquired.claim) throw new Error("Expected Run claim");
  let claimed = { ...input, claim: acquired.claim };
  const invoke = async (
    capabilityId: NpAgentChangeSetCapabilityIdV1,
    args: unknown,
    sequence: number,
  ) =>
    service.invokeRuntimeCapability({
      ...claimed,
      sequence: input.runId === creatorInput.runId ? sequence : sequence - 1,
      request: npRequireAgentInstalledCapabilityInvocationRequestV1({
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId,
        arguments: { input: args, idempotencyKey: randomUUID() },
      }) as NpAgentChangeSetCapabilityInvocationRequestV1,
    });
  const created = await invoke(
    "changeset.create",
    {
      title: "Runtime SEO",
      summary: null,
      operations: [
        {
          kind: "setting",
          operation: "replace",
          clientOperationId: "seo",
          reason: null,
          resource: { key: "seo" },
          base: null,
          input: { value: { defaultOgImage: null, twitterHandle: "runtime", defaultLocale: "en" } },
        },
      ],
    },
    1,
  );
  if (!("changeSet" in created.output)) throw new Error("Expected ChangeSet");
  const draft = created.output.changeSet;
  if (options.separateRequester) {
    if (providerFixture) throw new Error("Separate requester requires the local Runtime fixture");
    await store.transition({ ...claimed, state: "succeeded" });
    const requester = await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() });
    input = { siteId, runId: requester.runId };
    const acquiredRequester = await store.claim(input);
    if (!acquiredRequester.claim) throw new Error("Expected requester Run claim");
    claimed = { ...input, claim: acquiredRequester.claim };
  }
  const validated = await invoke(
    "changeset.validate",
    { changeSetId: draft.id, draftVersion: draft.draftVersion, draftHash: draft.draftHash },
    2,
  );
  if (!("changeSet" in validated.output)) throw new Error("Expected validated ChangeSet");
  if (options.queuedWork?.kind === "validation") {
    const [attempt] = await f.db
      .select()
      .from(npAgentChangesetValidationAttempts)
      .where(eq(npAgentChangesetValidationAttempts.changesetId, draft.id));
    await options.queuedWork.check({ fixture: f, service, job: { siteId, id: attempt.id } });
  }
  const sealed = validated.output.changeSet;
  await invoke("changeset.preview", { changeSetId: draft.id, planHash: sealed.planHash }, 3);
  const [preview] = await f.db
    .select()
    .from(npAgentChangesetPreviews)
    .where(
      and(
        eq(npAgentChangesetPreviews.siteId, siteId),
        eq(npAgentChangesetPreviews.changesetId, draft.id),
      ),
    );
  if (options.queuedWork?.kind === "preview")
    await options.queuedWork.check({ fixture: f, service, job: { siteId, id: preview.id } });
  await service.processPreview({ siteId, previewId: preview.id });
  const requested = await invoke(
    `changeset.${operation}`,
    {
      changeSetId: draft.id,
      planHash: sealed.planHash,
      approvalId: null,
      ...(operation === "schedule"
        ? { scheduledFor: new Date(f.options.now().getTime() + 60_000).toISOString() }
        : {}),
    },
    4,
  );
  const required = npRequireAgentChangeSetExecutionOutputV1(requested.output);
  if (required.state !== "approval_required") throw new Error("Expected approval request");
  await store.transition({ ...claimed, state: "waiting_approval" });
  const requestActionId = required.actionId;
  let processor: NpAgentRuntimeExecutorV1 | null = null;
  let dispose: () => Promise<void> = () => Promise.resolve();
  if (providerFixture) {
    const registry = await createAgentReadCapabilityRegistryV1(
      createAgentCoreReadCapabilityExecutorsV1({
        cursorHmacKey: { id: "runtime-approval", key: new Uint8Array(32).fill(26) },
        resolveBlockSchemas: () => [],
        resolveUser: () => f.actor.actor.user,
      }),
    );
    const facade = createAgentChangeSetCapabilityFacadeV1(service);
    const capabilities = createAgentCapabilityAdmissionServiceV1({
      registry,
      runtimeAdmission: f.admission,
      resolveChangeSetCapabilities: () => facade,
      resolveGatewaySettings: () => npAgentDisabledGatewaySettingsV1,
      now: f.options.now,
    });
    const context = createAgentRuntimeContextV1({
      admission: f.admission,
      capabilities: {
        list: capabilities.sourceEntries,
        actionOutcomes: capabilities.runtimeActionOutcomes,
      },
    });
    const usage = createAgentRuntimeUsageV1({
      admission: f.admission,
      ambiguityWindowSeconds: 300,
      verifyRequest: context.verifyRequest,
      now: f.options.now,
    });
    const provider = createAgentProviderInferenceRuntimeV1({
      registry: providerFixture.providerRegistry,
      now: f.options.now,
    });
    const breakers = createAgentRuntimeBreakersV1({
      failureThreshold: 3,
      windowSeconds: 60,
      cooldownSeconds: 30,
      now: f.options.now,
    });
    processor = createAgentRuntimeExecutorV1({
      store,
      context,
      usage,
      provider,
      providerRegistry: providerFixture.providerRegistry,
      vault: providerFixture.vault,
      capabilities,
      breakers,
      now: f.options.now,
    });
    const executor = processor;
    dispose = async () => {
      executor.shutdown();
      context.dispose();
      await provider.shutdown();
      await providerFixture.dispose();
    };
  }
  return {
    ...f,
    processor,
    providerInvoke,
    dispose,
    service,
    store,
    input,
    creatorInput,
    claimed,
    sealed,
    requested,
    required,
    requestActionId,
    applyJobs,
    async approve() {
      const detail = await service.approvals!.get({
        siteId,
        actor: f.actor.actor,
        id: required.approvalId,
      });
      return decideApproval(service.approvals!, f.actor, detail);
    },
    async requestAction() {
      return (
        await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, requestActionId))
      )[0];
    },
    async run() {
      return (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, input.runId)))[0];
    },
  };
}
