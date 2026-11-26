import type { getDb } from "../db/runtime.js";
import type {
  npAgentActions,
  npAgentRuns,
  npAgentProviderCalls,
  npAgentUsageReservations,
} from "../db/schema/agent.js";
import { canonicalBodyCapabilityId } from "../agent-contract/canonical-body-validation.js";
import type { NpAgentGuardianRuntimeFactV1 } from "../agent-contract/guardian-runtime-contract.js";
import type { NpAgentCapabilityId, NpAgentScope } from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";

type Db = ReturnType<typeof getDb>;
type Run = typeof npAgentRuns.$inferSelect;
type Action = typeof npAgentActions.$inferSelect;
export interface NpAgentGuardianRuntimeObservationV1 {
  db: Db;
  run: Run;
  occurredAt: Date;
  fact: NpAgentGuardianRuntimeFactV1;
  /** Actual owning accounting rows; private, never signed or projected. */
  accountingSource?: {
    call: typeof npAgentProviderCalls.$inferSelect;
    reservation: typeof npAgentUsageReservations.$inferSelect;
    responseDigest: string | null;
  };
}
export interface NpAgentGuardianRuntimeObserverV1 {
  record(input: NpAgentGuardianRuntimeObservationV1): Promise<void>;
}
let installed: NpAgentGuardianRuntimeObserverV1 | undefined;
const observationFailures = new WeakSet<object>();
export function npIsAgentRuntimeObservationFailureV1(error: unknown): boolean {
  return typeof error === "object" && error !== null && observationFailures.has(error);
}
async function record(
  observer: NpAgentGuardianRuntimeObserverV1,
  input: NpAgentGuardianRuntimeObservationV1,
): Promise<void> {
  try {
    await observer.record(input);
  } catch (cause) {
    if (npIsAgentRuntimeObservationFailureV1(cause)) throw cause;
    const error = new NpAgentGatewayError(
      "GUARDIAN_RUNTIME_SOURCE_INVALID",
      409,
      "Runtime source evidence is unavailable.",
    );
    observationFailures.add(error);
    throw error;
  }
}
type TerminalFact = Extract<
  NpAgentGuardianRuntimeFactV1,
  { kind: "proposal-repeated" | "scope-denied" }
>;
export interface NpAgentGuardianRuntimeTerminalObservationV1 {
  readonly kind: "np.guardian-runtime-terminal-observation.v1";
}
const terminalFacts = new WeakMap<NpAgentGuardianRuntimeTerminalObservationV1, TerminalFact>();
const scopeDenials = new WeakMap<
  object,
  { capabilityId: NpAgentCapabilityId; missingScopes: NpAgentScope[] }
>();
/** Private executor/store carrier; never a transport argument. */
export function npCreateAgentRuntimeTerminalObservationV1(
  fact: TerminalFact,
): NpAgentGuardianRuntimeTerminalObservationV1 | undefined {
  if (!installed) return undefined;
  const carrier = Object.freeze({ kind: "np.guardian-runtime-terminal-observation.v1" as const });
  terminalFacts.set(carrier, structuredClone(fact));
  return carrier;
}
export function npReadAgentRuntimeTerminalObservationV1(
  carrier: NpAgentGuardianRuntimeTerminalObservationV1,
): TerminalFact {
  const fact = terminalFacts.get(carrier);
  if (!fact)
    throw new NpAgentGatewayError(
      "GUARDIAN_RUNTIME_SOURCE_INVALID",
      409,
      "Runtime source evidence is unavailable.",
    );
  return structuredClone(fact);
}
/** Marks only the actual missing-scope comparison; the public error/envelope is unchanged. */
export function npMarkAgentRuntimeScopeDeniedV1<T extends object>(
  error: T,
  fact: { capabilityId: NpAgentCapabilityId; missingScopes: NpAgentScope[] },
): T {
  if (installed)
    scopeDenials.set(error, {
      capabilityId: fact.capabilityId,
      missingScopes: [...new Set(fact.missingScopes)].sort(),
    });
  return error;
}
export function npReadAgentRuntimeScopeDeniedV1(error: unknown) {
  const fact = typeof error === "object" && error !== null ? scopeDenials.get(error) : undefined;
  return fact ? { capabilityId: fact.capabilityId, missingScopes: [...fact.missingScopes] } : null;
}
/** Framework-host bootstrap only. Installing a source does not activate Runtime. */
export function setAgentGuardianRuntimeObserverV1(
  observer: NpAgentGuardianRuntimeObserverV1,
): void {
  if (!observer || typeof observer.record !== "function")
    throw new TypeError("Invalid Runtime observer.");
  installed = { record: observer.record.bind(observer) };
}
/** Framework-host teardown/test isolation only. */
export function resetAgentGuardianRuntimeObserverV1(): void {
  installed = undefined;
}
/** Internal owning-TX seam, after an actual guarded write. Absence performs no work or I/O. */
export async function npObserveAgentRuntimeFactV1(
  input: NpAgentGuardianRuntimeObservationV1,
): Promise<void> {
  const observer = installed;
  if (observer) await record(observer, input);
}
/** Invoke only after a NEW Runtime Action INSERT succeeds in this same owning transaction. */
export async function npObserveAgentRuntimeActionV1(input: {
  db: Db;
  run: Run;
  action: Pick<
    Action,
    | "id"
    | "siteId"
    | "runId"
    | "runFingerprint"
    | "sequence"
    | "capabilityId"
    | "inputHash"
    | "createdAt"
  >;
}): Promise<void> {
  const observer = installed;
  if (!observer) return;
  const { action, run } = input;
  if (
    run.origin !== "runtime" ||
    action.siteId !== run.siteId ||
    action.runId !== run.id ||
    action.runFingerprint !== run.admissionFingerprint
  )
    throw new NpAgentGatewayError(
      "GUARDIAN_RUNTIME_SOURCE_INVALID",
      409,
      "Runtime source evidence is unavailable.",
    );
  await record(observer, {
    db: input.db,
    run,
    occurredAt: action.createdAt,
    fact: {
      kind: "action-admitted",
      actionId: action.id,
      sequence: action.sequence,
      actionDigest: action.inputHash,
      capabilityId: canonicalBodyCapabilityId(
        action.capabilityId,
        "guardian.runtime.action.capabilityId",
      ),
    },
  });
}
type CostSource = {
  run: Run;
  call: typeof npAgentProviderCalls.$inferSelect;
  reservation: typeof npAgentUsageReservations.$inferSelect;
  phase: Extract<NpAgentGuardianRuntimeFactV1, { kind: "provider-cost" }>["phase"];
  responseDigest: string | null;
};
function invalidSource(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_RUNTIME_SOURCE_INVALID",
    409,
    "Runtime source evidence is unavailable.",
  );
}
/** Validate actual owning row snapshots before signing; later historical reads never compare mutable phase. */
export function npRequireAgentRuntimeCostSourceFactV1(
  input: CostSource,
): Extract<NpAgentGuardianRuntimeFactV1, { kind: "provider-cost" }> {
  const { run, call, reservation } = input;
  if (
    call.siteId !== run.siteId ||
    call.runId !== run.id ||
    reservation.siteId !== run.siteId ||
    reservation.runId !== run.id ||
    reservation.agentId !== run.agentId ||
    call.usageReservationId !== reservation.id
  )
    invalidSource();
  if (
    (input.phase === "ambiguous" &&
      (call.state !== "ambiguous" || reservation.state !== "reserved")) ||
    (input.phase === "expired" &&
      (call.state !== "ambiguous" || reservation.state !== "expired")) ||
    (input.phase === "late-reconciled" &&
      (call.state !== "ambiguous" || !["reconciled", "released"].includes(reservation.state))) ||
    (input.phase === "reconciled" &&
      (!["succeeded", "failed", "cancelled"].includes(call.state) ||
        !["reconciled", "released"].includes(reservation.state)))
  )
    invalidSource();
  let accounting: Extract<NpAgentGuardianRuntimeFactV1, { kind: "provider-cost" }>["accounting"];
  if (reservation.state === "reconciled") {
    if (
      reservation.actualCostMicros === null ||
      (reservation.actualCostSource !== "provider" &&
        reservation.actualCostSource !== "adapter-estimate") ||
      reservation.budgetChargeCostMicros !== reservation.actualCostMicros
    )
      invalidSource();
    accounting = {
      state: "settled",
      costSource: reservation.actualCostSource,
      costMicros: reservation.actualCostMicros,
      budgetChargeCostMicros: reservation.budgetChargeCostMicros,
    };
  } else if (reservation.state === "released") {
    if (
      reservation.actualCostSource !== null ||
      reservation.actualCostMicros !== null ||
      reservation.budgetChargeCostMicros !== 0
    )
      invalidSource();
    accounting = {
      state: "released",
      costSource: null,
      costMicros: null,
      budgetChargeCostMicros: 0,
    };
  } else {
    if (
      reservation.actualCostMicros !== null ||
      (reservation.actualCostSource !== null && reservation.actualCostSource !== "unknown")
    )
      invalidSource();
    accounting = {
      state: "unknown",
      costSource: "unknown",
      costMicros: null,
      budgetChargeCostMicros: reservation.budgetChargeCostMicros ?? reservation.reservedCostMicros,
    };
  }
  return {
    kind: "provider-cost",
    providerCallId: call.id,
    reservationId: reservation.id,
    sequence: call.sequence,
    requestDigest: call.requestDigest,
    responseDigest: input.responseDigest,
    phase: input.phase,
    currency: "USD",
    accounting,
  };
}
/** Actual owning usage transition; absence returns before validation or I/O. */
export async function npObserveAgentRuntimeCostV1(
  input: CostSource & { db: Db; occurredAt: Date },
): Promise<void> {
  const observer = installed;
  if (!observer) return;
  const fact = npRequireAgentRuntimeCostSourceFactV1(input);
  await record(observer, {
    db: input.db,
    run: input.run,
    occurredAt: input.occurredAt,
    fact,
    accountingSource: {
      call: input.call,
      reservation: input.reservation,
      responseDigest: input.responseDigest,
    },
  });
}
