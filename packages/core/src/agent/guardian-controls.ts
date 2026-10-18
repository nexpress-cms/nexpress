import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npSettings, npSites } from "../db/schema/system.js";
import { npAgentSiteDeletionSagas } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npLockSiteQuotas } from "../sites/quotas.js";
import {
  canonicalBodyInteger,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
} from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1,
  NP_AGENT_GUARDIAN_ENABLE_PLAN_LIFETIME_MS_V1,
  npRequireAgentGuardianCaptureAdmissionV1,
  npRequireAgentGuardianControlOpsResultV1,
  npRequireAgentGuardianControlStatusV1,
  npRequireAgentGuardianControlV1,
  npRequireAgentGuardianEnablePlanV1,
  type NpAgentGuardianCaptureAdmissionV1,
  type NpAgentGuardianControlErrorCodeV1,
  type NpAgentGuardianControlOpsResultV1,
  type NpAgentGuardianControlStatusV1,
  type NpAgentGuardianControlV1,
  type NpAgentGuardianEnablePlanV1,
} from "../agent-contract/guardian-controls-contract.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";

type Db = ReturnType<typeof getDb>;
export class NpAgentGuardianControlError extends Error {
  constructor(readonly code: NpAgentGuardianControlErrorCodeV1) {
    super(code);
    this.name = "NpAgentGuardianControlError";
  }
}
function fail(code: NpAgentGuardianControlErrorCodeV1): never {
  throw new NpAgentGuardianControlError(code);
}
const digest = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(domain).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
interface Context {
  db: Db;
  siteId: string;
  control: NpAgentGuardianControlV1 | null;
}
export interface NpAgentGuardianControlRegistrationV1 {
  sourceCount: number;
  ready: boolean;
  fingerprint: string;
}
export interface NpAgentGuardianControlsOptionsV1 {
  /** Existing trusted local deployment authority; never an HTTP/MCP input. */
  deploymentActorFingerprint?: string;
  /** Local installed capture owners and their current keys/gate coverage, never provider/worker readiness.
   * Honor the signal. This call creates or loads no installation/credentials. */
  registration?(input: {
    db: Db;
    siteId: string;
    signal: AbortSignal;
  }): Promise<NpAgentGuardianControlRegistrationV1>;
  now?: () => Date;
}
export interface NpAgentGuardianControlsV1 {
  /** Plain same-TX read, no Runtime/quota/Agent/reference locks. Intentional disable is a normal skip.
   * Call only from an explicitly host-installed source. Its source facts may outlive disable. */
  readCaptureAdmission(input: {
    db: Db;
    siteId: string;
    sourceInstalled: boolean;
  }): Promise<NpAgentGuardianCaptureAdmissionV1>;
  /** Additional guard only; grants no response authority. Caller still owns its existing lock,
   * current policy/ACL/admission/approval and must bind this revision/digest for NEW effects. */
  requireNewResponseAdmission(input: {
    db: Db;
    siteId: string;
    sourceInstalled: boolean;
    expectedControlRevision?: number;
  }): Promise<NpAgentGuardianCaptureAdmissionV1>;
  /** Caller separately owns current viewer/site authorization. */
  statusInTransaction(input: { db: Db; siteId: string }): Promise<NpAgentGuardianControlStatusV1>;
  status(input: { siteId: string }): Promise<NpAgentGuardianControlOpsResultV1>;
  disable(input: { siteId: string; reason: string }): Promise<NpAgentGuardianControlOpsResultV1>;
  prepareEnable(input: { siteId: string }): Promise<NpAgentGuardianControlOpsResultV1>;
  enable(input: {
    siteId: string;
    plan: NpAgentGuardianEnablePlanV1;
    approval: string;
  }): Promise<NpAgentGuardianControlOpsResultV1>;
}
function stateDigest(siteId: string, control: NpAgentGuardianControlV1 | null): string {
  return digest("np.agent-guardian-control-state.v1", {
    siteId,
    configured: control !== null,
    revision: control?.revision ?? 0,
    enabled: control?.enabled ?? true,
  });
}
function checkedPlan(value: unknown): NpAgentGuardianEnablePlanV1 {
  try {
    const plan = npRequireAgentGuardianEnablePlanV1(value);
    const { planHash, ...body } = plan;
    if (planHash !== digest("np.agent-guardian-enable-plan.v1", body))
      fail("GUARDIAN_PLAN_INVALID");
    return plan;
  } catch {
    return fail("GUARDIAN_PLAN_INVALID");
  }
}
/** Pure retained control integrity check shared with preboot Doctor. No enable authority is granted. */
export function npValidateAgentGuardianControlStateV1(input: {
  siteId: string;
  control: unknown;
}): boolean {
  try {
    canonicalBodySiteId(input.siteId, "guardian.controls.siteId");
    const control = npRequireAgentGuardianControlV1(input.control);
    if (control.currentEnablePlan) {
      const plan = checkedPlan(control.currentEnablePlan);
      if (plan.siteId !== input.siteId || plan.controlDigest !== stateDigest(input.siteId, control))
        return false;
    }
    if (control.lastEnableReceipt) {
      const plan = checkedPlan(control.lastEnableReceipt.plan);
      if (
        plan.siteId !== input.siteId ||
        plan.controlDigest !==
          stateDigest(input.siteId, {
            ...control,
            revision: plan.revision,
            enabled: false,
            currentEnablePlan: null,
            lastEnableReceipt: null,
          })
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
function requireSite(siteId: string): string {
  try {
    return canonicalBodySiteId(siteId, "guardian.controls.siteId");
  } catch {
    return fail("GUARDIAN_ARGUMENT_INVALID");
  }
}
function readRetainedControl(
  siteId: string,
  row: { value: unknown } | undefined,
): NpAgentGuardianControlV1 | null {
  if (row === undefined) return null;
  try {
    const control = npRequireAgentGuardianControlV1(row.value);
    if (!npValidateAgentGuardianControlStateV1({ siteId, control })) fail("GUARDIAN_STATE_INVALID");
    return control;
  } catch {
    return fail("GUARDIAN_STATE_INVALID");
  }
}
function captureAdmission(
  siteId: string,
  control: NpAgentGuardianControlV1 | null,
): NpAgentGuardianCaptureAdmissionV1 {
  return npRequireAgentGuardianCaptureAdmissionV1({
    schemaVersion: "np.agent-guardian-capture-admission.v1",
    state: control ? (control.enabled ? "enabled" : "disabled") : "enabled-by-registration",
    reason: control
      ? control.enabled
        ? "OPERATOR_ENABLED"
        : "OPERATOR_DISABLED"
      : "HOST_REGISTRATION",
    configured: control !== null,
    revision: control?.revision ?? 0,
    controlDigest: stateDigest(siteId, control),
  });
}
/** Internal row projection only. The caller owns a fresh same-site settings read,
 * current source installation and admission locks; this helper grants no authority. */
export function npReadAgentGuardianCaptureAdmissionFromRetainedRowV1(
  siteId: string,
  row: { value: unknown } | undefined,
): NpAgentGuardianCaptureAdmissionV1 {
  requireSite(siteId);
  return captureAdmission(siteId, readRetainedControl(siteId, row));
}
/** Standalone local controls. No Runtime settings parsing, provider, worker, source registration or response activation. */
export function createAgentGuardianControlsV1(
  options: NpAgentGuardianControlsOptionsV1 = {},
): NpAgentGuardianControlsV1 {
  if (
    (options.registration !== undefined && typeof options.registration !== "function") ||
    (options.now !== undefined && typeof options.now !== "function")
  )
    fail("GUARDIAN_ARGUMENT_INVALID");
  const now = options.now ?? (() => new Date()),
    registration = options.registration?.bind(options);
  const deploymentActorFingerprint = options.deploymentActorFingerprint;
  const clock = () => {
    const time = now();
    if (!(time instanceof Date) || !Number.isFinite(time.getTime())) fail("GUARDIAN_STATE_INVALID");
    return new Date(time);
  };
  const actor = () => {
    try {
      return canonicalBodySha256Digest(deploymentActorFingerprint, "guardian.controls.actor");
    } catch {
      return fail("GUARDIAN_AUTHORITY_REQUIRED");
    }
  };
  if (options.deploymentActorFingerprint !== undefined) actor();
  const site = requireSite;
  const read = async (db: Db, siteId: string): Promise<Context> => {
    site(siteId);
    const [row] = await db
      .select({ value: npSettings.value })
      .from(npSettings)
      .where(
        and(
          eq(npSettings.siteId, siteId),
          eq(npSettings.key, NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1),
        ),
      )
      .limit(1);
    return { db, siteId, control: readRetainedControl(siteId, row) };
  };
  const snapshot = async (
    context: Context,
  ): Promise<NpAgentGuardianControlRegistrationV1 | null> => {
    if (!registration) return null;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        registration({ db: context.db, siteId: context.siteId, signal: controller.signal }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("Guardian registration unavailable"));
          }, 5000);
        }),
      ]);
      if (
        !value ||
        Object.keys(value).sort().join(",") !== "fingerprint,ready,sourceCount" ||
        typeof value.ready !== "boolean"
      )
        return null;
      return {
        sourceCount: canonicalBodyInteger(
          value.sourceCount,
          "guardian.controls.sourceCount",
          0,
          10000,
        ),
        ready: value.ready,
        fingerprint: canonicalBodySha256Digest(
          value.fingerprint,
          "guardian.controls.registrationFingerprint",
        ),
      };
    } catch {
      return null;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
  const status = async (context: Context): Promise<NpAgentGuardianControlStatusV1> => {
    const registered = await snapshot(context);
    const capture =
      context.control?.enabled === false
        ? "disabled"
        : !registered
          ? "unavailable"
          : registered.sourceCount === 0
            ? "disabled"
            : context.control
              ? "enabled"
              : "enabled-by-registration";
    return npRequireAgentGuardianControlStatusV1({
      schemaVersion: "np.agent-guardian-control-status.v1",
      siteId: context.siteId,
      configured: context.control !== null,
      revision: context.control?.revision ?? 0,
      capture,
      registration: {
        state: registered ? (registered.sourceCount > 0 ? "registered" : "absent") : "unavailable",
        sourceCount: registered?.sourceCount ?? null,
        readiness: registered ? (registered.ready ? "ready" : "blocked") : "unavailable",
      },
      response: "separate-policy-required",
      generatedAt: clock().toISOString(),
    });
  };
  const readCaptureAdmission = async (input: {
    db: Db;
    siteId: string;
    sourceInstalled: boolean;
  }): Promise<NpAgentGuardianCaptureAdmissionV1> => {
    site(input.siteId);
    if (typeof input.sourceInstalled !== "boolean") fail("GUARDIAN_ARGUMENT_INVALID");
    if (!input.sourceInstalled)
      return npRequireAgentGuardianCaptureAdmissionV1({
        schemaVersion: "np.agent-guardian-capture-admission.v1",
        state: "disabled",
        reason: "SOURCE_ABSENT",
        configured: null,
        revision: null,
        controlDigest: null,
      });
    let context: Context;
    try {
      context = await read(input.db, input.siteId);
    } catch (error) {
      if (error instanceof NpAgentGuardianControlError) throw error;
      return fail("GUARDIAN_UNAVAILABLE");
    }
    return captureAdmission(input.siteId, context.control);
  };
  const transaction = async <T>(
    siteId: string,
    work: (context: Context) => Promise<T>,
  ): Promise<T> => {
    site(siteId);
    npAssertAgentPreviewEffectsAllowed();
    return getDb().transaction(async (tx) => {
      const db = tx as Db;
      const settings = await db.execute(
        sql`select extract(epoch from current_setting('statement_timeout')::interval)*1000 as statement_ms,extract(epoch from current_setting('lock_timeout')::interval)*1000 as lock_ms`,
      );
      const statement = Number(settings.rows[0]?.statement_ms),
        lock = Number(settings.rows[0]?.lock_ms);
      if (!Number.isFinite(statement) || statement < 0 || !Number.isFinite(lock) || lock < 0)
        fail("GUARDIAN_UNAVAILABLE");
      await db.execute(
        sql`select set_config('statement_timeout',${`${Math.min(statement || 500, 500)}ms`},true),set_config('lock_timeout',${`${Math.min(lock || 100, 100)}ms`},true)`,
      );
      await npLockSiteQuotas(db as unknown as Parameters<typeof npLockSiteQuotas>[0], siteId);
      const [siteRow] = await db
        .select({ id: npSites.id })
        .from(npSites)
        .where(eq(npSites.id, siteId))
        .for("share")
        .limit(1);
      const [deleting] = await db
        .select({ id: npAgentSiteDeletionSagas.id })
        .from(npAgentSiteDeletionSagas)
        .where(eq(npAgentSiteDeletionSagas.siteId, siteId))
        .limit(1);
      if (!siteRow || deleting) fail("GUARDIAN_SITE_UNAVAILABLE");
      return work(await read(db, siteId));
    });
  };
  const next = (context: Context) => {
    const value = context.control?.revision ?? 0;
    if (value >= 2147483647) fail("GUARDIAN_REVISION_CONFLICT");
    return value + 1;
  };
  const write = async (context: Context, value: NpAgentGuardianControlV1) => {
    const control = npRequireAgentGuardianControlV1(value),
      time = clock();
    await context.db
      .insert(npSettings)
      .values({
        siteId: context.siteId,
        key: NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1,
        value: control,
        updatedAt: time,
        updatedBy: null,
      })
      .onConflictDoUpdate({
        target: [npSettings.siteId, npSettings.key],
        set: { value: control, updatedAt: time, updatedBy: null },
      });
    context.control = control;
  };
  const audit = async (
    context: Context,
    action: string,
    actorFingerprint: string,
    details: Record<string, string | number> = {},
  ) => {
    await context.db.insert(npAuditEvents).values({
      siteId: context.siteId,
      actorKind: "system",
      actorUserId: null,
      actorMemberId: null,
      action,
      targetType: "agent-guardian-control",
      targetId: context.siteId,
      createdAt: clock(),
      payload: { actorFingerprint, revision: context.control?.revision ?? 0, ...details },
    });
  };
  const result = async (
    operation: NpAgentGuardianControlOpsResultV1["operation"],
    context: Context,
    plan: NpAgentGuardianEnablePlanV1 | null = null,
  ) =>
    npRequireAgentGuardianControlOpsResultV1({
      schemaVersion: "np.agent-guardian-control-ops.v1",
      operation,
      outcome: (
        {
          status: "status",
          disable: "disabled",
          "enable-plan": "planned",
          enable: "enabled",
        } as const
      )[operation],
      errorCode: null,
      status: await status(context),
      plan,
    });
  const local = async (
    operation: NpAgentGuardianControlOpsResultV1["operation"],
    siteId: string,
    work: (
      context: Context,
      actorFingerprint: string,
    ) => Promise<NpAgentGuardianControlOpsResultV1>,
  ): Promise<NpAgentGuardianControlOpsResultV1> => {
    try {
      const fingerprint = actor();
      return await transaction(siteId, (context) => work(context, fingerprint));
    } catch (error) {
      return npRequireAgentGuardianControlOpsResultV1({
        schemaVersion: "np.agent-guardian-control-ops.v1",
        operation,
        outcome: "blocked",
        errorCode:
          error instanceof NpAgentGuardianControlError ? error.code : "GUARDIAN_UNAVAILABLE",
        status: null,
        plan: null,
      });
    }
  };
  const ready = async (context: Context) => {
    const value = await snapshot(context);
    if (!value || !value.ready) fail("GUARDIAN_READINESS_BLOCKED");
    if (value.sourceCount < 1) fail("GUARDIAN_SOURCE_ABSENT");
    return value;
  };
  const registrationBinding = (value: NpAgentGuardianControlRegistrationV1) =>
    digest("np.agent-guardian-control-registration.v1", value);
  return {
    readCaptureAdmission,
    async requireNewResponseAdmission(input) {
      const value = await readCaptureAdmission(input);
      if (value.state === "disabled")
        fail(value.reason === "SOURCE_ABSENT" ? "GUARDIAN_SOURCE_ABSENT" : "GUARDIAN_DISABLED");
      if (
        input.expectedControlRevision !== undefined &&
        input.expectedControlRevision !== value.revision
      )
        fail("GUARDIAN_REVISION_CONFLICT");
      return value;
    },
    statusInTransaction: async (input) => {
      try {
        return await status(await read(input.db, input.siteId));
      } catch (error) {
        if (error instanceof NpAgentGuardianControlError) throw error;
        return fail("GUARDIAN_UNAVAILABLE");
      }
    },
    status: (input) => local("status", input.siteId, (context) => result("status", context)),
    disable: (input) =>
      local("disable", input.siteId, async (context, fingerprint) => {
        if (
          typeof input.reason !== "string" ||
          input.reason.length < 1 ||
          input.reason.length > 2000 ||
          input.reason.trim() !== input.reason ||
          /[\p{Cc}\p{Cs}]/u.test(input.reason)
        )
          fail("GUARDIAN_ARGUMENT_INVALID");
        if (context.control?.enabled !== false || context.control.currentEnablePlan !== null) {
          await write(context, {
            schemaVersion: "np.agent-guardian-control.v1",
            revision: next(context),
            enabled: false,
            currentEnablePlan: null,
            lastEnableReceipt: null,
          });
          await audit(context, "agent.guardian.disabled", fingerprint, {
            reasonDigest: digest("np.agent-guardian-disable-reason.v1", input.reason),
          });
        }
        return result("disable", context);
      }),
    prepareEnable: (input) =>
      local("enable-plan", input.siteId, async (context, fingerprint) => {
        if (!context.control || context.control.enabled) fail("GUARDIAN_NOT_DISABLED");
        const registration = await ready(context),
          time = clock(),
          number = next(context);
        const disabled: NpAgentGuardianControlV1 = {
          schemaVersion: "np.agent-guardian-control.v1",
          revision: number,
          enabled: false,
          currentEnablePlan: null,
          lastEnableReceipt: null,
        };
        const body = {
          schemaVersion: "np.agent-guardian-enable-plan.v1" as const,
          id: randomUUID(),
          siteId: context.siteId,
          actorFingerprint: fingerprint,
          revision: number,
          controlDigest: stateDigest(context.siteId, disabled),
          registrationFingerprint: registrationBinding(registration),
          issuedAt: time.toISOString(),
          expiresAt: new Date(
            time.getTime() + NP_AGENT_GUARDIAN_ENABLE_PLAN_LIFETIME_MS_V1,
          ).toISOString(),
        };
        const plan = checkedPlan({
          ...body,
          planHash: digest("np.agent-guardian-enable-plan.v1", body),
        });
        await write(context, { ...disabled, currentEnablePlan: plan });
        await audit(context, "agent.guardian.enable_planned", fingerprint, {
          planId: plan.id,
          planHash: plan.planHash,
        });
        return result("enable-plan", context, plan);
      }),
    enable: (input) =>
      local("enable", input.siteId, async (context, fingerprint) => {
        const plan = checkedPlan(input.plan);
        if (
          plan.siteId !== context.siteId ||
          plan.actorFingerprint !== fingerprint ||
          input.approval !== plan.id
        )
          fail("GUARDIAN_PLAN_INVALID");
        if (
          context.control?.lastEnableReceipt &&
          same(context.control.lastEnableReceipt.plan, plan)
        )
          return result("enable", context);
        const control = context.control;
        if (
          !control ||
          control.enabled ||
          control.revision !== plan.revision ||
          !same(control.currentEnablePlan, plan) ||
          plan.controlDigest !== stateDigest(context.siteId, control)
        )
          fail("GUARDIAN_PLAN_INVALID");
        let time = clock();
        if (
          time.getTime() < Date.parse(plan.issuedAt) ||
          time.getTime() >= Date.parse(plan.expiresAt)
        )
          fail("GUARDIAN_PLAN_EXPIRED");
        const registration = await ready(context);
        if (registrationBinding(registration) !== plan.registrationFingerprint)
          fail("GUARDIAN_READINESS_BLOCKED");
        time = clock();
        if (
          time.getTime() < Date.parse(plan.issuedAt) ||
          time.getTime() >= Date.parse(plan.expiresAt)
        )
          fail("GUARDIAN_PLAN_EXPIRED");
        const number = next(context);
        await write(context, {
          schemaVersion: "np.agent-guardian-control.v1",
          revision: number,
          enabled: true,
          currentEnablePlan: null,
          lastEnableReceipt: { plan, revision: number, completedAt: time.toISOString() },
        });
        await audit(context, "agent.guardian.enabled", fingerprint, {
          planId: plan.id,
          planHash: plan.planHash,
        });
        return result("enable", context);
      }),
  };
}
