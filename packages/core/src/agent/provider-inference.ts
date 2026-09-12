import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import {
  npRequireAgentProviderRequestCanonical,
  npRequireAgentProviderResponseCanonical,
  npDigestAgentProviderRequestCanonical,
} from "../agent-contract/canonical-provider.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npComputeAgentModelCostMicrosV1 } from "../agent-contract/runtime-budget.js";
import type {
  NpAgentProviderInvokeOutcomeV1,
  NpAgentProviderRequestCanonicalV1,
  NpAgentProviderResponseCanonicalV1,
} from "../agent-contract/types.js";
import {
  NpAgentProviderError,
  npRequireAgentProviderSchemaValueV1,
  type NpAgentConnectionAuthAdapterRegistryV1,
  type NpAgentParsedConnectionConfigV1,
  type NpAgentProviderInferenceRequestV1,
} from "./provider-auth-contract.js";
import type { NpProviderCredentialLeaseV1 } from "./vault-contract.js";

export interface NpAgentProviderInferenceRuntimeV1 {
  invoke(input: {
    request: NpAgentProviderRequestCanonicalV1;
    connection: NpAgentParsedConnectionConfigV1;
    credentialLease: NpProviderCredentialLeaseV1;
    signal?: AbortSignal;
  }): Promise<NpAgentProviderResponseCanonicalV1>;
  shutdown(): Promise<{ status: "closed" | "degraded"; safeCodes: string[] }>;
}

function project(request: NpAgentProviderRequestCanonicalV1): NpAgentProviderInferenceRequestV1 {
  const {
    schemaVersion,
    runId,
    provider,
    model,
    recipe,
    task,
    instruction,
    trustedContext,
    untrustedEvidence,
    responseSchema,
    responseSchemaDigest,
    responseSchemaClassification,
    tools,
    limits,
    pricing,
    dataClass,
    dataClassCeiling,
  } = request;
  return structuredClone({
    schemaVersion,
    runId,
    provider,
    model,
    recipe,
    task,
    instruction,
    trustedContext,
    untrustedEvidence,
    responseSchema,
    responseSchemaDigest,
    responseSchemaClassification,
    tools,
    limits,
    pricing,
    dataClass,
    dataClassCeiling,
  });
}

/** Explicit worker-owned dispatch only. Admission and durable dispatch fencing precede this call. */
export function createAgentProviderInferenceRuntimeV1(options: {
  registry: NpAgentConnectionAuthAdapterRegistryV1;
  drainMilliseconds?: number;
  now?: () => Date;
}): NpAgentProviderInferenceRuntimeV1 {
  const now = options.now ?? (() => new Date());
  const drain = options.drainMilliseconds ?? 5_000;
  if (!Number.isSafeInteger(drain) || drain < 1 || drain > 60_000)
    throw new NpAgentProviderError("PROVIDER_CONTRACT_INVALID", "Invalid provider drain deadline.");
  let closed = false;
  let shutdownResult: ReturnType<NpAgentProviderInferenceRuntimeV1["shutdown"]> | undefined;
  const active = new Set<{ controller: AbortController; settled: Promise<void> }>();
  const installed = options.registry.list();

  async function invoke(input: Parameters<NpAgentProviderInferenceRuntimeV1["invoke"]>[0]) {
    npAssertAgentPreviewEffectsAllowed();
    const started = Date.now();
    let request: NpAgentProviderRequestCanonicalV1;
    try {
      request = npRequireAgentProviderRequestCanonical(input.request);
    } catch {
      input.credentialLease.dispose();
      throw new NpAgentProviderError(
        "PROVIDER_REQUEST_INVALID",
        "The provider request is invalid.",
      );
    }
    const requestDigest = await npDigestAgentProviderRequestCanonical(request);
    const latencyMs = () => Math.max(0, Date.now() - started);
    const response = (outcome: NpAgentProviderInvokeOutcomeV1) =>
      npRequireAgentProviderResponseCanonical({
        schemaVersion: "np.agent-provider-response.v1",
        siteId: request.siteId,
        providerCallId: request.providerCallId,
        runId: request.runId,
        requestDigest,
        dispatchState:
          outcome.status === "succeeded"
            ? "dispatched"
            : outcome.status === "ambiguous"
              ? "unknown"
              : outcome.dispatchState,
        outcome,
        decision: outcome.status === "succeeded" ? structuredClone(outcome.output) : null,
        observedAt: now().toISOString(),
      });
    const unknown = () =>
      response({
        schemaVersion: "np.agent-provider-invoke-outcome.v1",
        status: "ambiguous",
        provider: request.provider,
        model: request.model,
        providerRequestId: null,
        output: null,
        errorClass: "unknown",
        safeCode: "PROVIDER_OUTCOME_UNKNOWN",
        retryable: false,
        dispatchState: "unknown",
        usage: null,
        finishReason: null,
        latencyMs: latencyMs(),
      });
    const unavailable = () =>
      response({
        schemaVersion: "np.agent-provider-invoke-outcome.v1",
        status: "failed",
        provider: request.provider,
        model: request.model,
        providerRequestId: null,
        output: null,
        errorClass: "invalid-request",
        safeCode: "PROVIDER_UNAVAILABLE",
        retryable: false,
        dispatchState: "not-dispatched",
        usage: null,
        finishReason: null,
        latencyMs: latencyMs(),
      });
    let dispatched = false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settle!: () => void;
    const entry = {
      controller,
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    try {
      const connection = structuredClone(input.connection);
      const adapter = options.registry.resolve({
        id: request.connection.adapterId,
        contractVersion: request.connection.adapterContractVersion,
        fingerprint: request.connection.adapterFingerprint,
      });
      if (
        closed ||
        input.signal?.aborted ||
        !adapter.inference ||
        !installed.includes(adapter) ||
        connection.connectionId !== request.connection.id ||
        connection.configVersion !== request.connection.configVersion ||
        connection.configHash !== request.connection.configHash ||
        connection.adapterId !== adapter.id ||
        connection.adapterContractVersion !== adapter.contractVersion ||
        connection.adapterFingerprint !== adapter.fingerprint ||
        !connection.pricingCatalog.some(
          (pricing) =>
            serializeAgentCanonicalJson(pricing) === serializeAgentCanonicalJson(request.pricing),
        ) ||
        input.credentialLease.secretVersionId !== request.connection.secretVersionId ||
        input.credentialLease.envelopeVersion !== 1 ||
        new Date(input.credentialLease.expiresAt).getTime() <= now().getTime() ||
        !Number.isFinite(new Date(input.credentialLease.expiresAt).getTime())
      )
        return unavailable();
      active.add(entry);
      input.signal?.addEventListener("abort", abort, { once: true });
      const interrupted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("Provider interrupted")),
          { once: true },
        );
        timer = setTimeout(
          abort,
          Math.min(
            request.limits.timeoutSeconds * 1_000,
            new Date(input.credentialLease.expiresAt).getTime() - now().getTime(),
          ),
        );
      });
      const raw = await Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new Error("Provider interrupted");
          dispatched = true;
          return adapter.inference!.invoke(project(request), {
            connection,
            credentialLease: input.credentialLease,
            signal: controller.signal,
          });
        }),
        interrupted,
      ]);
      if (controller.signal.aborted) return unknown();
      const parsed = response(raw);
      const outcome = parsed.outcome;
      if (outcome.provider !== request.provider || outcome.model !== request.model)
        return unknown();
      if (
        outcome.usage?.costSource === "adapter-estimate" &&
        outcome.usage.costMicros !==
          npComputeAgentModelCostMicrosV1({
            pricing: request.pricing,
            ...{
              inputTokens: outcome.usage.inputTokens,
              cachedInputTokens: outcome.usage.cachedInputTokens,
              outputTokens: outcome.usage.outputTokens,
            },
          })
      )
        return unknown();
      if (outcome.status === "succeeded") {
        if (parsed.decision?.task !== request.task) return unknown();
        npRequireAgentProviderSchemaValueV1(request.responseSchema, outcome.output);
        const decision = parsed.decision.decision;
        if (decision.kind === "propose-capability") {
          const tool = request.tools.find((item) => item.capabilityId === decision.capabilityId);
          if (!tool) return unknown();
          npRequireAgentProviderSchemaValueV1(tool.inputSchema, decision.arguments);
        }
      }
      return parsed;
    } catch {
      return dispatched ? unknown() : unavailable();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      try {
        input.credentialLease.dispose();
      } catch {
        /* No credential exception crosses the facade. */
      }
      active.delete(entry);
      settle();
    }
  }

  async function shutdown() {
    closed = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const codes = new Set<string>();
    await Promise.race([
      Promise.all([...active].map((entry) => entry.settled)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, drain);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    for (const entry of active) entry.controller.abort();
    await Promise.all([...active].map((entry) => entry.settled));
    await Promise.all(
      installed.map(async (adapter) => {
        if (!adapter.inference?.shutdown) return;
        let hookTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            Promise.resolve().then(() => adapter.inference!.shutdown!()),
            new Promise<never>((_, reject) => {
              hookTimer = setTimeout(() => reject(new Error("Provider shutdown deadline")), drain);
            }),
          ]);
          if (result !== undefined) codes.add("PROVIDER_SHUTDOWN_FAILED");
        } catch {
          codes.add("PROVIDER_SHUTDOWN_FAILED");
        } finally {
          if (hookTimer !== undefined) clearTimeout(hookTimer);
        }
      }),
    );
    return {
      status: codes.size ? ("degraded" as const) : ("closed" as const),
      safeCodes: [...codes].sort(),
    };
  }
  return {
    invoke,
    shutdown() {
      npAssertAgentPreviewEffectsAllowed();
      return (shutdownResult ??= shutdown());
    },
  };
}
