import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { NpTransaction } from "../collections/pipeline.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentChangesetExecutions,
  type NpAgentChangeSetExecutionEffectV1,
} from "../db/schema/agent.js";
import {
  npAgentVerificationCheckIdsV1,
  npRequireAgentVerificationChecksV1,
  npDigestAgentVerificationResultV1,
  type NpAgentVerificationCheckV1,
} from "../agent-contract/changeset-execution-contract.js";

type Parent = typeof npAgentChangesets.$inferSelect;
type Operation = typeof npAgentChangesetOperations.$inferSelect;
export type NpAgentConvergenceCheckIdV1 = "cache" | "search" | "media" | "public_routes";
export interface NpAgentChangeSetVerificationOptionsV1 {
  siteId: string;
  changeSetId: string;
  executionId: string;
  now?: () => Date;
  verificationFingerprint: string;
  verifyConvergence(input: {
    checkId: NpAgentConvergenceCheckIdV1;
    signal: AbortSignal;
    siteId: string;
    changeSetId: string;
    executionId: string;
    idempotencyKey: string;
  }): Promise<{
    status: "passed" | "failed" | "unavailable";
    evidenceRefs: NpAgentVerificationCheckV1["evidenceRefs"];
  }>;
  /** Inspection only: the host must not redispatch or replay an opaque hook. */
  inspectPostCommitEffect?(input: {
    siteId: string;
    changeSetId: string;
    executionId: string;
    ordinal: number;
    label: string;
    context: NpAgentChangeSetExecutionEffectV1["context"];
    signal: AbortSignal;
    idempotencyKey: string;
  }): Promise<"succeeded" | "failed" | "unknown">;
  readResources(
    db: NpTransaction,
    parent: Parent,
    operations: Operation[],
  ): Promise<NpAgentVerificationCheckV1[]>;
}
const unavailable = (
  checkId: NpAgentVerificationCheckV1["checkId"],
): NpAgentVerificationCheckV1 => ({
  checkId,
  required: true,
  severity: "error",
  status: "unavailable",
  evidenceRefs: [],
  nextAction: "retry_verification",
});

/** Explicit host processor. Commits are never replayed, and opaque hooks are never retried. */
export async function npVerifyChangeSetExecutionV1(
  options: NpAgentChangeSetVerificationOptionsV1,
): Promise<void> {
  const db = getDb(),
    now = options.now ?? (() => new Date()),
    token = randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [parent] = await tx
      .select()
      .from(npAgentChangesets)
      .where(
        and(
          eq(npAgentChangesets.siteId, options.siteId),
          eq(npAgentChangesets.id, options.changeSetId),
        ),
      )
      .for("update");
    if (!parent || !["applied", "verifying", "verification_failed"].includes(parent.state))
      return null;
    const [execution] = await tx
      .select()
      .from(npAgentChangesetExecutions)
      .where(
        and(
          eq(npAgentChangesetExecutions.siteId, options.siteId),
          eq(npAgentChangesetExecutions.changesetId, parent.id),
          eq(npAgentChangesetExecutions.id, options.executionId),
        ),
      )
      .for("update");
    const at = now();
    if (
      !execution?.committedAt ||
      execution.planHash !== parent.planHash ||
      !["committed", "failed", "verifying"].includes(execution.state) ||
      (execution.leaseUntil && execution.leaseUntil > at)
    )
      return null;
    if (execution.attempts >= 2_147_483_647 || execution.version >= 2_147_483_647) return null;
    const checks = npAgentVerificationCheckIdsV1.map(unavailable);
    await tx
      .update(npAgentChangesetExecutions)
      .set({
        state: "verifying",
        version: execution.version + 1,
        attempts: execution.attempts + 1,
        leaseOwner: "changeset-verification",
        leaseToken: token,
        leaseUntil: new Date(at.getTime() + 60_000),
        finishedAt: null,
        errorCode: null,
        verificationState: "running",
        verificationBody: checks,
        verificationDigest: null,
        verificationCompletedAt: null,
      })
      .where(eq(npAgentChangesetExecutions.id, execution.id));
    await tx
      .update(npAgentChangesets)
      .set({ state: "verifying", updatedAt: at })
      .where(eq(npAgentChangesets.id, parent.id));
    return execution;
  });
  if (!claim) return;
  const matchesClaim = (execution: typeof claim) =>
    execution.changesetId === claim.changesetId &&
    execution.approvalId === claim.approvalId &&
    execution.planHash === claim.planHash &&
    execution.resultDigest === claim.resultDigest &&
    execution.committedAt?.getTime() === claim.committedAt?.getTime() &&
    execution.scheduledFor?.getTime() === claim.scheduledFor?.getTime() &&
    execution.invocationFingerprint === claim.invocationFingerprint &&
    execution.idempotencyKey === claim.idempotencyKey &&
    execution.verificationContractFingerprint === claim.verificationContractFingerprint;

  const checks = npAgentVerificationCheckIdsV1.map(unavailable);
  const observedEffects = new Map<
    number,
    {
      beforeState: NpAgentChangeSetExecutionEffectV1["state"];
      state: "succeeded" | "failed" | "unknown";
    }
  >();
  const allowedOperations = new Set<string>();
  const allowedArtifacts = new Set<string>();
  const fingerprintMatches =
    claim.verificationContractFingerprint === options.verificationFingerprint;
  if (fingerprintMatches) {
    try {
      const resourceChecks = await db.transaction(async (tx) => {
        const [parent] = await tx
          .select()
          .from(npAgentChangesets)
          .where(
            and(
              eq(npAgentChangesets.siteId, options.siteId),
              eq(npAgentChangesets.id, options.changeSetId),
            ),
          )
          .for("update");
        const [execution] = await tx
          .select()
          .from(npAgentChangesetExecutions)
          .where(
            and(
              eq(npAgentChangesetExecutions.siteId, options.siteId),
              eq(npAgentChangesetExecutions.id, options.executionId),
            ),
          )
          .for("update");
        if (
          !parent ||
          parent.state !== "verifying" ||
          execution?.leaseToken !== token ||
          execution.state !== "verifying" ||
          !matchesClaim(execution) ||
          !execution.leaseUntil ||
          execution.leaseUntil <= now()
        )
          return [];
        const operations = await tx
          .select()
          .from(npAgentChangesetOperations)
          .where(
            and(
              eq(npAgentChangesetOperations.siteId, options.siteId),
              eq(npAgentChangesetOperations.changesetId, parent.id),
            ),
          )
          .orderBy(asc(npAgentChangesetOperations.ordinal))
          .limit(501);
        if (!operations.length || operations.length > 500) return [];
        for (const operation of operations) allowedOperations.add(String(operation.ordinal));
        return npRequireAgentVerificationChecksV1(
          await options.readResources(tx as unknown as NpTransaction, parent, operations),
        );
      });
      if (
        resourceChecks.length !== 2 ||
        resourceChecks[0]?.checkId !== "resource_after_hashes" ||
        resourceChecks[1]?.checkId !== "revisions_audit"
      )
        throw new Error("Invalid resource checks");
      if (
        resourceChecks.some((check) =>
          check.evidenceRefs.some(
            (ref) => ref.kind === "operation" && !allowedOperations.has(ref.id),
          ),
        )
      )
        throw new Error("Invalid resource evidence");
      for (const check of resourceChecks)
        for (const ref of check.evidenceRefs)
          if (ref.kind === "artifact") allowedArtifacts.add(ref.id);
      checks[0] = { ...resourceChecks[0], required: true };
      checks[1] = { ...resourceChecks[1], required: true };
    } catch {
      /* Protected reads fail closed; private causes never enter the journal. */
    }
    const ioDeadline = Date.now() + 30_000;
    if (
      options.inspectPostCommitEffect &&
      checks[0].status === "passed" &&
      checks[1].status === "passed"
    ) {
      for (const effect of claim.effects) {
        if (effect.state === "succeeded") continue;
        const remaining = ioDeadline - Date.now();
        if (remaining <= 0) break;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const expired = new Promise<"unknown">((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve("unknown");
            }, remaining);
          });
          const inspected = await Promise.race([
            options
              .inspectPostCommitEffect({
                siteId: options.siteId,
                changeSetId: options.changeSetId,
                executionId: options.executionId,
                ordinal: effect.ordinal,
                label: effect.label,
                context: { ...effect.context },
                signal: controller.signal,
                idempotencyKey: claim.idempotencyKey,
              })
              .catch(() => "unknown" as const),
            expired,
          ]);
          const state = inspected === "succeeded" || inspected === "failed" ? inspected : "unknown";
          observedEffects.set(effect.ordinal, { beforeState: effect.state, state });
          effect.state = state;
        } catch {
          observedEffects.set(effect.ordinal, { beforeState: effect.state, state: "unknown" });
          effect.state = "unknown";
        } finally {
          if (timer) clearTimeout(timer);
          controller.abort();
        }
      }
    }
    const hooksPassed = claim.effects.every((effect) => effect.state === "succeeded");
    checks[2] = {
      ...unavailable("post_commit_hooks"),
      status: hooksPassed ? "passed" : "unavailable",
      nextAction: hooksPassed ? "none" : "inspect_effect",
    };
    if (checks[0].status === "passed" && checks[1].status === "passed" && Date.now() < ioDeadline) {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<null>((resolve) => {
        timeout = setTimeout(
          () => {
            controller.abort();
            resolve(null);
          },
          Math.max(0, ioDeadline - Date.now()),
        );
      });
      try {
        const external = Promise.all(
          (["cache", "search", "media", "public_routes"] as const).map(async (checkId) => {
            try {
              const result = await options.verifyConvergence({
                checkId,
                signal: controller.signal,
                siteId: options.siteId,
                changeSetId: options.changeSetId,
                executionId: options.executionId,
                idempotencyKey: claim.idempotencyKey,
              });
              if (
                !result ||
                Object.keys(result).sort().join(",") !== "evidenceRefs,status" ||
                !["passed", "failed", "unavailable"].includes(result.status)
              )
                return unavailable(checkId);
              const checked = npRequireAgentVerificationChecksV1([
                {
                  checkId,
                  required: true,
                  severity: result.status === "passed" ? "info" : "error",
                  status: result.status,
                  evidenceRefs: result.evidenceRefs,
                  nextAction: result.status === "passed" ? "none" : "retry_verification",
                },
              ])[0];
              if (
                checked.evidenceRefs.some(
                  (ref) =>
                    !(ref.kind === "operation" ? allowedOperations : allowedArtifacts).has(ref.id),
                )
              )
                return unavailable(checkId);
              return checked;
            } catch {
              return unavailable(checkId);
            }
          }),
        );
        const results = await Promise.race([external, expired]);
        if (results) checks.splice(3, 4, ...results);
      } finally {
        if (timeout) clearTimeout(timeout);
        controller.abort();
      }
    }
  }
  const normalized = npRequireAgentVerificationChecksV1(checks);
  await db.transaction(async (tx) => {
    const [parent] = await tx
      .select()
      .from(npAgentChangesets)
      .where(
        and(
          eq(npAgentChangesets.siteId, options.siteId),
          eq(npAgentChangesets.id, options.changeSetId),
        ),
      )
      .for("update");
    const [execution] = await tx
      .select()
      .from(npAgentChangesetExecutions)
      .where(
        and(
          eq(npAgentChangesetExecutions.siteId, options.siteId),
          eq(npAgentChangesetExecutions.id, options.executionId),
        ),
      )
      .for("update");
    let at = now();
    if (
      !parent ||
      parent.state !== "verifying" ||
      execution?.state !== "verifying" ||
      execution.leaseToken !== token ||
      !matchesClaim(execution) ||
      !execution.leaseUntil ||
      execution.leaseUntil <= at ||
      execution.verificationContractFingerprint !== claim.verificationContractFingerprint ||
      execution.planHash !== parent.planHash
    )
      return;
    for (const effect of execution.effects) {
      const observed = observedEffects.get(effect.ordinal),
        original = claim.effects.find((candidate) => candidate.ordinal === effect.ordinal);
      if (
        observed &&
        original &&
        effect.state === observed.beforeState &&
        effect.label === original.label &&
        JSON.stringify(effect.context) === JSON.stringify(original.context)
      ) {
        effect.state = observed.state;
        effect.errorCode =
          observed.state === "succeeded"
            ? null
            : observed.state === "failed"
              ? "VERIFICATION_FAILED"
              : "EFFECT_AMBIGUOUS";
      }
    }
    const hooksPassed = execution.effects.every((effect) => effect.state === "succeeded");
    normalized[2] = {
      ...unavailable("post_commit_hooks"),
      status: hooksPassed ? "passed" : "unavailable",
      nextAction: hooksPassed ? "none" : "inspect_effect",
    };
    if (fingerprintMatches) {
      try {
        const operations = await tx
          .select()
          .from(npAgentChangesetOperations)
          .where(
            and(
              eq(npAgentChangesetOperations.siteId, options.siteId),
              eq(npAgentChangesetOperations.changesetId, parent.id),
            ),
          )
          .orderBy(asc(npAgentChangesetOperations.ordinal))
          .limit(501);
        if (!operations.length || operations.length > 500)
          throw new Error("Invalid operation inventory");
        const current = npRequireAgentVerificationChecksV1(
          await options.readResources(tx as unknown as NpTransaction, parent, operations),
        );
        if (
          current.length !== 2 ||
          current[0].checkId !== "resource_after_hashes" ||
          current[1].checkId !== "revisions_audit"
        )
          throw new Error("Invalid resource checks");
        const currentOperations = new Set(operations.map((operation) => String(operation.ordinal)));
        if (
          current.some((check) =>
            check.evidenceRefs.some(
              (ref) => ref.kind === "operation" && !currentOperations.has(ref.id),
            ),
          )
        )
          throw new Error("Invalid resource evidence");
        const currentArtifacts = new Set(
          current.flatMap((check) =>
            check.evidenceRefs.filter((ref) => ref.kind === "artifact").map((ref) => ref.id),
          ),
        );
        for (let i = 3; i < normalized.length; i++)
          if (
            normalized[i].evidenceRefs.some(
              (ref) =>
                !(ref.kind === "operation" ? currentOperations : currentArtifacts).has(ref.id),
            )
          )
            normalized[i] = unavailable(normalized[i].checkId);
        normalized[0] = { ...current[0], required: true };
        normalized[1] = { ...current[1], required: true };
      } catch {
        normalized[0] = unavailable("resource_after_hashes");
        normalized[1] = unavailable("revisions_audit");
        for (let i = 3; i < normalized.length; i++)
          normalized[i] = unavailable(normalized[i].checkId);
      }
    }
    at = now();
    if (execution.leaseUntil <= at) return;
    const digest = await npDigestAgentVerificationResultV1({
      siteId: options.siteId,
      changeSetId: options.changeSetId,
      executionId: options.executionId,
      verificationContractFingerprint: claim.verificationContractFingerprint,
      checks: normalized,
    });
    at = now();
    if (execution.leaseUntil <= at) return;
    const passed = normalized.every((check) => !check.required || check.status === "passed");
    await tx
      .update(npAgentChangesetExecutions)
      .set({
        state: passed ? "succeeded" : "failed",
        version: execution.version + 1,
        finishedAt: at,
        errorCode: passed
          ? null
          : fingerprintMatches
            ? "VERIFICATION_FAILED"
            : "DEPENDENCY_UNAVAILABLE",
        leaseOwner: null,
        leaseToken: null,
        leaseUntil: null,
        verificationState: passed ? "passed" : "failed",
        verificationBody: normalized,
        effects: execution.effects,
        verificationDigest: digest,
        verificationCompletedAt: at,
      })
      .where(eq(npAgentChangesetExecutions.id, execution.id));
    await tx
      .update(npAgentChangesets)
      .set({
        state: passed ? "verified" : "verification_failed",
        verifiedAt: passed ? at : null,
        updatedAt: at,
      })
      .where(eq(npAgentChangesets.id, parent.id));
    if (passed)
      await tx
        .update(npAgentChangesetOperations)
        .set({ state: "verified", updatedAt: at })
        .where(
          and(
            eq(npAgentChangesetOperations.siteId, options.siteId),
            eq(npAgentChangesetOperations.changesetId, parent.id),
            eq(npAgentChangesetOperations.state, "applied"),
          ),
        );
  });
}
