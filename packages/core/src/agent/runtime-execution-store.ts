import { npDigestAgentRuntimeManualInputV1 } from "../agent-contract/runtime-manual-input.js";
import { and, eq, inArray } from "drizzle-orm";
import type { NpAgentCapabilityAdmissionServiceV1 } from "./capability-admission.js";
import type { getDb } from "../db/runtime.js";
import { npAgentRuns, npAgentProviderCalls, npAgentActions } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npDigestAgentRunAdmissionCanonical } from "../agent-contract/canonical-run-admission.js";
import {
  npRequireAgentRunLimitsCanonical,
  npDigestAgentRunLimitsCanonical,
} from "../agent-contract/canonical-bodies.js";
import {
  npRequireAgentBudgetSnapshotCanonical,
  npDigestAgentBudgetSnapshotCanonical,
} from "../agent-contract/canonical-budget-snapshot.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRuntimeRunAdmissionBodyV1,
  type NpAgentRuntimeAdmissionV1,
  type NpAgentRuntimeExecutionClaimV1,
  type NpAgentRuntimeRunContextV1,
} from "./runtime-admission.js";
import { npVerifyAgentRuntimeAdmissionSourcesV1 } from "./runtime-admission-sources.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npRequireAgentRuntimeVersionV1 } from "./runtime-service.js";
import { canonicalBodyRecord } from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { NpAgentGatewayError } from "./admin-admission.js";

type Db = ReturnType<typeof getDb>;
type Run = typeof npAgentRuns.$inferSelect;
type Identity = { siteId: string; runId: string };
type Claimed = Identity & { claim: NpAgentRuntimeExecutionClaimV1 };
const terminal = ["succeeded", "failed", "cancelled", "policy_blocked", "budget_blocked"];
function fail(code = "RUNTIME_EXECUTION_CONFLICT", status = 409): never {
  throw new NpAgentGatewayError(code, status, "Agent runtime execution is unavailable.");
}
function closed<T>(input: T, extra: string[] = []): T {
  try {
    const value = cloneCanonicalRuntimeInput(input, "runtime.execution", 8192);
    return canonicalBodyRecord(
      value,
      "runtime.execution",
      ["siteId", "runId", ...extra],
      ["siteId", "runId", ...extra.filter((key) => key !== "errorCode")],
      { seen: new WeakSet() },
    ) as T;
  } catch {
    fail("RUNTIME_ARGUMENT_INVALID", 400);
  }
}
function identity(input: Identity): void {
  if (
    !input ||
    typeof input.siteId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.runId)
  )
    fail("RUNTIME_ARGUMENT_INVALID", 400);
}
/** Retained evidence verification does not grant present execution authority. */
export async function npRequireAgentRuntimeExecutionIntegrityV1(run: Run): Promise<void> {
  try {
    if (run.origin !== "runtime" || !run.agentId || !run.agentVersionId) fail();
    if (
      run.manualInput != null
        ? (await npDigestAgentRuntimeManualInputV1(run.manualInput)) !== run.manualInputDigest
        : run.manualInputDigest != null
    )
      fail();
    const body = npRuntimeRunAdmissionBodyV1(run);
    const limits = npRequireAgentRunLimitsCanonical(run.runLimits);
    const budget = npRequireAgentBudgetSnapshotCanonical(run.budgetSnapshot);
    if (
      (await npDigestAgentRunAdmissionCanonical(body)) !== run.admissionFingerprint ||
      (await npDigestAgentRunLimitsCanonical(limits)) !== run.runLimitsHash ||
      (await npDigestAgentBudgetSnapshotCanonical(budget)) !== run.budgetSnapshotHash ||
      budget.siteId !== run.siteId ||
      budget.agentId !== run.agentId ||
      budget.principalId !== run.principalId ||
      serializeAgentCanonicalJson(budget.limits) !== serializeAgentCanonicalJson(limits)
    )
      fail();
    await npVerifyAgentRuntimeAdmissionSourcesV1({
      sources: run.runtimeAdmissionSources,
      admission: body,
      budgetSnapshot: budget,
    });
    if (
      !Number.isSafeInteger(run.attempt) ||
      run.attempt < 1 ||
      run.attempt > limits.maxAttempts ||
      !Number.isFinite(run.deadlineAt.getTime()) ||
      Boolean(run.finishedAt) !== terminal.includes(run.state)
    )
      fail();
  } catch {
    fail("RUNTIME_EXECUTION_INTEGRITY_INVALID");
  }
}
export interface NpAgentRuntimeExecutionStoreV1 {
  claim(input: Identity): Promise<{ state: string; claim: NpAgentRuntimeExecutionClaimV1 | null }>;
  claimApproval(
    input: Identity & { requestActionId: string },
  ): Promise<{ state: string; claim: NpAgentRuntimeExecutionClaimV1 | null }>;
  renew(input: Claimed): Promise<NpAgentRuntimeExecutionClaimV1>;
  withClaim<T>(
    input: Claimed,
    operation: (context: NpAgentRuntimeRunContextV1) => Promise<T>,
  ): Promise<T>;
  transition(
    input: Claimed & {
      state:
        | "waiting_approval"
        | "verifying"
        | "succeeded"
        | "failed"
        | "policy_blocked"
        | "budget_blocked";
      errorCode?: string;
    },
  ): Promise<{ state: string }>;
  waitRetry(input: Claimed & { retryAt: string }): Promise<{ state: string }>;
  cancel(input: Identity): Promise<{ state: string }>;
  recover(input: Identity): Promise<{ state: string; claim: null }>;
}
export function createAgentRuntimeExecutionStoreV1(options: {
  admission: NpAgentRuntimeAdmissionV1;
  now?: () => Date;
  leaseSeconds?: number;
  approval?: Pick<NpAgentCapabilityAdmissionServiceV1, "inspectRuntimeApproval">;
}): NpAgentRuntimeExecutionStoreV1 {
  const leaseSeconds = options.leaseSeconds ?? 90;
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 90)
    fail("RUNTIME_ARGUMENT_INVALID", 400);
  const now = options.now ?? (() => new Date());
  const locked = <T, I extends Identity>(
    input: I,
    operation: (db: Db, run: Run, at: Date, input: I) => Promise<T>,
  ) => {
    npAssertAgentPreviewEffectsAllowed();
    identity(input);
    return npWithAgentRuntimeControlTransactionV1(input.siteId, async ({ db }) => {
      const [run] = await db
        .select()
        .from(npAgentRuns)
        .where(and(eq(npAgentRuns.siteId, input.siteId), eq(npAgentRuns.id, input.runId)))
        .for("update")
        .limit(1);
      if (!run || run.origin !== "runtime") fail("RUNTIME_RESOURCE_UNAVAILABLE", 404);
      await npRequireAgentRuntimeExecutionIntegrityV1(run);
      const version = await npRequireAgentRuntimeVersionV1({
        db,
        siteId: run.siteId,
        agentId: run.agentId!,
        versionId: run.agentVersionId!,
        active: false,
      });
      if (
        version.version.configHash !== run.agentConfigHash ||
        version.principal.id !== run.principalId
      )
        fail("RUNTIME_EXECUTION_INTEGRITY_INVALID");
      const at = now();
      if (!Number.isFinite(at.getTime()) || at < run.queuedAt) fail();
      return operation(db, run, at, input);
    });
  };
  const assertClaim = (run: Run, claim: NpAgentRuntimeExecutionClaimV1, at: Date) => {
    try {
      canonicalBodyRecord(
        claim,
        "runtime.claim",
        ["attempt", "leaseUntil"],
        ["attempt", "leaseUntil"],
        { seen: new WeakSet() },
      );
    } catch {
      fail();
    }
    if (
      !claim ||
      !Number.isInteger(claim.attempt) ||
      claim.attempt !== run.attempt ||
      !run.leaseUntil ||
      claim.leaseUntil !== run.leaseUntil.toISOString() ||
      run.leaseUntil <= at ||
      run.deadlineAt <= at ||
      !["running", "verifying"].includes(run.state) ||
      run.finishedAt
    )
      fail();
  };
  const update = async (
    db: Db,
    run: Run,
    at: Date,
    patch: Partial<typeof npAgentRuns.$inferInsert>,
  ) => {
    await db
      .update(npAgentRuns)
      .set(patch)
      .where(
        and(
          eq(npAgentRuns.siteId, run.siteId),
          eq(npAgentRuns.id, run.id),
          eq(npAgentRuns.attempt, run.attempt),
        ),
      );
    await db.insert(npAuditEvents).values({
      siteId: run.siteId,
      actorKind: "system",
      action: "agent.runtime.execution",
      targetType: "agent-run",
      targetId: run.id,
      payload: {
        fromState: run.state,
        state: patch.state ?? run.state,
        attempt: patch.attempt ?? run.attempt,
      },
      createdAt: at,
    });
  };
  const finish = async (db: Db, run: Run, at: Date, state: string, errorCode: string | null) => {
    await update(db, run, at, {
      state,
      leaseUntil: null,
      runtimeRetryAt: null,
      finishedAt: at,
      errorCode,
      errorMessage: errorCode ? "Agent runtime execution stopped." : null,
    });
    return { state };
  };
  const unresolved = async (db: Db, run: Run, context?: NpAgentRuntimeRunContextV1) => {
    const calls = await db
      .select({ id: npAgentProviderCalls.id })
      .from(npAgentProviderCalls)
      .where(
        and(
          eq(npAgentProviderCalls.siteId, run.siteId),
          eq(npAgentProviderCalls.runId, run.id),
          inArray(npAgentProviderCalls.state, ["reserved", "in_flight", "ambiguous"]),
        ),
      )
      .limit(1);
    const actions = await db
      .select({ id: npAgentActions.id, state: npAgentActions.state })
      .from(npAgentActions)
      .where(and(eq(npAgentActions.siteId, run.siteId), eq(npAgentActions.runId, run.id)))
      .limit(1001);
    if (actions.length > 1000) fail("RUNTIME_EXECUTION_INTEGRITY_INVALID");
    if (calls.length > 0) return true;
    for (const action of actions) {
      if (["succeeded", "compensated"].includes(action.state)) continue;
      if (context && options.approval && ["approval_pending", "approved"].includes(action.state)) {
        const evidence = await options.approval.inspectRuntimeApproval(context, action.id);
        if (evidence.status === "completed") continue;
      }
      return true;
    }
    return false;
  };
  return {
    claim: (input) =>
      locked(closed(input), async (db, run, at) => {
        if (terminal.includes(run.state)) return { state: run.state, claim: null };
        if (run.deadlineAt <= at)
          return {
            ...(await finish(db, run, at, "failed", "RUNTIME_DEADLINE_EXCEEDED")),
            claim: null,
          };
        if (run.state === "waiting_approval" || (run.leaseUntil && run.leaseUntil > at))
          return { state: run.state, claim: null };
        if (run.state === "waiting_retry" && (!run.runtimeRetryAt || run.runtimeRetryAt > at))
          return { state: run.state, claim: null };
        if (!["queued", "running", "verifying", "waiting_retry"].includes(run.state)) fail();
        const attempt = run.startedAt ? run.attempt + 1 : run.attempt;
        if (attempt > run.runLimits.maxAttempts)
          return {
            ...(await finish(db, run, at, "failed", "RUNTIME_ATTEMPTS_EXHAUSTED")),
            claim: null,
          };
        const leaseUntil = new Date(
          Math.min(at.getTime() + leaseSeconds * 1000, run.deadlineAt.getTime()),
        );
        await update(db, run, at, {
          state: "running",
          attempt,
          startedAt: run.startedAt ?? at,
          leaseUntil,
          runtimeRetryAt: null,
        });
        return { state: "running", claim: { attempt, leaseUntil: leaseUntil.toISOString() } };
      }),
    claimApproval: (input) => {
      npAssertAgentPreviewEffectsAllowed();
      input = closed(input, ["requestActionId"]);
      identity({ siteId: input.siteId, runId: input.requestActionId });
      if (!options.approval) fail("RUNTIME_APPROVAL_UNAVAILABLE");
      const approval = options.approval;
      return options.admission.withRunAuthority(
        { siteId: input.siteId, runId: input.runId, allowTerminal: true },
        async (context) => {
          const { db, run } = context;
          const evidence = await approval.inspectRuntimeApproval(context, input.requestActionId);
          const at = now();
          if (evidence.requestActionId !== input.requestActionId || !Number.isFinite(at.getTime()))
            fail("RUNTIME_APPROVAL_UNAVAILABLE");
          if (
            evidence.status === "pending" ||
            terminal.includes(run.state) ||
            (run.leaseUntil && run.leaseUntil > at)
          )
            return { state: run.state, claim: null };
          if (
            !["waiting_approval", "running", "verifying"].includes(run.state) ||
            run.deadlineAt <= at
          )
            fail("RUNTIME_APPROVAL_UNAVAILABLE");
          // Every claim changes the durable attempt, including approval continuation.
          // Waiting states clear leaseUntil, so a lease timestamp alone cannot fence stale workers.
          const attempt = run.attempt + 1;
          if (attempt > context.limits.maxAttempts) fail("RUNTIME_ATTEMPTS_EXHAUSTED");
          const leaseUntil = new Date(
            Math.min(at.getTime() + leaseSeconds * 1000, run.deadlineAt.getTime()),
          );
          await update(db, run, at, {
            state: "running",
            attempt,
            leaseUntil,
            runtimeRetryAt: null,
          });
          return { state: "running", claim: { attempt, leaseUntil: leaseUntil.toISOString() } };
        },
      );
    },
    renew: (input) =>
      locked(closed(input, ["claim"]), async (db, run, at, input) => {
        assertClaim(run, input.claim, at);
        const leaseUntil = new Date(
          Math.min(at.getTime() + leaseSeconds * 1000, run.deadlineAt.getTime()),
        );
        await update(db, run, at, { leaseUntil });
        return { attempt: run.attempt, leaseUntil: leaseUntil.toISOString() };
      }),
    withClaim: (input, operation) => {
      npAssertAgentPreviewEffectsAllowed();
      return options.admission.withCurrentRun(input, operation);
    },
    transition: (input) => {
      npAssertAgentPreviewEffectsAllowed();
      input = closed(input, ["claim", "state", "errorCode"]);
      const change = async (db: Db, run: Run, at: Date, context?: NpAgentRuntimeRunContextV1) => {
        assertClaim(run, input.claim, at);
        if (
          ![
            "waiting_approval",
            "verifying",
            "succeeded",
            "failed",
            "policy_blocked",
            "budget_blocked",
          ].includes(input.state) ||
          (input.errorCode !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.errorCode))
        )
          fail("RUNTIME_ARGUMENT_INVALID", 400);
        if (input.state === "succeeded" && input.errorCode !== undefined)
          fail("RUNTIME_ARGUMENT_INVALID", 400);
        if (input.state === "waiting_approval") {
          const pending = await db
            .select({ id: npAgentActions.id, approvalId: npAgentActions.approvalId })
            .from(npAgentActions)
            .where(
              and(
                eq(npAgentActions.siteId, run.siteId),
                eq(npAgentActions.runId, run.id),
                inArray(npAgentActions.state, ["approval_pending", "approved"]),
              ),
            )
            .limit(1001);
          if (pending.length > 1000) fail("RUNTIME_APPROVAL_UNAVAILABLE");
          const unresolvedApprovals = [];
          for (const action of pending) {
            if (context && options.approval) {
              const evidence = await options.approval.inspectRuntimeApproval(context, action.id);
              if (evidence.requestActionId !== action.id) fail("RUNTIME_APPROVAL_UNAVAILABLE");
              if (evidence.status === "completed") continue;
              unresolvedApprovals.push(action);
            } else {
              // Without the shared signed-receipt owner, only the existing bound-column
              // contract may identify a pending request. A scope or state alone is insufficient.
              if (!action.approvalId) fail("RUNTIME_APPROVAL_UNAVAILABLE");
              unresolvedApprovals.push(action);
            }
          }
          if (unresolvedApprovals.length !== 1) fail("RUNTIME_APPROVAL_UNAVAILABLE");
        }
        if (input.state === "succeeded" && (await unresolved(db, run, context)))
          fail("RUNTIME_EXECUTION_UNRESOLVED");
        if (terminal.includes(input.state))
          return finish(db, run, at, input.state, input.errorCode ?? null);
        await update(db, run, at, {
          state: input.state,
          leaseUntil: input.state === "waiting_approval" ? null : run.leaseUntil,
          runtimeRetryAt: null,
        });
        return { state: input.state };
      };
      return ["succeeded", "waiting_approval", "verifying"].includes(input.state)
        ? options.admission.withCurrentRun(
            { siteId: input.siteId, runId: input.runId, claim: input.claim },
            (context) => change(context.db, context.run, context.now, context),
          )
        : locked(input, (db, run, at) => change(db, run, at));
    },
    waitRetry: (input) => {
      npAssertAgentPreviewEffectsAllowed();
      input = closed(input, ["claim", "retryAt"]);
      return options.admission.withCurrentRun(
        { siteId: input.siteId, runId: input.runId, claim: input.claim },
        async (context) => {
          const { db, run, now: at } = context;
          assertClaim(run, input.claim, at);
          const retryAt = new Date(input.retryAt);
          if (
            !Number.isFinite(retryAt.getTime()) ||
            retryAt.toISOString() !== input.retryAt ||
            retryAt <= at ||
            retryAt >= run.deadlineAt ||
            (await unresolved(db, run, context))
          )
            fail();
          await update(db, run, at, {
            state: "waiting_retry",
            leaseUntil: null,
            runtimeRetryAt: retryAt,
          });
          return { state: "waiting_retry" };
        },
      );
    },
    cancel: (input) =>
      locked(closed(input), async (db, run, at) =>
        terminal.includes(run.state)
          ? { state: run.state }
          : finish(db, run, at, "cancelled", "RUNTIME_CANCELLED"),
      ),
    recover: (input) =>
      locked(closed(input), async (db, run, at) => {
        if (terminal.includes(run.state) || (run.leaseUntil && run.leaseUntil > at))
          return { state: run.state, claim: null };
        if (run.deadlineAt <= at)
          return {
            ...(await finish(db, run, at, "failed", "RUNTIME_DEADLINE_EXCEEDED")),
            claim: null,
          };
        // A lost dispatch stays unknown. Recovery never claims it was not sent.
        const [unknown] = await db
          .select({ id: npAgentProviderCalls.id })
          .from(npAgentProviderCalls)
          .where(
            and(
              eq(npAgentProviderCalls.siteId, run.siteId),
              eq(npAgentProviderCalls.runId, run.id),
              inArray(npAgentProviderCalls.state, ["in_flight", "ambiguous"]),
            ),
          )
          .limit(1);
        if (unknown)
          return {
            ...(await finish(db, run, at, "failed", "RUNTIME_PROVIDER_UNRESOLVED")),
            claim: null,
          };
        return { state: run.state, claim: null };
      }),
  };
}
