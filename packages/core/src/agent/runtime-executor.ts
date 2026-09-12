import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import {
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { npAgentActions, npAgentProviderCalls } from "../db/schema/agent.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npAgentProviderRetryableErrorClassesV1,
  npDigestAgentProviderRequestCanonical,
} from "../agent-contract/canonical-provider.js";
import { npRequireAgentInstalledCapabilityInvocationRequestV1 } from "../agent-contract/installed-capability-contract.js";
import { npAgentReadCapabilityIdsV1 } from "../agent-contract/read-capability-contract.js";
import type { NpAgentEvidenceRequest } from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import type { NpAgentCapabilityAdmissionServiceV1 } from "./capability-admission.js";
import type { NpAgentRuntimeExecutionClaimV1 } from "./runtime-admission.js";
import type { NpAgentRuntimeExecutionStoreV1 } from "./runtime-execution-store.js";
import type { NpAgentRuntimeContextV1 } from "./runtime-context.js";
import type { NpAgentRuntimeUsageV1 } from "./runtime-usage.js";
import type { NpAgentRuntimeBreakersV1 } from "./runtime-breakers.js";
import type { NpAgentProviderInferenceRuntimeV1 } from "./provider-inference.js";
import {
  npParseAgentStoredProviderConnectionConfigV1,
  type NpAgentConnectionAuthAdapterRegistryV1,
} from "./provider-auth-contract.js";
import type { NpAgentVaultServiceV1 } from "./vault-service.js";
import {
  npRequireAgentRuntimeProviderDecisionV1,
  npRequireAgentRuntimeProviderFailureV1,
} from "./runtime-provider-evidence.js";

type Identity = { siteId: string; runId: string };
type Call = typeof npAgentProviderCalls.$inferSelect;
export interface NpAgentRuntimeExecutorOptionsV1 {
  store: NpAgentRuntimeExecutionStoreV1;
  context: NpAgentRuntimeContextV1;
  usage: NpAgentRuntimeUsageV1;
  provider: NpAgentProviderInferenceRuntimeV1;
  providerRegistry: NpAgentConnectionAuthAdapterRegistryV1;
  vault: Pick<NpAgentVaultServiceV1, "leaseProviderCredential">;
  capabilities: NpAgentCapabilityAdmissionServiceV1;
  breakers: NpAgentRuntimeBreakersV1;
  now?: () => Date;
}
function fail(code: string): never {
  throw new NpAgentGatewayError(code, 409, "Agent runtime execution is unavailable.");
}
function identity(value: Identity): Identity {
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, "runtime.executor", 4096),
    "runtime.executor",
    ["siteId", "runId"],
    ["siteId", "runId"],
    { seen: new WeakSet<object>() },
  );
  return {
    siteId: canonicalBodySiteId(row.siteId, "runtime.executor.siteId"),
    runId: canonicalBodyUuid(row.runId, "runtime.executor.runId"),
  };
}
function key(runId: string, sequence: number, purpose: string): string {
  return `runtime:${purpose}:${createHash("sha256").update(runId).update(":").update(String(sequence)).digest("hex")}`;
}

/** Host-invoked processing only. No queue, listener, provider or service is installed implicitly. */
export function createAgentRuntimeExecutorV1(options: NpAgentRuntimeExecutorOptionsV1) {
  const now = options.now ?? (() => new Date());
  const active = new Map<string, AbortController>();
  let closed = false;

  async function releaseUnsent(
    call: Pick<
      Call,
      "id" | "siteId" | "runId" | "state" | "dispatchState" | "provider" | "model" | "requestDigest"
    >,
  ) {
    if (call.state !== "reserved" || call.dispatchState !== "not-dispatched")
      fail("RUNTIME_PROVIDER_UNRESOLVED");
    // The durable pre-dispatch fence proves this call was never sent. No prompt is reconstructed.
    await options.usage.reconcile({
      siteId: call.siteId,
      providerCallId: call.id,
      requireUnsent: true,
      response: {
        schemaVersion: "np.agent-provider-response.v1",
        siteId: call.siteId,
        providerCallId: call.id,
        runId: call.runId,
        requestDigest: call.requestDigest,
        dispatchState: "not-dispatched",
        outcome: {
          schemaVersion: "np.agent-provider-invoke-outcome.v1",
          status: "failed",
          provider: call.provider,
          model: call.model,
          providerRequestId: null,
          output: null,
          errorClass: "cancelled",
          safeCode: "RUNTIME_UNSENT_RECOVERED",
          retryable: false,
          dispatchState: "not-dispatched",
          usage: null,
          finishReason: null,
          latencyMs: 0,
        },
        decision: null,
        observedAt: now().toISOString(),
      },
    });
  }

  async function processRun(
    identity: Identity,
    initialClaim: NpAgentRuntimeExecutionClaimV1,
    signal: AbortSignal,
  ) {
    let claim = initialClaim;
    // The canonical Run maximum is authoritative; this separate loop bound also contains corrupted journals.
    try {
      for (let step = 0; step < 1000; step++) {
        if (closed || signal.aborted) return options.store.cancel(identity);
        claim = await options.store.renew({ ...identity, claim });
        const claimed = { ...identity, claim };
        const history = await options.store.withClaim(claimed, async (context) => {
          const calls = await context.db
            .select()
            .from(npAgentProviderCalls)
            .where(
              and(
                eq(npAgentProviderCalls.siteId, identity.siteId),
                eq(npAgentProviderCalls.runId, identity.runId),
              ),
            )
            .orderBy(asc(npAgentProviderCalls.sequence))
            .limit(1001);
          if (
            calls.length > context.limits.maxProviderCalls ||
            calls.length > 1000 ||
            calls.some((call, index) => call.sequence !== index + 1)
          )
            fail("RUNTIME_PROVIDER_EVIDENCE_INVALID");
          for (const call of calls)
            if (["failed", "cancelled"].includes(call.state))
              await npRequireAgentRuntimeProviderFailureV1({ db: context.db, call });
          return { calls, limits: context.limits };
        });
        const latest = history.calls.at(-1);
        if (latest && ["in_flight", "ambiguous"].includes(latest.state))
          return options.store.transition({
            ...claimed,
            state: "failed",
            errorCode: "RUNTIME_PROVIDER_UNRESOLVED",
          });
        if (latest?.state === "reserved") {
          await releaseUnsent(latest);
          return options.store.transition({
            ...claimed,
            state: "failed",
            errorCode: "RUNTIME_PROVIDER_SOURCE_LOST",
          });
        }
        if (latest?.state === "cancelled") fail("RUNTIME_PROVIDER_CANCELLED");
        const evidence: NpAgentEvidenceRequest[] = [];
        const requests = new Set<string>();
        for (const call of history.calls) {
          if (call.state !== "succeeded") continue;
          const output = await npRequireAgentRuntimeProviderDecisionV1(call);
          if (output.task !== "interactive-capability")
            fail("RUNTIME_TARGET_ADMISSION_UNAVAILABLE");
          if (output.decision.kind === "request-evidence") {
            const fingerprint = serializeAgentCanonicalJson(output.decision.resource);
            if (requests.has(fingerprint)) fail("RUNTIME_REPEATED_EVIDENCE");
            requests.add(fingerprint);
            evidence.push(output.decision.resource);
          }
        }
        if (evidence.length > 32) fail("RUNTIME_EVIDENCE_LIMIT");
        if (latest?.state === "succeeded") {
          const output = await npRequireAgentRuntimeProviderDecisionV1(latest);
          if (output.task !== "interactive-capability")
            fail("RUNTIME_TARGET_ADMISSION_UNAVAILABLE");
          const decision = output.decision;
          if (decision.kind === "complete")
            return options.store.transition({ ...claimed, state: "succeeded" });
          if (decision.kind === "propose-capability") {
            const proposal = serializeAgentCanonicalJson({
              capabilityId: decision.capabilityId,
              arguments: decision.arguments,
            });
            for (const prior of history.calls.slice(0, -1)) {
              if (prior.state !== "succeeded") continue;
              const previous = await npRequireAgentRuntimeProviderDecisionV1(prior);
              if (
                previous.task === "interactive-capability" &&
                previous.decision.kind === "propose-capability" &&
                serializeAgentCanonicalJson({
                  capabilityId: previous.decision.capabilityId,
                  arguments: previous.decision.arguments,
                }) === proposal
              )
                fail("RUNTIME_REPEATED_PROPOSAL");
            }
            const request = npRequireAgentInstalledCapabilityInvocationRequestV1({
              schemaVersion: "np.agent-invocation-request.v1",
              capabilityId: decision.capabilityId,
              arguments: {
                input: decision.arguments,
                idempotencyKey: npAgentReadCapabilityIdsV1.some(
                  (id) => id === decision.capabilityId,
                )
                  ? null
                  : key(identity.runId, latest.sequence, "action"),
              },
            });
            await options.capabilities.invokeRuntime({
              ...claimed,
              sequence: latest.sequence,
              request,
              abortSignal: signal,
            });
            const pending = await options.store.withClaim(claimed, async ({ db }) =>
              db
                .select({ state: npAgentActions.state })
                .from(npAgentActions)
                .where(
                  and(
                    eq(npAgentActions.siteId, identity.siteId),
                    eq(npAgentActions.runId, identity.runId),
                    eq(npAgentActions.sequence, latest.sequence),
                  ),
                )
                .limit(1),
            );
            if (pending.some((action) => ["approval_pending", "approved"].includes(action.state)))
              return options.store.transition({ ...claimed, state: "waiting_approval" });
            if (pending.length !== 1 || !["succeeded", "compensated"].includes(pending[0].state))
              fail("RUNTIME_ACTION_UNRESOLVED");
          }
        }
        let retryOfId: string | null = null;
        if (latest?.state === "failed") {
          if (
            !latest.retryable ||
            !latest.finishedAt ||
            !npAgentProviderRetryableErrorClassesV1.some((value) => value === latest.errorClass)
          )
            fail("RUNTIME_PROVIDER_FAILED");
          if (
            latest.errorClass === "invalid-output" &&
            history.calls.filter((call) => call.errorClass === "invalid-output").length > 1
          )
            fail("RUNTIME_PROVIDER_REPAIR_EXHAUSTED");
          let failures = 0;
          for (const call of [...history.calls].reverse()) {
            if (call.state !== "failed" || !call.retryable) break;
            failures++;
          }
          const retryAt = new Date(
            latest.finishedAt.getTime() + Math.min(300, 2 ** Math.min(failures, 8)) * 1000,
          );
          if (retryAt > now())
            return options.store.waitRetry({ ...claimed, retryAt: retryAt.toISOString() });
          retryOfId = latest.id;
        }
        if (history.calls.length >= history.limits.maxProviderCalls)
          fail("RUNTIME_PROVIDER_CALL_LIMIT");
        const sequence = (latest?.sequence ?? 0) + 1;
        const request = await options.context.prepare({
          ...claimed,
          providerCallId: randomUUID(),
          sequence,
          retryOfId,
          idempotencyKey: key(identity.runId, sequence, "provider"),
          evidence,
        });
        let dispatched = false;
        let reserved = false;
        try {
          await options.usage.reserve({ ...claimed, request });
          reserved = true;
          const parsed = await options.store.withClaim(claimed, async (context) => {
            if (!context.connection || !context.connectionSnapshot)
              fail("RUNTIME_PROVIDER_UNAVAILABLE");
            return npParseAgentStoredProviderConnectionConfigV1({
              registry: options.providerRegistry,
              connection: context.connection,
              snapshot: context.connectionSnapshot,
            });
          });
          const lease = await options.vault.leaseProviderCredential({
            siteId: identity.siteId,
            secretVersionId: request.connection.secretVersionId,
            use: "runtime",
          });
          try {
            if (closed || signal.aborted) fail("RUNTIME_CANCELLED");
            await options.usage.beginDispatch({ ...claimed, request });
            dispatched = true;
            const response = await options.provider.invoke({
              request,
              connection: parsed.parsed,
              credentialLease: lease,
              signal,
            });
            await options.usage.reconcile({
              siteId: identity.siteId,
              providerCallId: request.providerCallId,
              response,
            });
            await options.breakers.observeCall({
              siteId: identity.siteId,
              providerCallId: request.providerCallId,
            });
          } finally {
            lease.dispose();
          }
        } catch (error) {
          if (reserved && !dispatched) {
            await releaseUnsent({
              id: request.providerCallId,
              siteId: request.siteId,
              runId: request.runId,
              state: "reserved",
              dispatchState: "not-dispatched",
              provider: request.provider,
              model: request.model,
              requestDigest: await npDigestAgentProviderRequestCanonical(request),
            });
          }
          throw error;
        } finally {
          options.context.forget(request.providerCallId);
          // Once dispatched, a missing result remains unknown and cannot be retried.
          if (dispatched && signal.aborted) await options.store.cancel(identity);
        }
      }
      fail("RUNTIME_STEP_LIMIT");
    } catch (error) {
      const code = error instanceof NpAgentGatewayError ? error.code : "RUNTIME_EXECUTION_FAILED";
      const state = /BUDGET|CALL_LIMIT|EVIDENCE_LIMIT/.test(code)
        ? "budget_blocked"
        : /POLICY|ADMISSION_DENIED|REPEATED|STEP_LIMIT|INPUT_UNAVAILABLE/.test(code)
          ? "policy_blocked"
          : "failed";
      try {
        return await options.store.transition({ ...identity, claim, state, errorCode: code });
      } catch {
        throw new NpAgentGatewayError(code, 409, "Agent runtime execution is unavailable.");
      }
    }
  }

  return {
    async process(input: Identity): Promise<{ state: string }> {
      npAssertAgentPreviewEffectsAllowed();
      input = identity(input);
      if (closed) fail("RUNTIME_EXECUTOR_CLOSED");
      const acquired = await options.store.claim(input);
      if (!acquired.claim) return { state: acquired.state };
      const controller = new AbortController();
      const processKey = `${input.siteId}:${input.runId}`;
      active.set(processKey, controller);
      try {
        const result = await processRun(input, acquired.claim, controller.signal);
        if (
          ["succeeded", "failed", "cancelled", "policy_blocked", "budget_blocked"].includes(
            result.state,
          )
        )
          await options.breakers.observeRun(input);
        return result;
      } finally {
        if (active.get(processKey) === controller) active.delete(processKey);
      }
    },
    async cancel(input: Identity) {
      npAssertAgentPreviewEffectsAllowed();
      input = identity(input);
      active.get(`${input.siteId}:${input.runId}`)?.abort();
      return options.store.cancel(input);
    },
    recover: (input: Identity) => options.store.recover(input),
    shutdown() {
      npAssertAgentPreviewEffectsAllowed();
      closed = true;
      for (const controller of active.values()) controller.abort();
    },
  };
}
export type NpAgentRuntimeExecutorV1 = ReturnType<typeof createAgentRuntimeExecutorV1>;
