import { and, eq } from "drizzle-orm";
import { npAgentCircuitBreakers, npAgentProviderCalls, npAgentRuns } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { canonicalBodyRecord } from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import type { NpAgentRuntimeControlContextV1 } from "./runtime-controls.js";
import { npRequireAgentRuntimeExecutionIntegrityV1 } from "./runtime-execution-store.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { NpAgentGatewayError } from "./admin-admission.js";

type Breaker = typeof npAgentCircuitBreakers.$inferSelect;
export interface NpAgentRuntimeBreakerProbeV1 {
  breakerId: string;
  version: number;
  leaseUntil: string;
}
export interface NpAgentRuntimeBreakersV1 {
  observeRun(input: {
    siteId: string;
    runId: string;
  }): Promise<{ state: string; replayed: boolean }>;
  observeCall(input: {
    siteId: string;
    providerCallId: string;
  }): Promise<{ state: string; replayed: boolean }>;
  claimProbe(input: {
    siteId: string;
    connectionId: string;
  }): Promise<NpAgentRuntimeBreakerProbeV1 | null>;
  settleProbe(input: {
    siteId: string;
    probe: NpAgentRuntimeBreakerProbeV1;
    succeeded: boolean;
  }): Promise<{ state: string }>;
}
function fail(code = "RUNTIME_BREAKER_UNAVAILABLE"): never {
  throw new NpAgentGatewayError(code, 409, "Agent runtime breaker is unavailable.");
}
function uuid(value: string): void {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))
    fail();
}
function valid(row: Breaker): void {
  if (
    !Number.isSafeInteger(row.versionNumber) ||
    row.versionNumber < 1 ||
    !Number.isSafeInteger(row.failureCount) ||
    row.failureCount < 0 ||
    !["closed", "open", "half_open"].includes(row.state)
  )
    fail();
  if (
    row.state === "closed"
      ? row.openedAt !== null || row.retryAt !== null || row.probeLeaseUntil !== null
      : !row.reasonCode ||
        !row.openedAt ||
        (row.state === "open"
          ? !row.retryAt || row.probeLeaseUntil !== null
          : !row.probeLeaseUntil || row.retryAt !== null)
  )
    fail();
}
/** Explicit durable connection-breaker service. Probe callers may perform read-only health work only. */
export function createAgentRuntimeBreakersV1(options: {
  failureThreshold: number;
  windowSeconds: number;
  cooldownSeconds: number;
  probeSeconds?: number;
  now?: () => Date;
}): NpAgentRuntimeBreakersV1 {
  const probeSeconds = options.probeSeconds ?? 30;
  for (const [value, max] of [
    [options.failureThreshold, 1000],
    [options.windowSeconds, 86400],
    [options.cooldownSeconds, 86400],
    [probeSeconds, 90],
  ])
    if (!Number.isSafeInteger(value) || value < 1 || value > max) fail();
  const now = options.now ?? (() => new Date());
  const locked = <T, I extends { siteId: string }>(
    input: I,
    keys: string[],
    operation: (context: NpAgentRuntimeControlContextV1, input: I) => Promise<T>,
  ) => {
    npAssertAgentPreviewEffectsAllowed();
    try {
      input = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(input, "runtime.breaker", 8192),
        "runtime.breaker",
        keys,
        keys,
        { seen: new WeakSet() },
      ) as I;
    } catch {
      fail();
    }
    return npWithAgentRuntimeControlTransactionV1(input.siteId, (context) =>
      operation(context, input),
    );
  };
  return {
    observeRun: (input) =>
      locked(input, ["siteId", "runId"], async ({ db }, input) => {
        uuid(input.runId);
        const [run] = await db
          .select()
          .from(npAgentRuns)
          .where(and(eq(npAgentRuns.siteId, input.siteId), eq(npAgentRuns.id, input.runId)))
          .for("update")
          .limit(1);
        if (
          !run ||
          !["succeeded", "failed", "cancelled", "policy_blocked", "budget_blocked"].includes(
            run.state,
          ) ||
          !run.agentId ||
          !run.finishedAt
        )
          fail();
        await npRequireAgentRuntimeExecutionIntegrityV1(run);
        const [existing] = await db
          .select()
          .from(npAgentCircuitBreakers)
          .where(
            and(
              eq(npAgentCircuitBreakers.siteId, input.siteId),
              eq(npAgentCircuitBreakers.scopeKind, "agent"),
              eq(npAgentCircuitBreakers.scopeRef, run.agentId),
            ),
          )
          .for("update")
          .limit(1);
        if (existing) valid(existing);
        const receipts = await db
          .select({ id: npAuditEvents.id })
          .from(npAuditEvents)
          .where(
            and(
              eq(npAuditEvents.siteId, input.siteId),
              eq(npAuditEvents.action, "agent.runtime.breaker.observe-run"),
              eq(npAuditEvents.targetType, "agent-run"),
              eq(npAuditEvents.targetId, run.id),
            ),
          )
          .limit(2);
        const counted = run.state === "failed" || run.state === "policy_blocked";
        if (receipts.length > 1 || (receipts.length && counted && !existing)) fail();
        if (receipts.length) return { state: existing?.state ?? "closed", replayed: true };
        const at = now();
        if (
          !Number.isFinite(at.getTime()) ||
          at < run.finishedAt ||
          (existing && at < existing.updatedAt)
        )
          fail();
        let state = existing?.state ?? "closed";
        if (counted && state === "closed") {
          const withinWindow =
            existing &&
            at.getTime() - existing.windowStartedAt.getTime() < options.windowSeconds * 1000;
          const failureCount = (withinWindow ? existing.failureCount : 0) + 1;
          const integrity = [
            "RUNTIME_EXECUTION_INTEGRITY_INVALID",
            "RUNTIME_PROVIDER_EVIDENCE_INVALID",
            "RUNTIME_ADMISSION_INVALID",
            "RUNTIME_DEFINITION_INVALID",
          ].includes(run.errorCode ?? "");
          const immediate =
            integrity ||
            run.state === "policy_blocked" ||
            [
              "RUNTIME_REPEATED_PROPOSAL",
              "RUNTIME_REPEATED_EVIDENCE",
              "RUNTIME_STEP_LIMIT",
            ].includes(run.errorCode ?? "");
          state = immediate || failureCount >= options.failureThreshold ? "open" : "closed";
          const patch = {
            state,
            reasonCode:
              state === "open"
                ? integrity
                  ? "RUNTIME_INTEGRITY_BLOCKED"
                  : immediate
                    ? "RUNTIME_POLICY_LOOP"
                    : "RUNTIME_FAILURE_THRESHOLD"
                : null,
            failureCount,
            windowStartedAt: withinWindow ? existing.windowStartedAt : at,
            openedAt: state === "open" ? at : null,
            retryAt:
              state === "open" ? new Date(at.getTime() + options.cooldownSeconds * 1000) : null,
            probeLeaseUntil: null,
            versionNumber: (existing?.versionNumber ?? 0) + 1,
            updatedAt: at,
          };
          if (existing)
            await db
              .update(npAgentCircuitBreakers)
              .set(patch)
              .where(
                and(
                  eq(npAgentCircuitBreakers.siteId, input.siteId),
                  eq(npAgentCircuitBreakers.id, existing.id),
                  eq(npAgentCircuitBreakers.versionNumber, existing.versionNumber),
                ),
              );
          else
            await db.insert(npAgentCircuitBreakers).values({
              siteId: input.siteId,
              scopeKind: "agent",
              scopeRef: run.agentId,
              ...patch,
            });
          if (state === "open")
            await db.insert(npAuditEvents).values({
              siteId: input.siteId,
              actorKind: "system",
              action: "agent.policy.blocked",
              targetType: "agent-runtime",
              targetId: run.agentId,
              payload: { reasonCode: patch.reasonCode },
              createdAt: at,
            });
        }
        await db.insert(npAuditEvents).values({
          siteId: input.siteId,
          actorKind: "system",
          action: "agent.runtime.breaker.observe-run",
          targetType: "agent-run",
          targetId: run.id,
          payload: { state, admissionFingerprint: run.admissionFingerprint },
          createdAt: at,
        });
        return { state, replayed: false };
      }),
    observeCall: (input) =>
      locked(input, ["siteId", "providerCallId"], async ({ db }, input) => {
        uuid(input.providerCallId);
        const [call] = await db
          .select()
          .from(npAgentProviderCalls)
          .where(
            and(
              eq(npAgentProviderCalls.siteId, input.siteId),
              eq(npAgentProviderCalls.id, input.providerCallId),
            ),
          )
          .for("update")
          .limit(1);
        if (
          !call ||
          !["failed", "cancelled", "ambiguous", "succeeded"].includes(call.state) ||
          !call.responseDigest ||
          !call.finishedAt
        )
          fail();
        const [existing] = await db
          .select()
          .from(npAgentCircuitBreakers)
          .where(
            and(
              eq(npAgentCircuitBreakers.siteId, input.siteId),
              eq(npAgentCircuitBreakers.scopeKind, "connection"),
              eq(npAgentCircuitBreakers.scopeRef, call.connectionId),
            ),
          )
          .for("update")
          .limit(1);
        if (existing) valid(existing);
        const receipts = await db
          .select({ id: npAuditEvents.id })
          .from(npAuditEvents)
          .where(
            and(
              eq(npAuditEvents.siteId, input.siteId),
              eq(npAuditEvents.action, "agent.runtime.breaker.observe"),
              eq(npAuditEvents.targetType, "agent-provider-call"),
              eq(npAuditEvents.targetId, call.id),
            ),
          )
          .limit(2);
        if (receipts.length > 1) fail();
        if (
          receipts.length &&
          !existing &&
          call.state !== "succeeded" &&
          [
            "authentication",
            "rate-limited",
            "transient",
            "timeout",
            "invalid-output",
            "unknown",
          ].includes(call.errorClass ?? "")
        )
          fail();
        if (receipts.length) return { state: existing?.state ?? "closed", replayed: true };
        const at = now();
        if (
          !Number.isFinite(at.getTime()) ||
          at < call.finishedAt ||
          (existing && at < existing.updatedAt)
        )
          fail();
        const counted =
          call.state !== "succeeded" &&
          [
            "authentication",
            "rate-limited",
            "transient",
            "timeout",
            "invalid-output",
            "unknown",
          ].includes(call.errorClass ?? "");
        let state = existing?.state ?? "closed";
        if (counted && state === "closed") {
          const withinWindow =
            existing &&
            at.getTime() - existing.windowStartedAt.getTime() < options.windowSeconds * 1000;
          const failureCount = (withinWindow ? existing.failureCount : 0) + 1;
          const immediate = call.errorClass === "authentication";
          state = immediate || failureCount >= options.failureThreshold ? "open" : "closed";
          const patch = {
            state,
            reasonCode:
              state === "open"
                ? immediate
                  ? "PROVIDER_AUTHENTICATION"
                  : "PROVIDER_FAILURE_THRESHOLD"
                : null,
            failureCount,
            windowStartedAt: withinWindow ? existing.windowStartedAt : at,
            openedAt: state === "open" ? at : null,
            retryAt:
              state === "open" ? new Date(at.getTime() + options.cooldownSeconds * 1000) : null,
            probeLeaseUntil: null,
            versionNumber: (existing?.versionNumber ?? 0) + 1,
            updatedAt: at,
          };
          if (existing)
            await db
              .update(npAgentCircuitBreakers)
              .set(patch)
              .where(
                and(
                  eq(npAgentCircuitBreakers.id, existing.id),
                  eq(npAgentCircuitBreakers.siteId, input.siteId),
                  eq(npAgentCircuitBreakers.versionNumber, existing.versionNumber),
                ),
              );
          else
            await db.insert(npAgentCircuitBreakers).values({
              siteId: input.siteId,
              scopeKind: "connection",
              scopeRef: call.connectionId,
              ...patch,
            });
        }
        await db.insert(npAuditEvents).values({
          siteId: input.siteId,
          actorKind: "system",
          action: "agent.runtime.breaker.observe",
          targetType: "agent-provider-call",
          targetId: call.id,
          payload: { state, responseDigest: call.responseDigest },
          createdAt: at,
        });
        if (state === "open" && existing?.state !== "open")
          await db.insert(npAuditEvents).values({
            siteId: input.siteId,
            actorKind: "system",
            action: "agent.policy.blocked",
            targetType: "agent-connection",
            targetId: call.connectionId,
            payload: {
              reasonCode:
                call.errorClass === "authentication"
                  ? "PROVIDER_AUTHENTICATION"
                  : "PROVIDER_FAILURE_THRESHOLD",
            },
            createdAt: at,
          });
        return { state, replayed: false };
      }),
    claimProbe: (input) =>
      locked(input, ["siteId", "connectionId"], async ({ db }, input) => {
        uuid(input.connectionId);
        const [row] = await db
          .select()
          .from(npAgentCircuitBreakers)
          .where(
            and(
              eq(npAgentCircuitBreakers.siteId, input.siteId),
              eq(npAgentCircuitBreakers.scopeKind, "connection"),
              eq(npAgentCircuitBreakers.scopeRef, input.connectionId),
            ),
          )
          .for("update")
          .limit(1);
        if (!row) return null;
        valid(row);
        const at = now();
        if (!Number.isFinite(at.getTime()) || at < row.updatedAt) fail();
        if (
          row.state === "closed" ||
          row.reasonCode === "PROVIDER_AUTHENTICATION" ||
          row.reasonCode?.includes("POLICY") ||
          (row.state === "open" && row.retryAt! > at) ||
          (row.state === "half_open" && row.probeLeaseUntil! > at)
        )
          return null;
        const leaseUntil = new Date(at.getTime() + probeSeconds * 1000);
        await db
          .update(npAgentCircuitBreakers)
          .set({
            state: "half_open",
            retryAt: null,
            probeLeaseUntil: leaseUntil,
            versionNumber: row.versionNumber + 1,
            updatedAt: at,
          })
          .where(
            and(
              eq(npAgentCircuitBreakers.siteId, input.siteId),
              eq(npAgentCircuitBreakers.id, row.id),
              eq(npAgentCircuitBreakers.versionNumber, row.versionNumber),
            ),
          );
        return {
          breakerId: row.id,
          version: row.versionNumber + 1,
          leaseUntil: leaseUntil.toISOString(),
        };
      }),
    settleProbe: (input) =>
      locked(input, ["siteId", "probe", "succeeded"], async ({ db }, input) => {
        try {
          canonicalBodyRecord(
            input.probe,
            "runtime.probe",
            ["breakerId", "version", "leaseUntil"],
            ["breakerId", "version", "leaseUntil"],
            { seen: new WeakSet() },
          );
        } catch {
          fail();
        }
        uuid(input.probe.breakerId);
        const [row] = await db
          .select()
          .from(npAgentCircuitBreakers)
          .where(
            and(
              eq(npAgentCircuitBreakers.siteId, input.siteId),
              eq(npAgentCircuitBreakers.id, input.probe.breakerId),
            ),
          )
          .for("update")
          .limit(1);
        if (!row) fail();
        valid(row);
        const at = now();
        if (!Number.isFinite(at.getTime()) || at < row.updatedAt) fail();
        if (
          typeof input.succeeded !== "boolean" ||
          row.state !== "half_open" ||
          row.versionNumber !== input.probe.version ||
          row.probeLeaseUntil?.toISOString() !== input.probe.leaseUntil ||
          row.probeLeaseUntil <= at ||
          row.reasonCode === "PROVIDER_AUTHENTICATION" ||
          row.reasonCode?.includes("POLICY")
        )
          fail();
        const state = input.succeeded ? "closed" : "open";
        await db
          .update(npAgentCircuitBreakers)
          .set({
            state,
            reasonCode: input.succeeded ? null : row.reasonCode,
            failureCount: input.succeeded ? 0 : row.failureCount,
            openedAt: input.succeeded ? null : row.openedAt,
            retryAt: input.succeeded
              ? null
              : new Date(at.getTime() + options.cooldownSeconds * 1000),
            probeLeaseUntil: null,
            versionNumber: row.versionNumber + 1,
            updatedAt: at,
          })
          .where(
            and(
              eq(npAgentCircuitBreakers.siteId, input.siteId),
              eq(npAgentCircuitBreakers.id, row.id),
              eq(npAgentCircuitBreakers.versionNumber, input.probe.version),
            ),
          );
        await db.insert(npAuditEvents).values({
          siteId: input.siteId,
          actorKind: "system",
          action: "agent.runtime.breaker.probe",
          targetType: "agent-circuit-breaker",
          targetId: row.id,
          payload: { state, version: row.versionNumber + 1 },
          createdAt: at,
        });
        return { state };
      }),
  };
}
