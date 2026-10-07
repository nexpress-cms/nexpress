import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import type { NpAgentProviderInferenceFacetV1 } from "../../../packages/core/src/agent/provider-auth-contract.js";
import type { NpAgentAdminActorV1 } from "../../../packages/core/src/agent/admin-admission.js";
import {
  createAgentApprovalServiceV1,
  type NpAgentApprovalServiceV1,
} from "../../../packages/core/src/agent/approval-service.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import {
  createAgentModerationServiceV1,
  type NpAgentModerationServiceOptionsV1,
} from "../../../packages/core/src/agent/moderation-service.js";
import {
  createAgentModerationCapabilityFacadeV1,
  type NpAgentModerationCapabilityFacadeV1,
} from "../../../packages/core/src/agent/moderation-capability.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import { createAgentRuntimeAdmissionV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeExecutorV1 } from "../../../packages/core/src/agent/runtime-executor.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { npInspectCommunityContentContainmentV1 } from "../../../packages/core/src/community/content-containment.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { npResolveAgentBudgetV1 } from "../../../packages/core/src/agent-contract/runtime-budget.js";
import {
  npAgentDisabledGatewaySettingsV1,
  type NpAgentJsonObject,
  type NpAgentJsonSchema,
  type NpAgentProviderInvokeOutcomeV1,
} from "../../../packages/core/src/agent-contract/types.js";
import {
  npAgentQuarantineInputSchemaV1,
  npAgentRestoreInputSchemaV1,
} from "../../../packages/core/src/agent-contract/moderator-contract.js";
import {
  npRequireAgentModerationCapabilityOutputV1,
  type NpAgentModerationCapabilityInvocationRequestV1,
} from "../../../packages/core/src/agent-contract/moderation-capability-contract.js";
import { npAgentActions, npAgentIncidents } from "../../../packages/core/src/db/schema/agent.js";
import { npComments, npMembers } from "../../../packages/core/src/db/schema/community.js";
import { discussionsTable } from "../../../packages/core/src/integration/fixtures.js";
import { runtimeUsageFixture, usageInstruction } from "./agent-runtime-usage-fixture.js";
import {
  runtimeDefinition,
  runtimeRecipes,
  runtimeBudget,
  runtimeFingerprint,
  siteId,
} from "./agent-runtime-service-fixture.js";

function providerOutcome(decision: NpAgentJsonObject): NpAgentProviderInvokeOutcomeV1 {
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
const proposalSchema = (capabilityId: string, args: NpAgentJsonSchema): NpAgentJsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", const: "propose-capability", maxLength: 64 },
    capabilityId: { type: "string", const: capabilityId, maxLength: 128 },
    rationale: { type: "string", maxLength: 128 },
    arguments: args,
  },
  required: ["arguments", "capabilityId", "kind", "rationale"],
});
const responseSchema: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    task: { type: "string", const: "interactive-capability", maxLength: 64 },
    decision: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", const: "complete", maxLength: 64 },
            summary: { type: "string", maxLength: 128 },
          },
          required: ["kind", "summary"],
        },
        proposalSchema("moderation.quarantine", npAgentQuarantineInputSchemaV1()),
        proposalSchema("moderation.restore", npAgentRestoreInputSchemaV1()),
      ],
    },
  },
  required: ["decision", "task"],
};

/** Real Runtime, signed human approval and community owners; inference stays local. */
export async function moderationRuntimeFixture(options: { runtimeTargetLimit?: number } = {}) {
  const definition = runtimeDefinition();
  definition.template = "moderator";
  definition.autonomy = "approved";
  definition.scopes = ["moderation:execute", "site:read"];
  definition.capabilityModes = [
    { capabilityId: "moderation.quarantine", mode: "approved" },
    { capabilityId: "moderation.restore", mode: "approved" },
  ];
  const recipe = runtimeRecipes().recipes[0]!;
  recipe.allowedTemplates = ["moderator"];
  recipe.providerMode = "required";
  recipe.capabilityIds = definition.capabilityModes.map((entry) => entry.capabilityId);
  recipe.responseSchema = responseSchema;
  recipe.instruction = {
    templateId: "runtime.fixture",
    templateVersion: 1,
    digest: `cj1:sha256:${createHash("sha256").update(usageInstruction).digest("base64url")}`,
    text: usageInstruction,
  };
  const providerInvoke = vi.fn<NpAgentProviderInferenceFacetV1["invoke"]>(async () =>
    providerOutcome({ kind: "complete", summary: "Reviewed containment completed." }),
  );
  const budget = runtimeBudget({
    inputTokensPerRun: 20_000,
    inputTokensPerDay: 100_000,
    inputTokensPerMonth: 100_000,
    outputTokensPerRun: 1_000,
    outputTokensPerDay: 100_000,
    outputTokensPerMonth: 100_000,
    costMicrosPerDay: 1_000_000,
    costMicrosPerMonth: 1_000_000,
  });
  const runtime = await runtimeUsageFixture({
    delegated: true,
    definition,
    recipe,
    responseSchema,
    budget,
    dataClassCeiling: "sensitive-approved",
    providerInference: { invoke: providerInvoke },
    limits: {
      maxAttempts: 8,
      maxCapabilityCalls: 4,
      maxInputTokens: 20_000,
      maxOutputTokens: 1_000,
      maxCostMicros: 100_000,
      maxWallClockSeconds: 3600,
    },
  });
  const rules = runtime.runtimeOptions.frameworkPolicy.rules;
  rules.resources.collections = ["discussions"];
  rules.resources.incidentCategories = ["spam"];
  rules.risk.requirePreviewAtOrAbove = null;
  rules.automation.moderationTargetsPerRun = options.runtimeTargetLimit ?? 1;
  const hostRules = structuredClone(rules);
  hostRules.automation.moderationTargetsPerRun = 1;
  await npWithAgentRuntimeControlTransactionV1(siteId, ({ db, revision, settings }) => {
    settings.defaultPolicyRules = structuredClone(rules);
    return runtime.controls.updateInTransaction({
      db,
      siteId,
      expectedRevision: revision,
      actorFingerprint: runtimeFingerprint,
      settings,
    });
  });
  const admission = createAgentRuntimeAdmissionV1({
    ...runtime.runtimeOptions,
    runLimits: runtime.limits,
  });
  const registry = await createAgentReadCapabilityRegistryV1(
    createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "moderation-runtime", key: new Uint8Array(32).fill(51) },
      resolveBlockSchemas: () => [],
      resolveUser: () => runtime.actor.actor.user,
    }),
  );
  let facade: NpAgentModerationCapabilityFacadeV1 | null = null;
  let approvals: NpAgentApprovalServiceV1 | null = null;
  const capabilities = createAgentCapabilityAdmissionServiceV1({
    registry,
    runtimeAdmission: admission,
    resolveModerationCapabilities: () => facade,
    resolveGatewaySettings: () => npAgentDisabledGatewaySettingsV1,
    now: runtime.options.now,
  });
  const incidents = createAgentIncidentWriteServiceV1({
    resolveEvidence: () => false,
    now: runtime.options.now,
  });
  let failTimeline = false;
  const serviceOptions: NpAgentModerationServiceOptionsV1 = {
    admission: capabilities,
    resolveApprovals: () => {
      if (!approvals) throw new Error("Approval owner missing");
      return approvals;
    },
    resolveTransportAudience: async () => "https://unused.example",
    resolveBudget: async () => npResolveAgentBudgetV1(budget),
    resolvePolicy: async () => ({
      autonomy: "approved",
      capabilityModes: definition.capabilityModes,
      layers: [hostRules],
    }),
    canReadIncident: async () => true,
    incidents: {
      appendContainmentEvent: async (input) => {
        if (failTimeline) throw new Error("Fixture timeline persistence unavailable");
        return incidents.appendContainmentEvent(input);
      },
    },
    now: runtime.options.now,
  };
  const service = createAgentModerationServiceV1({
    ...serviceOptions,
    runtimeAdmission: admission,
  });
  const withoutRuntimeOwner = createAgentCapabilityAdmissionServiceV1({
    registry,
    runtimeAdmission: admission,
    resolveModerationCapabilities: () =>
      createAgentModerationCapabilityFacadeV1(createAgentModerationServiceV1(serviceOptions)),
    resolveGatewaySettings: () => npAgentDisabledGatewaySettingsV1,
    now: runtime.options.now,
  });
  facade = createAgentModerationCapabilityFacadeV1(service);
  approvals = createAgentApprovalServiceV1({
    targets: service.approvalTargets,
    cursorKey: new Uint8Array(32).fill(52),
    integrityKeys: {
      active: {
        owner: "approval-integrity",
        id: "moderation-runtime-integrity",
        bytes: new Uint8Array(32).fill(53),
      },
    },
    challengeKeys: {
      active: { id: "moderation-runtime-challenge", key: new Uint8Array(32).fill(54) },
    },
    secretRequestDigestKey: { id: "moderation-runtime-request", key: new Uint8Array(32).fill(55) },
    reauthentication: {
      verify: () => ({
        reauthenticatedAt: runtime.options.now().toISOString(),
        sessionFactFingerprint: runtimeFingerprint,
      }),
    },
    now: runtime.options.now,
  });
  const store = createAgentRuntimeExecutionStoreV1({
    admission,
    leaseSeconds: 10,
    approval: capabilities,
    now: runtime.options.now,
  });
  const context = createAgentRuntimeContextV1({
    admission: admission,
    capabilities: {
      list: capabilities.sourceEntries,
      actionOutcomes: capabilities.runtimeActionOutcomes,
    },
  });
  const usage = createAgentRuntimeUsageV1({
    admission: admission,
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
  const executors: ReturnType<typeof createAgentRuntimeExecutorV1>[] = [];
  const createExecutor = () => {
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
    executors.push(executor);
    return executor;
  };
  const executor = createExecutor();
  const [member] = await runtime.db
    .insert(npMembers)
    .values({
      email: `${randomUUID()}@example.com`,
      handle: `mod-${randomUUID()}`,
      displayName: "Runtime moderation",
      status: "active",
    })
    .returning();
  const [document] = await runtime.db
    .insert(discussionsTable)
    .values({
      siteId,
      title: "Observed discussion",
      slug: `moderation-${randomUUID()}`,
      body: npCreateEmptyRichTextContent(),
      status: "published",
      memberAuthorId: member.id,
    })
    .returning();
  const [comment] = await runtime.db
    .insert(npComments)
    .values({
      siteId,
      targetType: "discussions",
      targetId: document.id,
      memberId: member.id,
      bodyMd: "Private original pending content",
      bodyHtml: "<p>Private original pending content</p>",
      status: "pending",
    })
    .returning();
  const [incident] = await runtime.db
    .insert(npAgentIncidents)
    .values({
      siteId,
      category: "spam",
      status: "open",
      severity: "medium",
      fingerprint: `moderation-${randomUUID()}`,
      title: "Reviewed repeated links",
      summary: "Bounded evidence",
      primarySubject: {
        kind: "comment",
        commentId: comment.id,
        collection: "discussions",
        documentId: document.id,
      },
      firstObservedAt: runtime.options.now(),
      lastObservedAt: runtime.options.now(),
    })
    .returning();
  const target = { kind: "comment" as const, collection: "discussions", id: comment.id };
  const inspected = await withCurrentSite(siteId, () =>
    runtime.db.transaction((tx) =>
      npInspectCommunityContentContainmentV1(tx, {
        siteId,
        target,
        user: runtime.actor.actor.user,
      }),
    ),
  );
  const quarantine: NpAgentModerationCapabilityInvocationRequestV1 = {
    schemaVersion: "np.agent-invocation-request.v1",
    capabilityId: "moderation.quarantine",
    arguments: {
      idempotencyKey: randomUUID(),
      input: {
        mode: "propose",
        proposal: {
          incidentId: incident.id,
          target,
          expectedVersionDigest: inspected.versionDigest,
          reasonCode: "REPEATED_LINK_SPAM",
        },
      },
    },
  };
  const approvalOwner = approvals;
  return {
    ...runtime,
    admission,
    service,
    capabilities,
    withoutRuntimeOwner,
    facade,
    approvals: approvalOwner,
    store,
    context,
    executor,
    createExecutor,
    providerInvoke,
    comment,
    incident,
    quarantine,
    rules: hostRules,
    budget,
    failTimeline(value: boolean) {
      failTimeline = value;
    },
    async queue(request = quarantine) {
      providerInvoke.mockResolvedValueOnce(
        providerOutcome({
          kind: "propose-capability",
          capabilityId: request.capabilityId,
          rationale: "Request human-reviewed containment.",
          arguments: request.arguments.input as unknown as NpAgentJsonObject,
        }),
      );
      const admitted = await admission.admit({
        ...runtime.runInput,
        idempotencyKey: randomUUID(),
      });
      return { siteId, runId: admitted.runId };
    },
    async pending(runId: string) {
      const [action] = await runtime.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.runId, runId));
      if (
        !action ||
        (action.capabilityId !== "moderation.quarantine" &&
          action.capabilityId !== "moderation.restore")
      )
        throw new Error("Expected moderation action");
      const output = npRequireAgentModerationCapabilityOutputV1(
        action.capabilityId,
        action.outputRedacted,
      );
      if (output.state !== "approval_required") throw new Error("Expected pending approval");
      return { action, output };
    },
    async decide(
      approvalId: string,
      decision: "approve" | "reject" | "revoke" = "approve",
      actor: NpAgentAdminActorV1 = runtime.actor.actor,
    ) {
      const identity = { siteId, actor, id: approvalId };
      const detail = await approvalOwner.get(identity);
      const challenge = await approvalOwner.issueChallenge({
        ...identity,
        command: {
          schemaVersion: "np.agent-approval-challenge-request.v1",
          purpose: decision,
          expectedApprovalVersion: detail.item.version,
          statementHash: detail.item.statementHash,
          idempotencyKey: randomUUID(),
        },
      });
      return approvalOwner.decide({
        ...identity,
        decision,
        command: {
          schemaVersion: "np.agent-approval-decision-input.v1",
          expectedApprovalVersion: challenge.approvalVersion,
          statementHash: detail.item.statementHash,
          challengeGeneration: challenge.challengeGeneration,
          challenge: challenge.challenge,
          idempotencyKey: randomUUID(),
          reason: "Reviewed exact target and version",
        },
      });
    },
    async dispose() {
      for (const item of executors) item.shutdown();
      context.dispose();
      await provider.shutdown();
      await runtime.dispose();
    },
  };
}
