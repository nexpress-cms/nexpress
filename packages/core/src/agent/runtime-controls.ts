import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  npCreateDisabledAgentRuntimeSettingsV1,
  npRequireAgentRuntimeSettingsV1,
  type NpAgentRuntimeSettingsV1,
} from "../agent-contract/runtime-contract.js";
import {
  npRequireAgentRuntimeControlV1,
  npRequireAgentRuntimeOpsResultV1,
  npRequireAgentRuntimeReadinessV1,
  npRequireAgentRuntimeResumePlanV1,
  npRequireAgentRuntimeStatusV1,
  type NpAgentRuntimeControlV1,
  type NpAgentRuntimeOpsErrorCodeV1,
  type NpAgentRuntimeOpsResultV1,
  type NpAgentRuntimeReadinessV1,
  type NpAgentRuntimeResumePlanV1,
  type NpAgentRuntimeStatusV1,
} from "../agent-contract/runtime-ops-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { canonicalBodySha256Digest } from "../agent-contract/canonical-body-validation.js";
import { getDb } from "../db/runtime.js";
import { npAgentSiteDeletionSagas } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npSettings, npSites } from "../db/schema/system.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { npLockSiteQuotas } from "../sites/quotas.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";

const SETTINGS_KEY = "agents.runtime";
const CONTROL_KEY = "agents.runtime.control";
const PLAN_LIFETIME_MS = 300_000;
const UNAVAILABLE_READINESS: NpAgentRuntimeReadinessV1 = Object.freeze({
  doctor: "unavailable",
  policy: "unavailable",
  budget: "unavailable",
  vault: "unavailable",
  integrityKey: "unavailable",
  worker: "unavailable",
});

export class NpAgentRuntimeControlError extends Error {
  constructor(readonly code: NpAgentRuntimeOpsErrorCodeV1) {
    super(code);
    this.name = "NpAgentRuntimeControlError";
  }
}
function fail(code: NpAgentRuntimeOpsErrorCodeV1): never {
  throw new NpAgentRuntimeControlError(code);
}
function digest(domain: string, value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(domain).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}
function actor(value: unknown): string {
  try {
    return canonicalBodySha256Digest(value, "runtime.actorFingerprint");
  } catch {
    return fail("RUNTIME_AUTHORITY_REQUIRED");
  }
}
function nowValue(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("RUNTIME_STATE_INVALID");
  return value;
}
function checkedPlan(value: unknown): NpAgentRuntimeResumePlanV1 {
  try {
    const plan = npRequireAgentRuntimeResumePlanV1(value);
    const { planHash, ...body } = plan;
    if (planHash !== digest("np.agent-runtime-resume-plan.v1", body)) fail("RUNTIME_PLAN_INVALID");
    return plan;
  } catch {
    return fail("RUNTIME_PLAN_INVALID");
  }
}
export function npValidateAgentRuntimeControlStateV1(input: {
  siteId: string;
  settings: unknown;
  control: unknown;
}): boolean {
  try {
    const settings = npRequireAgentRuntimeSettingsV1(input.settings);
    const control = npRequireAgentRuntimeControlV1(input.control);
    const settingsHash = digest("np.agent-runtime-settings.v1", settings);
    if (control.currentResumePlan) {
      const plan = checkedPlan(control.currentResumePlan);
      if (
        plan.siteId !== input.siteId ||
        plan.settingsHash !== settingsHash ||
        !settings.enabled ||
        !settings.emergencyPause.paused
      )
        return false;
    }
    if (control.lastResumeReceipt) {
      const receipt = control.lastResumeReceipt;
      const plan = checkedPlan(receipt.plan);
      if (
        plan.siteId !== input.siteId ||
        receipt.revision !== control.revision ||
        receipt.settingsHash !== settingsHash ||
        settings.emergencyPause.paused
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
export interface NpAgentRuntimeControlContextV1 {
  db: ReturnType<typeof getDb>;
  siteId: string;
  settings: NpAgentRuntimeSettingsV1;
  revision: number;
  control: NpAgentRuntimeControlV1;
}

/** Shared lock order for local controls, Admin admission and runtime admission. */
export async function npWithAgentRuntimeControlTransactionV1<T>(
  siteId: string,
  operation: (context: NpAgentRuntimeControlContextV1) => Promise<T>,
  db?: ReturnType<typeof getDb>,
): Promise<T> {
  if (!npIsCanonicalSiteId(siteId)) fail("RUNTIME_ARGUMENT_INVALID");
  const run = async (tx: ReturnType<typeof getDb>): Promise<T> => {
    await npLockSiteQuotas(tx as unknown as Parameters<typeof npLockSiteQuotas>[0], siteId);
    const [site] = await tx
      .select({ id: npSites.id })
      .from(npSites)
      .where(eq(npSites.id, siteId))
      .for("share")
      .limit(1);
    const [deletion] = await tx
      .select({ id: npAgentSiteDeletionSagas.id })
      .from(npAgentSiteDeletionSagas)
      .where(eq(npAgentSiteDeletionSagas.siteId, siteId))
      .limit(1);
    if (!site || deletion) fail("RUNTIME_SITE_UNAVAILABLE");
    const rows = await tx
      .select({ key: npSettings.key, value: npSettings.value })
      .from(npSettings)
      .where(
        and(eq(npSettings.siteId, siteId), inArray(npSettings.key, [SETTINGS_KEY, CONTROL_KEY])),
      );
    const settingsRow = rows.find((row) => row.key === SETTINGS_KEY);
    const controlRow = rows.find((row) => row.key === CONTROL_KEY);
    let settings: NpAgentRuntimeSettingsV1;
    let control: NpAgentRuntimeControlV1;
    try {
      settings = settingsRow
        ? npRequireAgentRuntimeSettingsV1(settingsRow.value)
        : npCreateDisabledAgentRuntimeSettingsV1();
      control = controlRow
        ? npRequireAgentRuntimeControlV1(controlRow.value)
        : { revision: 1, currentResumePlan: null, lastResumeReceipt: null };
      if (control.currentResumePlan) checkedPlan(control.currentResumePlan);
      if (control.lastResumeReceipt) checkedPlan(control.lastResumeReceipt.plan);
      if (!settingsRow && controlRow) fail("RUNTIME_STATE_INVALID");
      if (!npValidateAgentRuntimeControlStateV1({ siteId, settings, control }))
        fail("RUNTIME_STATE_INVALID");
    } catch {
      return fail("RUNTIME_STATE_INVALID");
    }
    return operation({ db: tx, siteId, settings, revision: control.revision, control });
  };
  return db ? run(db) : getDb().transaction((tx) => run(tx as ReturnType<typeof getDb>));
}

export interface NpAgentRuntimeReadinessEvidenceV1 {
  checks: NpAgentRuntimeReadinessV1;
  fingerprint: string;
}
export interface NpAgentRuntimeControlsOptionsV1 {
  /** Trusted local deployment authority. Never resolved from an HTTP request or MCP token. */
  deploymentActorFingerprint?: string;
  readiness?: (
    context: Pick<NpAgentRuntimeControlContextV1, "db" | "siteId" | "settings"> & {
      signal: AbortSignal;
    },
  ) => Promise<NpAgentRuntimeReadinessEvidenceV1>;
  now?: () => Date;
}
interface MutationInput {
  db: ReturnType<typeof getDb>;
  siteId: string;
  expectedRevision: number;
  actorFingerprint: string;
}
export interface NpAgentRuntimeControlsV1 {
  requireDependenciesReadyInTransaction(input: {
    db: ReturnType<typeof getDb>;
    siteId: string;
  }): Promise<void>;
  requireReadyInTransaction(input: { db: ReturnType<typeof getDb>; siteId: string }): Promise<void>;
  status(input: { siteId: string }): Promise<NpAgentRuntimeOpsResultV1>;
  pause(input: { siteId: string; reason: string }): Promise<NpAgentRuntimeOpsResultV1>;
  prepareResume(input: { siteId: string }): Promise<NpAgentRuntimeOpsResultV1>;
  resume(input: {
    siteId: string;
    plan: NpAgentRuntimeResumePlanV1;
    approval: string;
  }): Promise<NpAgentRuntimeOpsResultV1>;
  updateInTransaction(
    input: MutationInput & { settings: NpAgentRuntimeSettingsV1 },
  ): Promise<NpAgentRuntimeStatusV1>;
  pauseInTransaction(input: MutationInput & { reason: string }): Promise<NpAgentRuntimeStatusV1>;
  resumeInTransaction(
    input: MutationInput & { plan: NpAgentRuntimeResumePlanV1; approval: string },
  ): Promise<NpAgentRuntimeStatusV1>;
  resumeAfterStaffAdmissionInTransaction(
    input: MutationInput & { reason: string },
  ): Promise<NpAgentRuntimeStatusV1>;
}

/** Explicit construction only. It creates neither an Agent, worker, nor provider adapter. */
export function createAgentRuntimeControlsV1(
  options: NpAgentRuntimeControlsOptionsV1 = {},
): NpAgentRuntimeControlsV1 {
  const now = options.now ?? (() => new Date());
  if (options.deploymentActorFingerprint !== undefined) actor(options.deploymentActorFingerprint);
  const localActor = () => actor(options.deploymentActorFingerprint);
  const readiness = async (
    context: NpAgentRuntimeControlContextV1,
  ): Promise<{ checks: NpAgentRuntimeReadinessV1; fingerprint: string | null }> => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!options.readiness) return { checks: { ...UNAVAILABLE_READINESS }, fingerprint: null };
      const evidence = await Promise.race([
        options.readiness({
          db: context.db,
          siteId: context.siteId,
          settings: context.settings,
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("RUNTIME_READINESS_BLOCKED"));
          }, 5000);
        }),
      ]);
      if (!evidence || Object.keys(evidence).sort().join(",") !== "checks,fingerprint")
        throw new Error("RUNTIME_READINESS_BLOCKED");
      return {
        checks: npRequireAgentRuntimeReadinessV1(evidence.checks),
        fingerprint: canonicalBodySha256Digest(
          evidence.fingerprint,
          "runtime.readinessFingerprint",
        ),
      };
    } catch {
      return { checks: { ...UNAVAILABLE_READINESS }, fingerprint: null };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
  const status = async (context: NpAgentRuntimeControlContextV1): Promise<NpAgentRuntimeStatusV1> =>
    npRequireAgentRuntimeStatusV1({
      schemaVersion: "np.agent-runtime-status.v1",
      siteId: context.siteId,
      revision: context.revision,
      enabled: context.settings.enabled,
      paused: context.settings.emergencyPause.paused,
      readiness: (await readiness(context)).checks,
      generatedAt: nowValue(now).toISOString(),
    });
  const requireDependenciesReady = async (
    context: NpAgentRuntimeControlContextV1,
  ): Promise<NpAgentRuntimeReadinessEvidenceV1> => {
    const evidence = await readiness(context);
    if (
      evidence.fingerprint === null ||
      Object.values(evidence.checks).some((value) => value !== "ready" && value !== "not-required")
    )
      fail("RUNTIME_READINESS_BLOCKED");
    return { checks: evidence.checks, fingerprint: evidence.fingerprint };
  };
  const assertRevision = (context: NpAgentRuntimeControlContextV1, expected: number): void => {
    if (!Number.isSafeInteger(expected) || expected < 1 || context.revision !== expected)
      fail("RUNTIME_REVISION_CONFLICT");
  };
  const write = async (
    context: NpAgentRuntimeControlContextV1,
    settings: NpAgentRuntimeSettingsV1,
    control: NpAgentRuntimeControlV1,
  ): Promise<void> => {
    npAssertAgentPreviewEffectsAllowed();
    const updatedAt = nowValue(now);
    const checkedSettings = npRequireAgentRuntimeSettingsV1(settings);
    const checkedControl = npRequireAgentRuntimeControlV1(control);
    for (const [key, value] of [
      [SETTINGS_KEY, checkedSettings],
      [CONTROL_KEY, checkedControl],
    ] as const) {
      await context.db
        .insert(npSettings)
        .values({ siteId: context.siteId, key, value, updatedAt, updatedBy: null })
        .onConflictDoUpdate({
          target: [npSettings.siteId, npSettings.key],
          set: { value, updatedAt, updatedBy: null },
        });
    }
    context.settings = checkedSettings;
    context.control = checkedControl;
    context.revision = checkedControl.revision;
  };
  const nextRevision = (context: NpAgentRuntimeControlContextV1): number => {
    if (context.revision >= 2_147_483_647) fail("RUNTIME_REVISION_CONFLICT");
    return context.revision + 1;
  };
  const reason = (value: string): string => {
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > 2000 ||
      value.trim() !== value ||
      [...value].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      fail("RUNTIME_ARGUMENT_INVALID");
    return digest("np.agent-runtime-pause-reason.v1", value);
  };
  const audit = async (
    context: NpAgentRuntimeControlContextV1,
    operation: string,
    actorFingerprint: string,
    evidence: Record<string, unknown> = {},
  ): Promise<void> => {
    await context.db.insert(npAuditEvents).values({
      siteId: context.siteId,
      actorKind: "system",
      actorUserId: null,
      actorMemberId: null,
      action: operation,
      targetType: "agent-runtime",
      targetId: context.siteId,
      createdAt: nowValue(now),
      payload: { actorFingerprint, revision: context.revision, ...evidence },
    });
  };
  const pause = async (
    context: NpAgentRuntimeControlContextV1,
    actorFingerprint: string,
    text: string,
  ): Promise<boolean> => {
    actor(actorFingerprint);
    reason(text);
    if (context.settings.emergencyPause.paused && context.control.currentResumePlan === null)
      return false;
    await write(
      context,
      {
        ...context.settings,
        emergencyPause: {
          paused: true,
          reasonCode: "OPERATOR_REQUESTED",
          actorFingerprint,
          changedAt: nowValue(now).toISOString(),
        },
      },
      { revision: nextRevision(context), currentResumePlan: null, lastResumeReceipt: null },
    );
    return true;
  };
  const resume = async (
    context: NpAgentRuntimeControlContextV1,
    actorFingerprint: string,
    input: { plan: NpAgentRuntimeResumePlanV1; approval: string },
  ): Promise<void> => {
    actor(actorFingerprint);
    const plan = checkedPlan(input.plan);
    if (plan.siteId !== context.siteId || plan.actorFingerprint !== actorFingerprint)
      fail("RUNTIME_PLAN_INVALID");
    if (input.approval !== plan.id) fail("RUNTIME_APPROVAL_REQUIRED");
    const receipt = context.control.lastResumeReceipt;
    if (
      receipt &&
      receipt.plan.id === plan.id &&
      receipt.plan.planHash === plan.planHash &&
      receipt.revision === context.revision &&
      receipt.settingsHash === digest("np.agent-runtime-settings.v1", context.settings)
    )
      return;
    const stored = context.control.currentResumePlan;
    if (
      !stored ||
      stored.id !== plan.id ||
      stored.planHash !== plan.planHash ||
      context.revision !== plan.revision ||
      digest("np.agent-runtime-settings.v1", context.settings) !== plan.settingsHash
    )
      fail("RUNTIME_PLAN_INVALID");
    const time = nowValue(now);
    if (time.getTime() < Date.parse(plan.issuedAt) || time.getTime() >= Date.parse(plan.expiresAt))
      fail("RUNTIME_PLAN_EXPIRED");
    const currentReadiness = await requireDependenciesReady(context);
    if (currentReadiness.fingerprint !== plan.readinessFingerprint)
      fail("RUNTIME_READINESS_BLOCKED");
    if (!context.settings.enabled || !context.settings.emergencyPause.paused)
      fail("RUNTIME_STATE_INVALID");
    const settings: NpAgentRuntimeSettingsV1 = {
      ...context.settings,
      emergencyPause: { paused: false, reasonCode: null, actorFingerprint: null, changedAt: null },
    };
    const revision = nextRevision(context);
    await write(context, settings, {
      revision,
      currentResumePlan: null,
      lastResumeReceipt: {
        plan,
        revision,
        settingsHash: digest("np.agent-runtime-settings.v1", settings),
        completedAt: time.toISOString(),
      },
    });
  };
  const result = (
    operation: NpAgentRuntimeOpsResultV1["operation"],
    state: NpAgentRuntimeStatusV1,
    plan: NpAgentRuntimeResumePlanV1 | null = null,
  ): NpAgentRuntimeOpsResultV1 =>
    npRequireAgentRuntimeOpsResultV1({
      schemaVersion: "np.agent-runtime-ops.v1",
      operation,
      outcome: { status: "status", pause: "paused", "resume-plan": "planned", resume: "resumed" }[
        operation
      ],
      errorCode: null,
      status: state,
      plan,
    });
  return {
    requireDependenciesReadyInTransaction: (input) =>
      npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async (context) => {
          await requireDependenciesReady(context);
        },
        input.db,
      ),
    requireReadyInTransaction: (input) =>
      npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async (context) => {
          if (!context.settings.enabled || context.settings.emergencyPause.paused)
            fail("RUNTIME_READINESS_BLOCKED");
          await requireDependenciesReady(context);
        },
        input.db,
      ),
    status: ({ siteId }) => {
      localActor();
      return npWithAgentRuntimeControlTransactionV1(siteId, async (context) =>
        result("status", await status(context)),
      );
    },
    pause: ({ siteId, reason: text }) => {
      const actorFingerprint = localActor();
      return npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
        if (await pause(context, actorFingerprint, text))
          await audit(context, "agent.runtime.paused", actorFingerprint, {
            reasonFingerprint: reason(text),
          });
        return result("pause", await status(context));
      });
    },
    prepareResume: ({ siteId }) => {
      const actorFingerprint = localActor();
      return npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
        const evidence = await requireDependenciesReady(context);
        const state = npRequireAgentRuntimeStatusV1({
          schemaVersion: "np.agent-runtime-status.v1",
          siteId,
          revision: context.revision,
          enabled: context.settings.enabled,
          paused: context.settings.emergencyPause.paused,
          readiness: evidence.checks,
          generatedAt: nowValue(now).toISOString(),
        });
        if (!context.settings.enabled || !context.settings.emergencyPause.paused)
          fail("RUNTIME_STATE_INVALID");
        const time = nowValue(now);
        const settingsHash = digest("np.agent-runtime-settings.v1", context.settings);
        const readinessFingerprint = evidence.fingerprint;
        const existing = context.control.currentResumePlan;
        if (
          existing &&
          existing.actorFingerprint === actorFingerprint &&
          existing.settingsHash === settingsHash &&
          existing.readinessFingerprint === readinessFingerprint &&
          Date.parse(existing.expiresAt) > time.getTime() &&
          Date.parse(existing.issuedAt) <= time.getTime()
        )
          return result("resume-plan", state, existing);
        const body = {
          schemaVersion: "np.agent-runtime-resume-plan.v1" as const,
          id: randomUUID(),
          siteId,
          actorFingerprint,
          revision: context.revision,
          settingsHash,
          readinessFingerprint,
          issuedAt: time.toISOString(),
          expiresAt: new Date(time.getTime() + PLAN_LIFETIME_MS).toISOString(),
        };
        const plan = checkedPlan({
          ...body,
          planHash: digest("np.agent-runtime-resume-plan.v1", body),
        });
        await write(context, context.settings, {
          revision: context.revision,
          currentResumePlan: plan,
          lastResumeReceipt: null,
        });
        await audit(context, "agent.runtime.resume_planned", actorFingerprint, {
          planId: plan.id,
          planHash: plan.planHash,
        });
        return result("resume-plan", state, plan);
      });
    },
    resume: ({ siteId, plan, approval }) => {
      const actorFingerprint = localActor();
      return npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
        const before = context.revision;
        await resume(context, actorFingerprint, { plan, approval });
        if (context.revision !== before)
          await audit(context, "agent.runtime.resumed", actorFingerprint, {
            planId: plan.id,
            planHash: plan.planHash,
          });
        return result("resume", await status(context));
      });
    },
    updateInTransaction: (input) =>
      npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async (context) => {
          actor(input.actorFingerprint);
          assertRevision(context, input.expectedRevision);
          const settings = npRequireAgentRuntimeSettingsV1(input.settings);
          // A general configuration edit cannot clear emergency containment.
          if (
            JSON.stringify(settings.emergencyPause) !==
            JSON.stringify(context.settings.emergencyPause)
          )
            fail("RUNTIME_STATE_INVALID");
          await write(context, settings, {
            revision: nextRevision(context),
            currentResumePlan: null,
            lastResumeReceipt: null,
          });
          return status(context);
        },
        input.db,
      ),
    pauseInTransaction: (input) =>
      npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async (context) => {
          assertRevision(context, input.expectedRevision);
          await pause(context, input.actorFingerprint, input.reason);
          return status(context);
        },
        input.db,
      ),
    resumeInTransaction: (input) =>
      npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async (context) => {
          assertRevision(context, input.expectedRevision);
          await resume(context, input.actorFingerprint, input);
          return status(context);
        },
        input.db,
      ),
    resumeAfterStaffAdmissionInTransaction: (input) =>
      npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async (context) => {
          actor(input.actorFingerprint);
          reason(input.reason);
          assertRevision(context, input.expectedRevision);
          await requireDependenciesReady(context);
          if (!context.settings.enabled || !context.settings.emergencyPause.paused)
            fail("RUNTIME_STATE_INVALID");
          await write(
            context,
            {
              ...context.settings,
              emergencyPause: {
                paused: false,
                reasonCode: null,
                actorFingerprint: null,
                changedAt: null,
              },
            },
            { revision: nextRevision(context), currentResumePlan: null, lastResumeReceipt: null },
          );
          return status(context);
        },
        input.db,
      ),
  };
}
