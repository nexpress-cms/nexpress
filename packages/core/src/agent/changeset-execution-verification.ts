import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { NpTransaction } from "../collections/pipeline.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentChangesetExecutions,
  npAgentChangesetRollbackPlans,
  npAgentChangesetRollbackOperations,
  type NpAgentChangeSetExecutionEffectV1,
} from "../db/schema/agent.js";
import {
  npAgentVerificationCheckIdsV1,
  npRequireAgentVerificationChecksV1,
  npDigestAgentVerificationResultV1,
  type NpAgentVerificationCheckV1,
} from "../agent-contract/changeset-execution-contract.js";

type VerificationDb = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Parent = typeof npAgentChangesets.$inferSelect;
type Operation = typeof npAgentChangesetOperations.$inferSelect;
export type NpAgentChangeSetVerificationTargetV1 =
  | { kind: "apply"; parent: Parent; operations: Operation[] }
  | {
      kind: "rollback";
      parent: Parent;
      plan: typeof npAgentChangesetRollbackPlans.$inferSelect;
      operations: (typeof npAgentChangesetRollbackOperations.$inferSelect)[];
    };
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
    target: NpAgentChangeSetVerificationTargetV1,
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
  if (await inspectTerminalRollbackEffects(options)) return;
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
    if (!parent) return null;
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
      (execution.purpose === "apply"
        ? !["applied", "verifying", "verification_failed"].includes(parent.state) ||
          execution.planHash !== parent.planHash
        : parent.state !== "rolling_back") ||
      !(
        execution.purpose === "apply"
          ? ["committed", "failed", "verifying"]
          : ["committed", "verifying"]
      ).includes(execution.state) ||
      (execution.leaseUntil && execution.leaseUntil > at)
    )
      return null;
    if (execution.attempts >= 2_147_483_647 || execution.version >= 2_147_483_647) return null;
    await verificationTarget(tx, parent, execution);
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
      .set({
        state: execution.purpose === "rollback" ? "rolling_back" : "verifying",
        updatedAt: at,
      })
      .where(eq(npAgentChangesets.id, parent.id));
    return execution;
  });
  if (!claim) return;
  const matchesClaim = (execution: typeof claim) =>
    execution.changesetId === claim.changesetId &&
    execution.purpose === claim.purpose &&
    execution.rollbackPlanId === claim.rollbackPlanId &&
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
          parent.state !== (claim.purpose === "rollback" ? "rolling_back" : "verifying") ||
          execution?.leaseToken !== token ||
          execution.state !== "verifying" ||
          !matchesClaim(execution) ||
          !execution.leaseUntil ||
          execution.leaseUntil <= now()
        )
          return [];
        const target = await verificationTarget(tx, parent, execution);
        const operations = target.operations;
        if (!operations.length || operations.length > 500) return [];
        for (const operation of operations) allowedOperations.add(String(operation.ordinal));
        return npRequireAgentVerificationChecksV1(
          await options.readResources(tx as unknown as NpTransaction, target),
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
      const inspected = await inspectEffects(
        options,
        claim.effects,
        claim.idempotencyKey,
        ioDeadline,
      );
      for (const [ordinal, observed] of inspected) observedEffects.set(ordinal, observed);
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
      parent.state !== (claim.purpose === "rollback" ? "rolling_back" : "verifying") ||
      execution?.state !== "verifying" ||
      execution.leaseToken !== token ||
      !matchesClaim(execution) ||
      !execution.leaseUntil ||
      execution.leaseUntil <= at ||
      execution.verificationContractFingerprint !== claim.verificationContractFingerprint ||
      (execution.purpose === "apply" && execution.planHash !== parent.planHash)
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
        const target = await verificationTarget(tx, parent, execution);
        const operations = target.operations;
        if (!operations.length || operations.length > 500)
          throw new Error("Invalid operation inventory");
        const current = npRequireAgentVerificationChecksV1(
          await options.readResources(tx as unknown as NpTransaction, target),
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
    const target = await verificationTarget(tx, parent, execution);
    if (
      target.kind === "rollback" &&
      normalized.some((check) => check.required && check.status !== "passed")
    ) {
      for (const check of normalized)
        if (check.nextAction === "retry_verification") check.nextAction = "refresh_plan";
    }
    const digest = await npDigestAgentVerificationResultV1({
      ...(target.kind === "rollback"
        ? { purpose: "rollback" as const, rollbackPlanId: target.plan.id }
        : {}),
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
        state:
          target.kind === "rollback"
            ? passed
              ? "rolled_back"
              : "rollback_failed"
            : passed
              ? "verified"
              : "verification_failed",
        ...(target.kind === "apply" ? { verifiedAt: passed ? at : null } : {}),
        updatedAt: at,
      })
      .where(eq(npAgentChangesets.id, parent.id));
    if (target.kind === "rollback") {
      await tx
        .update(npAgentChangesetRollbackPlans)
        .set({
          state: passed ? "verified" : "failed",
          version: target.plan.version + 1,
          resultDigest: execution.resultDigest,
          verificationDigest: digest,
          finishedAt: at,
          terminalReason: passed ? null : "verification_failed",
        })
        .where(eq(npAgentChangesetRollbackPlans.id, target.plan.id));
      if (passed)
        await tx
          .update(npAgentChangesetRollbackOperations)
          .set({ state: "verified", updatedAt: at })
          .where(
            and(
              eq(npAgentChangesetRollbackOperations.siteId, options.siteId),
              eq(npAgentChangesetRollbackOperations.rollbackPlanId, target.plan.id),
              eq(npAgentChangesetRollbackOperations.state, "applied"),
            ),
          );
    }
    if (passed && target.kind === "apply")
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

async function verificationTarget(
  tx: VerificationDb,
  parent: Parent,
  execution: typeof npAgentChangesetExecutions.$inferSelect,
  terminalInspection = false,
): Promise<NpAgentChangeSetVerificationTargetV1> {
  if (execution.purpose === "apply") {
    if (execution.rollbackPlanId !== null || execution.planHash !== parent.planHash)
      throw new Error("Invalid execution target");
    const operations = await tx
      .select()
      .from(npAgentChangesetOperations)
      .where(
        and(
          eq(npAgentChangesetOperations.siteId, parent.siteId),
          eq(npAgentChangesetOperations.changesetId, parent.id),
        ),
      )
      .orderBy(asc(npAgentChangesetOperations.ordinal))
      .limit(501);
    return { kind: "apply", parent, operations };
  }
  if (execution.purpose !== "rollback" || !execution.rollbackPlanId)
    throw new Error("Invalid execution target");
  const [plan] = await tx
    .select()
    .from(npAgentChangesetRollbackPlans)
    .where(
      and(
        eq(npAgentChangesetRollbackPlans.siteId, parent.siteId),
        eq(npAgentChangesetRollbackPlans.changesetId, parent.id),
        eq(npAgentChangesetRollbackPlans.id, execution.rollbackPlanId),
      ),
    )
    .for("update");
  if (
    !plan ||
    plan.planHash !== execution.planHash ||
    plan.approvalId !== execution.approvalId ||
    plan.state !== (terminalInspection ? "failed" : "executing") ||
    plan.version >= 2147483647
  )
    throw new Error("Invalid rollback target");
  const competing = await tx.execute(sql`
    select 1 from public.np_agent_changeset_rollback_plans p
      where p.site_id=${parent.siteId} and p.changeset_id=${parent.id} and p.id<>${plan.id}
        and p.generation>${plan.generation} and p.state in ('preparing','ready','approval_pending','approved','executing')
    union all select 1 from public.np_agent_changeset_executions e
      where e.site_id=${parent.siteId} and e.changeset_id=${parent.id} and e.purpose='rollback' and e.id<>${execution.id}
        and (e.state in ('reserved','committed','verifying','ambiguous') or exists(select 1 from jsonb_array_elements(e.effects) effect where effect->>'state' in ('pending','running','unknown')))
    limit 1
  `);
  if (competing.rows.length) throw new Error("Competing rollback execution");
  const operations = await tx
    .select()
    .from(npAgentChangesetRollbackOperations)
    .where(
      and(
        eq(npAgentChangesetRollbackOperations.siteId, parent.siteId),
        eq(npAgentChangesetRollbackOperations.changesetId, parent.id),
        eq(npAgentChangesetRollbackOperations.rollbackPlanId, plan.id),
      ),
    )
    .orderBy(asc(npAgentChangesetRollbackOperations.ordinal))
    .limit(501);
  return { kind: "rollback", parent, plan, operations };
}

type ObservedEffects = Map<
  number,
  {
    beforeState: NpAgentChangeSetExecutionEffectV1["state"];
    state: "succeeded" | "failed" | "unknown";
  }
>;
async function inspectEffects(
  options: NpAgentChangeSetVerificationOptionsV1,
  effects: NpAgentChangeSetExecutionEffectV1[],
  idempotencyKey: string,
  ioDeadline: number,
  unresolvedOnly = false,
): Promise<ObservedEffects> {
  const observedEffects: ObservedEffects = new Map();
  for (const effect of effects) {
    if (effect.state === "succeeded" || (unresolvedOnly && effect.state === "failed")) continue;
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
        options.inspectPostCommitEffect!({
          siteId: options.siteId,
          changeSetId: options.changeSetId,
          executionId: options.executionId,
          ordinal: effect.ordinal,
          label: effect.label,
          context: { ...effect.context },
          signal: controller.signal,
          idempotencyKey: idempotencyKey,
        }).catch(() => "unknown" as const),
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
  return observedEffects;
}

/** Terminal rollback history never changes; this records only confirmed opaque-effect observations. */
async function inspectTerminalRollbackEffects(
  options: NpAgentChangeSetVerificationOptionsV1,
): Promise<boolean> {
  if (!options.inspectPostCommitEffect) return false;
  const db = getDb();
  const load = async (tx: VerificationDb) => {
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
    if (!parent || parent.state !== "rollback_failed") return null;
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
    if (
      !execution ||
      execution.purpose !== "rollback" ||
      execution.state !== "failed" ||
      !execution.committedAt ||
      execution.leaseToken !== null ||
      execution.version >= 2147483647 ||
      execution.verificationContractFingerprint !== options.verificationFingerprint ||
      !execution.effects.some((effect) => ["pending", "running", "unknown"].includes(effect.state))
    )
      return null;
    const target = await verificationTarget(tx, parent, execution, true);
    if (target.kind !== "rollback" || !target.operations.length || target.operations.length > 500)
      return null;
    const checks = npRequireAgentVerificationChecksV1(
      await options.readResources(tx as unknown as NpTransaction, target),
    );
    if (
      checks.length !== 2 ||
      checks[0].checkId !== "resource_after_hashes" ||
      checks[1].checkId !== "revisions_audit" ||
      checks.some((check) => check.status !== "passed")
    )
      return null;
    return { parent, execution, plan: target.plan };
  };
  try {
    const snapshot = await db.transaction(load);
    if (!snapshot) return false;
    const deadline = Date.now() + 30_000;
    const effects = snapshot.execution.effects.map((effect) => ({
      ...effect,
      context: { ...effect.context },
    }));
    const observations = await inspectEffects(
      options,
      effects,
      snapshot.execution.idempotencyKey,
      deadline,
      true,
    );
    if (![...observations.values()].some((observation) => observation.state !== "unknown"))
      return true;
    await db.transaction(async (tx) => {
      const current = await load(tx);
      if (
        !current ||
        Date.now() > deadline ||
        JSON.stringify(current.execution) !== JSON.stringify(snapshot.execution) ||
        JSON.stringify(current.plan) !== JSON.stringify(snapshot.plan) ||
        JSON.stringify(current.parent) !== JSON.stringify(snapshot.parent)
      )
        return;
      let changed = false;
      for (const effect of current.execution.effects) {
        const observed = observations.get(effect.ordinal),
          original = snapshot.execution.effects.find((item) => item.ordinal === effect.ordinal);
        if (
          !observed ||
          observed.state === "unknown" ||
          !original ||
          effect.state !== observed.beforeState ||
          effect.label !== original.label ||
          JSON.stringify(effect.context) !== JSON.stringify(original.context)
        )
          continue;
        effect.state = observed.state;
        effect.errorCode = observed.state === "succeeded" ? null : "VERIFICATION_FAILED";
        changed = true;
      }
      if (changed)
        await tx
          .update(npAgentChangesetExecutions)
          .set({ effects: current.execution.effects, version: current.execution.version + 1 })
          .where(
            and(
              eq(npAgentChangesetExecutions.siteId, options.siteId),
              eq(npAgentChangesetExecutions.id, options.executionId),
              eq(npAgentChangesetExecutions.version, snapshot.execution.version),
            ),
          );
    });
    return true;
  } catch {
    // Failed authority, binding, or observation reads never rewrite terminal history.
    return true;
  }
}
