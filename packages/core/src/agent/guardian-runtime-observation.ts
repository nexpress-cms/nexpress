import { npAwaitAgentGuardianHostReadV1 } from "./guardian-host-read.js";
import {
  npVerifyGuardianSignalRuleV1,
  type NpGuardianSignalRuleVerificationV1,
} from "./guardian-signal-rule-verifier.js";
import { npReadAgentGuardianCaptureAdmissionV1 } from "./guardian-capture-admission.js";
import {
  npReadAgentGuardianSourceClosureV1,
  npAssertAgentGuardianDeliveryKeyAvailableV1,
} from "./guardian-source-closure.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentSignals,
  npAgentRuns,
  npAgentProviderCalls,
  npAgentActions,
  npAgentVersions,
} from "../db/schema/agent.js";
import { npAgentRuntimeReceipts } from "../db/schema/guardian-runtime.js";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentEventCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import {
  npAgentGuardianRuntimeDetectorIdsV1,
  npRequireAgentGuardianRuntimeActivityV1,
  npRequireAgentGuardianRuntimeEvidenceV1,
  npEvaluateAgentGuardianRuntimeRulesV1,
  type NpAgentGuardianRuntimeRuleMatchV1,
  type NpAgentGuardianRuntimeActivityV1,
  type NpAgentGuardianRuntimeEvidenceV1,
} from "../agent-contract/guardian-runtime-contract.js";
import {
  npRequireAgentGuardianVerifiedEventV1,
  type NpAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import type { NpAgentEventCanonicalV1 } from "../agent-contract/types.js";
import type {
  NpAgentGuardianRuntimeObservationV1,
  NpAgentGuardianRuntimeObserverV1,
} from "./guardian-runtime-observer.js";
import { npRequireAgentRuntimeCostSourceFactV1 } from "./guardian-runtime-observer.js";
import {
  NpAgentGatewayError,
  npResolveAgentStaffSessionAuthorizationV1,
} from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
import { npReadAgentIncidentCanonicalSourcesV1 } from "./incident-source-evidence.js";
import {
  npObserveIncidentCandidate,
  type NpIncidentObservationCandidate,
} from "./incident-observation-service.js";
import type { NpAgentIncidentStaffContextV1 } from "./incident-service.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";
import { npRequireAgentRuntimeExecutionIntegrityV1 } from "./runtime-execution-store.js";
import { npRequireAgentRuntimeProviderDecisionV1 } from "./runtime-provider-evidence.js";
import {
  npRequireAgentActionCanonical,
  npDigestAgentActionCanonical,
} from "../agent-contract/canonical-action.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import type { NpAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";
import { npCreateAgentGuardianTransactionScopeV1 } from "./guardian-transaction-scope.js";

type Db = ReturnType<typeof getDb>;
type Receipt = typeof npAgentRuntimeReceipts.$inferSelect;
type EventRow = typeof npAgentEvents.$inferSelect;
interface ProofSources {
  runs: Map<string, typeof npAgentRuns.$inferSelect>;
  versions: Map<string, typeof npAgentVersions.$inferSelect>;
  calls: Map<string, typeof npAgentProviderCalls.$inferSelect>;
  actions: Map<string, typeof npAgentActions.$inferSelect>;
  verifiedRuns: Set<string>;
}
type Detector = (typeof npAgentGuardianRuntimeDetectorIdsV1)[number];
type Failure = "KEY_UNAVAILABLE" | "SOURCE_INTEGRITY" | "DELIVERY_UNAVAILABLE";
interface Proof {
  row: EventRow;
  activity: NpAgentGuardianRuntimeActivityV1;
}
const COMPONENT = "guardian.runtime.v1";
const RECEIPT_DOMAIN = "np.agent-guardian-runtime-source.v1";
const WINDOW_MS = 600_000;
const RETRY_MS = 300_000;
const same = (left: unknown, right: unknown) =>
  serializeAgentCanonicalJson(left) === serializeAgentCanonicalJson(right);
const digest = (value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const windowStart = (time: number) => Math.floor(time / WINDOW_MS) * WINDOW_MS;
const agentSubject = (activity: NpAgentGuardianRuntimeActivityV1, aggregate = false) => ({
  kind: "agent" as const,
  agentId: activity.agentId,
  agentVersionId: aggregate ? null : activity.agentVersionId,
});
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_RUNTIME_EVIDENCE_UNAVAILABLE",
    409,
    "Runtime observation evidence is unavailable.",
  );
}
class SourceFailure extends Error {
  constructor(readonly code: Failure) {
    super(code);
  }
}
class CollectionTimeout extends NpAgentGatewayError {
  constructor() {
    super("GUARDIAN_RUNTIME_SOURCE_TIMEOUT", 503, "Runtime observation collection is unavailable.");
  }
}
interface CollectionBudget {
  checkpoint(this: void): void;
  remaining(this: void): number;
  wait<T>(this: void, work: () => T | Promise<T>): Promise<T>;
}
function collectionBudget(): CollectionBudget {
  const deadline = performance.now() + 5000;
  const checkpoint = () => {
    if (performance.now() >= deadline) throw new CollectionTimeout();
  };
  const remaining = () => {
    checkpoint();
    const milliseconds = Math.floor(deadline - performance.now());
    if (milliseconds < 1) throw new CollectionTimeout();
    return milliseconds;
  };
  return {
    checkpoint,
    remaining,
    async wait(work) {
      checkpoint();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => {
            checkpoint();
            return work();
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new CollectionTimeout()), remaining());
          }),
        ]);
        checkpoint();
        return result;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
async function collectionCallback<T>(
  db: Db,
  budget: CollectionBudget,
  work: (db: Db) => Promise<T>,
): Promise<T> {
  const scope = npCreateAgentGuardianTransactionScopeV1(db, {
    checkpoint: budget.checkpoint,
    unavailable,
    closed: () => {
      throw new CollectionTimeout();
    },
  });
  try {
    return await budget.wait(() => work(scope.db));
  } finally {
    scope.close();
  }
}
function sourceFailure(code: Failure = "SOURCE_INTEGRITY"): never {
  throw new SourceFailure(code);
}
function validKey(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length >= 32 && value.length <= 64;
}
function keyId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    unavailable();
  return value;
}
function isoDate(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(value)))
    unavailable();
  return Date.prototype.toISOString.call(value);
}
function copiedActivity(
  input: NpAgentGuardianRuntimeObservationV1,
): NpAgentGuardianRuntimeActivityV1 {
  const run = input.run;
  const fact = input.fact;
  const identity =
    fact.kind === "action-admitted"
      ? { kind: fact.kind, id: fact.actionId }
      : fact.kind === "proposal-repeated"
        ? { kind: fact.kind, id: fact.responses[1].providerCallId }
        : fact.kind === "scope-denied"
          ? { kind: fact.kind, id: fact.response.providerCallId }
          : { kind: fact.kind, id: fact.providerCallId, phase: fact.phase };
  const hex = createHash("sha256")
    .update("np.guardian-runtime-observation-id.v1\0")
    .update(serializeAgentCanonicalJson({ siteId: run.siteId, runId: run.id, identity }))
    .digest("hex");
  const observationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return npRequireAgentGuardianRuntimeActivityV1({
    schemaVersion: "np.agent-guardian-runtime-activity.v1",
    observationId,
    siteId: run.siteId,
    agentId: run.agentId,
    agentVersionId: run.agentVersionId,
    runId: run.id,
    principalId: run.principalId,
    runAdmissionDigest: run.admissionFingerprint,
    occurredAt: isoDate(input.occurredAt),
    fact,
  });
}
function correlation(activity: NpAgentGuardianRuntimeActivityV1, detectorId: Detector): string {
  return digest({
    domain: "np.guardian-runtime-correlation.v1",
    siteId: activity.siteId,
    detectorId,
    detectorVersion: 1,
    agentId: activity.agentId,
  });
}
function matches(proofs: readonly Proof[]): NpAgentGuardianRuntimeRuleMatchV1[] {
  if (!proofs.length) return [];
  const first = proofs[0].activity;
  return npEvaluateAgentGuardianRuntimeRulesV1({
    siteId: first.siteId,
    agentId: first.agentId,
    windowStartedAt: new Date(windowStart(Date.parse(first.occurredAt))).toISOString(),
    activities: proofs.map((p) => p.activity),
  });
}
function cohort(
  proofs: readonly Proof[],
  detector: Detector,
  evaluated: readonly NpAgentGuardianRuntimeRuleMatchV1[] = matches(proofs),
): Proof[] | null {
  const match = evaluated.find((m) => m.detectorId === detector);
  if (!match) return null;
  const ids = new Set(match.observationIds);
  return proofs
    .filter((p) => ids.has(p.activity.observationId))
    .sort(
      (a, b) =>
        a.activity.occurredAt.localeCompare(b.activity.occurredAt) ||
        a.activity.observationId.localeCompare(b.activity.observationId),
    );
}
async function withBudget<T>(db: Db, maximum: number, work: () => Promise<T>): Promise<T> {
  const result = await db.execute(
    sql`select current_setting('statement_timeout') as statement_original, extract(epoch from current_setting('statement_timeout')::interval)*1000 as statement_milliseconds, current_setting('lock_timeout') as lock_original, extract(epoch from current_setting('lock_timeout')::interval)*1000 as lock_milliseconds`,
  );
  const row = result.rows[0],
    statement = Number(row?.statement_milliseconds),
    lock = Number(row?.lock_milliseconds);
  if (
    typeof row?.statement_original !== "string" ||
    typeof row.lock_original !== "string" ||
    !Number.isFinite(statement) ||
    statement < 0 ||
    !Number.isFinite(lock) ||
    lock < 0
  )
    unavailable();
  let outcome: { value: T } | { error: unknown };
  try {
    await db.execute(
      sql`select set_config('statement_timeout',${`${Math.min(statement || maximum, maximum)}ms`},true),set_config('lock_timeout',${`${Math.min(lock || 100, 100, maximum)}ms`},true)`,
    );
    outcome = { value: await work() };
  } catch (error) {
    outcome = { error };
  }
  try {
    await db.execute(
      sql`select set_config('statement_timeout',${row.statement_original},true),set_config('lock_timeout',${row.lock_original},true)`,
    );
  } catch (error) {
    // A rollback restores aborted-TX GUCs; preserve the original source failure.
    if ("value" in outcome) outcome = { error };
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

export interface NpAgentGuardianRuntimeObservationOptionsV1 {
  /** Copied host key; capture creates or resolves no credentials. */
  receiptKey: { id: string; bytes: Uint8Array };
  resolveReceiptKey?(id: string): Uint8Array | null | Promise<Uint8Array | null>;
  /** Copied installation catalog. Capture performs no callback or catalog lookup. */
  installedSiteIds: readonly string[];
  /** Current maintenance authority, checked before any collector reads or writes. */
  authorize(input: { db: Db; siteId: string }): Promise<void>;
  events: Pick<NpAgentRuntimeEventServiceV1, "record">;
  notifications?: Pick<NpAgentIncidentNotificationsServiceV1, "record" | "recordFailure">;
  now?: () => Date;
}
export interface NpAgentGuardianRuntimeCollectionResultV1 {
  state: "collecting" | "disabled";
  processed: number;
  emitted: number;
  blocked: number;
  sampled: number;
  held: number;
  /** Actual retained pending/blocked facts, including delayed retries. */
  backlog: number | null;
}
export interface NpAgentGuardianRuntimeObservationServiceV1 {
  observer: NpAgentGuardianRuntimeObserverV1;
  collect(input: {
    siteId: string;
    limit?: number;
  }): Promise<NpAgentGuardianRuntimeCollectionResultV1>;
  /** Private retained-source verifier; grants no deletion authority. */
  verifyReceiptForRetention(input: { db: Db; siteId: string; receiptId: string }): Promise<{
    sourceProofDigest: string;
    occurredAt: string;
    state: "pending" | "blocked" | "emitted" | "sampled" | "held";
    emittedEventId: string | null;
  }>;
  /** Caller owns diagnostic authority. Proves one source without exposing item facts. */
  verifySignal(input: NpGuardianSignalRuleVerificationV1): Promise<boolean>;
  verifyEvent(input: {
    db: Db;
    siteId: string;
    eventId: string;
  }): Promise<NpAgentGuardianVerifiedEventV1>;
  evidence(input: {
    db: Db;
    siteId: string;
    incident: NpAgentIncidentV1;
    actor: NpAgentIncidentStaffContextV1["actor"];
  }): Promise<NpAgentGuardianRuntimeEvidenceV1[]>;
  /**
   * Private proof facet. Caller MUST establish current Runtime Incident read ACL
   * before and after use; this authenticates retained facts and grants no authority.
   */
  assessmentEvidence(input: {
    db: Db;
    siteId: string;
    incident: NpAgentIncidentV1;
  }): Promise<NpAgentGuardianRuntimeEvidenceV1[]>;
}

/** Explicit source and maintenance owner. No registry, worker or response policy is installed. */
export function createAgentGuardianRuntimeObservationServiceV1(
  options: NpAgentGuardianRuntimeObservationOptionsV1,
): NpAgentGuardianRuntimeObservationServiceV1 {
  const currentKeyId = keyId(options.receiptKey?.id);
  if (
    !validKey(options.receiptKey?.bytes) ||
    !Array.isArray(options.installedSiteIds) ||
    options.installedSiteIds.length > 10_000 ||
    typeof options.authorize !== "function" ||
    typeof options.events?.record !== "function" ||
    (options.resolveReceiptKey !== undefined && typeof options.resolveReceiptKey !== "function") ||
    (options.now !== undefined && typeof options.now !== "function")
  )
    unavailable();
  const currentKey = new Uint8Array(options.receiptKey.bytes);
  const installed = new Set(
    options.installedSiteIds.map((id) => canonicalBodySiteId(id, "guardian.runtime.siteId")),
  );
  const authorize = options.authorize.bind(options);
  const recordEvent = options.events.record.bind(options.events);
  const resolveRetainedKey = options.resolveReceiptKey?.bind(options);
  const notifications = options.notifications;
  const now = options.now ?? (() => new Date());
  const time = () => new Date(isoDate(now()));
  const resolveKey = async (id: string, budget?: CollectionBudget) => {
    budget?.checkpoint();
    if (id === currentKeyId) return currentKey;
    let key: Uint8Array | null | undefined;
    try {
      const read = () => npAwaitAgentGuardianHostReadV1(() => resolveRetainedKey?.(id));
      key = budget ? await budget.wait(read) : await read();
    } catch (error) {
      if (error instanceof CollectionTimeout) throw error;
      return sourceFailure("KEY_UNAVAILABLE");
    }
    if (!validKey(key)) sourceFailure("KEY_UNAVAILABLE");
    return new Uint8Array(key);
  };
  const mac = (key: Uint8Array, id: string, body: NpAgentGuardianRuntimeActivityV1, hash: string) =>
    `hmac-sha256:${createHmac("sha256", key)
      .update(RECEIPT_DOMAIN)
      .update("\0")
      .update(
        serializeAgentCanonicalJson({
          receiptId: body.observationId,
          siteId: body.siteId,
          keyId: id,
          bodyHash: hash,
          body,
        }),
      )
      .digest("base64url")}`;
  function eventFor(activity: NpAgentGuardianRuntimeActivityV1): NpAgentEventCanonicalV1 {
    return npRequireAgentEventCanonical({
      version: "np.agent-event.v1",
      siteId: activity.siteId,
      kind: "agent.runtime.activity.observed",
      occurredAt: activity.occurredAt,
      source: { kind: "agent", component: COMPONENT },
      subject: agentSubject(activity),
      actor: { kind: "agent-principal", principalId: activity.principalId },
      causation: null,
      correlationId: null,
      deduplicationKey: `guardian-runtime:${activity.observationId}`,
      privacy: "sensitive",
      payload: {
        kind: "agent.runtime.activity.observed",
        receiptId: activity.observationId,
        activity,
      },
    });
  }
  async function verifyRun(
    db: Db,
    activity: NpAgentGuardianRuntimeActivityV1,
    sources?: ProofSources,
  ): Promise<void> {
    const run = sources
      ? sources.runs.get(activity.runId)
      : (
          await db
            .select()
            .from(npAgentRuns)
            .where(and(eq(npAgentRuns.siteId, activity.siteId), eq(npAgentRuns.id, activity.runId)))
            .limit(1)
        )[0];
    if (
      !run ||
      run.agentId !== activity.agentId ||
      run.agentVersionId !== activity.agentVersionId ||
      run.principalId !== activity.principalId ||
      run.admissionFingerprint !== activity.runAdmissionDigest
    )
      sourceFailure();
    if (!sources?.verifiedRuns.has(run.id)) {
      await npRequireAgentRuntimeExecutionIntegrityV1(run);
      sources?.verifiedRuns.add(run.id);
    }
    const fact = activity.fact;
    if (fact.kind === "scope-denied") {
      const version = sources
        ? sources.versions.get(activity.agentVersionId)
        : (
            await db
              .select()
              .from(npAgentVersions)
              .where(
                and(
                  eq(npAgentVersions.siteId, activity.siteId),
                  eq(npAgentVersions.id, activity.agentVersionId),
                ),
              )
              .limit(1)
          )[0];
      if (
        !version ||
        version.agentId !== activity.agentId ||
        version.configHash !== run.agentConfigHash ||
        fact.missingScopes.some((scope) => version.scopes.includes(scope))
      )
        sourceFailure();
    }
    if (fact.kind === "proposal-repeated" || fact.kind === "scope-denied") {
      const refs = fact.kind === "proposal-repeated" ? fact.responses : [fact.response];
      for (const ref of refs) {
        const call = sources
          ? sources.calls.get(ref.providerCallId)
          : (
              await db
                .select()
                .from(npAgentProviderCalls)
                .where(
                  and(
                    eq(npAgentProviderCalls.siteId, activity.siteId),
                    eq(npAgentProviderCalls.runId, activity.runId),
                    eq(npAgentProviderCalls.id, ref.providerCallId),
                  ),
                )
                .limit(1)
            )[0];
        if (
          !call ||
          call.runId !== activity.runId ||
          call.sequence !== ref.sequence ||
          call.responseDigest !== ref.responseDigest
        )
          sourceFailure();
        const output = await npRequireAgentRuntimeProviderDecisionV1(call);
        if (
          output.task !== "interactive-capability" ||
          output.decision.kind !== "propose-capability" ||
          output.decision.capabilityId !== fact.capabilityId
        )
          sourceFailure();
        if (
          fact.kind === "proposal-repeated" &&
          digest({
            capabilityId: output.decision.capabilityId,
            arguments: output.decision.arguments,
          }) !== fact.proposalDigest
        )
          sourceFailure();
      }
    } else if (fact.kind === "action-admitted") {
      const action = sources
        ? sources.actions.get(fact.actionId)
        : (
            await db
              .select()
              .from(npAgentActions)
              .where(
                and(
                  eq(npAgentActions.siteId, activity.siteId),
                  eq(npAgentActions.id, fact.actionId),
                ),
              )
              .limit(1)
          )[0];
      if (
        !action ||
        action.runId !== activity.runId ||
        action.runFingerprint !== activity.runAdmissionDigest ||
        action.inputHash !== fact.actionDigest ||
        action.sequence !== fact.sequence ||
        action.capabilityId !== fact.capabilityId
      )
        sourceFailure();
      const canonical = npRequireAgentActionCanonical({
        schemaVersion: "np.agent-action.v1",
        siteId: action.siteId,
        actionId: action.id,
        invocationFingerprint: action.invocationFingerprint,
        runFingerprint: action.runFingerprint,
        sequence: action.sequence,
        capabilityId: action.capabilityId,
        capabilityContractVersion: action.capabilityContractVersion,
        capabilityFingerprint: action.capabilityFingerprint,
        effectProfile: {
          id: action.effectProfileId,
          contractVersion: action.effectContractVersion,
        },
        risk: action.risk,
        requiredScopes: action.requiredScopes,
        targetRefs: action.targetRefs,
        targetVersionFacts: action.targetVersionFacts,
        input: action.inputCanonical,
      });
      if ((await npDigestAgentActionCanonical(canonical)) !== fact.actionDigest) sourceFailure();
    } else {
      const call = sources
        ? sources.calls.get(fact.providerCallId)
        : (
            await db
              .select()
              .from(npAgentProviderCalls)
              .where(
                and(
                  eq(npAgentProviderCalls.siteId, activity.siteId),
                  eq(npAgentProviderCalls.id, fact.providerCallId),
                ),
              )
              .limit(1)
          )[0];
      if (
        !call ||
        call.runId !== activity.runId ||
        call.usageReservationId !== fact.reservationId ||
        call.requestDigest !== fact.requestDigest ||
        call.sequence !== fact.sequence
      )
        sourceFailure();
      // Immutable signed receipt attests the owning accounting transition. Later
      // late reconciliation may legitimately supersede mutable call/reservation rows.
    }
  }
  async function authenticateReceipt(row: Receipt, currentTime: Date, budget?: CollectionBudget) {
    budget?.checkpoint();
    let activity: NpAgentGuardianRuntimeActivityV1;
    try {
      activity = npRequireAgentGuardianRuntimeActivityV1(row.body);
      if (
        row.id !== activity.observationId ||
        row.siteId !== activity.siteId ||
        isoDate(row.occurredAt) !== activity.occurredAt ||
        Date.parse(activity.occurredAt) > currentTime.getTime() ||
        row.agentId !== activity.agentId ||
        row.agentVersionId !== activity.agentVersionId ||
        row.runId !== activity.runId ||
        row.principalId !== activity.principalId ||
        digest(activity) !== row.bodyHash ||
        !/^hmac-sha256:[A-Za-z0-9_-]{43}$/u.test(row.sourceMac)
      )
        sourceFailure();
      keyId(row.keyId);
    } catch {
      return sourceFailure();
    }
    const key = await resolveKey(row.keyId, budget);
    const expected = mac(key, row.keyId, activity, row.bodyHash);
    if (!timingSafeEqual(Buffer.from(row.sourceMac), Buffer.from(expected))) sourceFailure();
    return activity;
  }
  async function verifyReceipt(row: Receipt, currentTime: Date, db: Db, budget?: CollectionBudget) {
    const activity = await authenticateReceipt(row, currentTime, budget);
    await verifyRun(db, activity);
    return activity;
  }
  async function verifyEvents(
    db: Db,
    rows: readonly EventRow[],
    currentTime: Date,
    budget?: CollectionBudget,
  ): Promise<Proof[]> {
    budget?.checkpoint();
    const parsed = await Promise.all(rows.map((row) => npReadAgentEventRowEvidenceV1(row)));
    const ids = parsed.map((event) => {
      if (event.payload.kind !== "agent.runtime.activity.observed") return sourceFailure();
      return event.payload.receiptId;
    });
    if (new Set(ids).size !== ids.length) sourceFailure();
    const receipts: Receipt[] = [];
    for (let offset = 0; offset < ids.length; offset += 100)
      receipts.push(
        ...(await db
          .select()
          .from(npAgentRuntimeReceipts)
          .where(
            and(
              eq(npAgentRuntimeReceipts.siteId, rows[0].siteId),
              inArray(npAgentRuntimeReceipts.id, ids.slice(offset, offset + 100)),
            ),
          )),
      );
    if (receipts.length !== rows.length) sourceFailure();
    const byId = new Map(receipts.map((row) => [row.id, row]));
    const proofs: Proof[] = [];
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch: Proof[] = [];
      for (let index = offset; index < Math.min(offset + 100, rows.length); index++) {
        const receipt = byId.get(ids[index]);
        if (!receipt) sourceFailure();
        budget?.checkpoint();
        batch.push(
          await authenticateProof(rows[index], receipt, currentTime, parsed[index], budget),
        );
      }
      proofs.push(...(await verifyProofSources(db, batch, false, budget)));
    }
    return proofs;
  }
  async function authenticateProof(
    row: EventRow,
    receipt: Receipt,
    currentTime: Date,
    event?: NpAgentEventCanonicalV1,
    budget?: CollectionBudget,
  ): Promise<Proof> {
    const activity = await authenticateReceipt(receipt, currentTime, budget);
    if (
      receipt.state !== "emitted" ||
      receipt.failureCode !== null ||
      receipt.emittedEventId !== row.id ||
      receipt.emittedAt?.getTime() !== row.recordedAt.getTime() ||
      row.dispatchedAt?.getTime() !== row.recordedAt.getTime() ||
      !same(event ?? (await npReadAgentEventRowEvidenceV1(row)), eventFor(activity))
    )
      sourceFailure();
    return { row, activity };
  }
  /** One fresh, bounded source pass after all host key callbacks. Nothing is
   * retained across a receipt callback, detector pass, or public proof read. */
  async function verifyProofSources(
    db: Db,
    proofs: readonly Proof[],
    tolerateInvalid: boolean,
    budget?: CollectionBudget,
  ): Promise<Proof[]> {
    if (!proofs.length) return [];
    if (proofs.length > 100) sourceFailure();
    budget?.checkpoint();
    const siteId = proofs[0].activity.siteId;
    if (proofs.some((proof) => proof.activity.siteId !== siteId)) sourceFailure();
    const runIds = [...new Set(proofs.map((proof) => proof.activity.runId))];
    const versionIds: string[] = [],
      callIds: string[] = [],
      actionIds: string[] = [];
    for (const { activity } of proofs) {
      const fact = activity.fact;
      if (fact.kind === "scope-denied") versionIds.push(activity.agentVersionId);
      if (fact.kind === "action-admitted") actionIds.push(fact.actionId);
      else if (fact.kind === "proposal-repeated")
        callIds.push(...fact.responses.map((ref) => ref.providerCallId));
      else
        callIds.push(
          fact.kind === "scope-denied" ? fact.response.providerCallId : fact.providerCallId,
        );
    }
    const sources: ProofSources = {
      runs: new Map(),
      versions: new Map(),
      calls: new Map(),
      actions: new Map(),
      verifiedRuns: new Set(),
    };
    const runs = await db
      .select()
      .from(npAgentRuns)
      .where(and(eq(npAgentRuns.siteId, siteId), inArray(npAgentRuns.id, runIds)));
    sources.runs = new Map(runs.map((run) => [run.id, run]));
    if (versionIds.length) {
      budget?.checkpoint();
      const versions = await db
        .select()
        .from(npAgentVersions)
        .where(
          and(
            eq(npAgentVersions.siteId, siteId),
            inArray(npAgentVersions.id, [...new Set(versionIds)]),
          ),
        );
      sources.versions = new Map(versions.map((version) => [version.id, version]));
    }
    const uniqueCalls = [...new Set(callIds)];
    for (let offset = 0; offset < uniqueCalls.length; offset += 100) {
      budget?.checkpoint();
      const calls = await db
        .select()
        .from(npAgentProviderCalls)
        .where(
          and(
            eq(npAgentProviderCalls.siteId, siteId),
            inArray(npAgentProviderCalls.id, uniqueCalls.slice(offset, offset + 100)),
          ),
        );
      for (const call of calls) sources.calls.set(call.id, call);
    }
    if (actionIds.length) {
      budget?.checkpoint();
      const actions = await db
        .select()
        .from(npAgentActions)
        .where(
          and(
            eq(npAgentActions.siteId, siteId),
            inArray(npAgentActions.id, [...new Set(actionIds)]),
          ),
        );
      sources.actions = new Map(actions.map((action) => [action.id, action]));
    }
    const verified: Proof[] = [];
    for (const proof of proofs) {
      budget?.checkpoint();
      try {
        await verifyRun(db, proof.activity, sources);
        verified.push(proof);
      } catch (error) {
        budget?.checkpoint();
        if (!tolerateInvalid || error instanceof CollectionTimeout) throw error;
        // The collector retains corrupt older sources without counting them.
      }
    }
    return verified;
  }
  async function candidate(proofs: readonly Proof[], detector: Detector) {
    const selected = cohort(proofs, detector);
    if (!selected || selected.length !== proofs.length) sourceFailure();
    const match = matches(selected).find((m) => m.detectorId === detector);
    if (!match) sourceFailure();
    const first = selected[0].activity;
    const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId: first.siteId,
      detectorId: detector,
      detectorVersion: 1,
      category: "agent-abuse",
      subject: agentSubject(first, true),
      window: match.window,
      evidence: selected
        .map(({ row, activity }) => ({
          kind: "event",
          eventId: row.id,
          eventKind: "agent.runtime.activity.observed",
          observedAt: activity.occurredAt,
          digest: Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString(
            "hex",
          ),
          excerpt: null,
        }))
        .sort(
          (a, b) => a.observedAt.localeCompare(b.observedAt) || a.eventId.localeCompare(b.eventId),
        ),
    });
    const result: NpIncidentObservationCandidate = {
      canonicalEvidence,
      evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonicalEvidence),
      fingerprint: correlation(first, detector),
      severity: "medium",
      confidenceBasis: "exact-rule",
      scoreBasisPoints: null,
      title: "Committed Runtime activity for review",
      summary:
        "Bounded committed Runtime observations met a deterministic review threshold. Counts are lower bounds; provider-reported, estimated and unknown cost remain distinct. This does not establish malicious intent or authorize a response.",
    };
    return { candidate: result, match };
  }
  async function detect(
    db: Db,
    activity: NpAgentGuardianRuntimeActivityV1,
    currentTime: Date,
    budget: CollectionBudget,
  ) {
    budget.checkpoint();
    const startedAt = windowStart(Date.parse(activity.occurredAt));
    const receipts = await db
      .select()
      .from(npAgentRuntimeReceipts)
      .where(
        and(
          eq(npAgentRuntimeReceipts.siteId, activity.siteId),
          eq(npAgentRuntimeReceipts.state, "emitted"),
          eq(npAgentRuntimeReceipts.agentId, activity.agentId),
          gte(npAgentRuntimeReceipts.occurredAt, new Date(startedAt)),
          lt(npAgentRuntimeReceipts.occurredAt, new Date(startedAt + WINDOW_MS)),
        ),
      )
      .orderBy(asc(npAgentRuntimeReceipts.occurredAt), asc(npAgentRuntimeReceipts.id))
      .limit(101);
    if (receipts.length > 100) sourceFailure();
    const rows = await npReadAgentEventRowsV1(
      db,
      activity.siteId,
      receipts.flatMap((row) => (row.emittedEventId ? [row.emittedEventId] : [])),
    );
    const authenticated: Proof[] = [];
    const receiptsByEvent = new Map(receipts.map((receipt) => [receipt.emittedEventId, receipt]));
    // Corrupt older retained sources cannot contaminate a new valid cohort.
    for (const row of rows) {
      budget.checkpoint();
      try {
        const receipt = receiptsByEvent.get(row.id);
        if (receipt)
          authenticated.push(await authenticateProof(row, receipt, currentTime, undefined, budget));
      } catch (error) {
        budget.checkpoint();
        if (error instanceof CollectionTimeout) throw error;
        /* Retain but do not count unverifiable facts. */
      }
    }
    const proofs = await verifyProofSources(db, authenticated, true, budget);
    let evaluated: NpAgentGuardianRuntimeRuleMatchV1[] | undefined;
    for (const detector of npAgentGuardianRuntimeDetectorIdsV1) {
      budget.checkpoint();
      const previous = await db
        .select({ id: npAgentSignals.id })
        .from(npAgentSignals)
        .where(
          and(
            eq(npAgentSignals.siteId, activity.siteId),
            eq(npAgentSignals.detectorId, detector),
            eq(npAgentSignals.detectorVersion, 1),
            eq(npAgentSignals.fingerprint, correlation(activity, detector)),
            eq(npAgentSignals.windowStartedAt, new Date(startedAt)),
            gte(npAgentSignals.windowEndedAt, new Date(startedAt)),
            lt(npAgentSignals.windowEndedAt, new Date(startedAt + WINDOW_MS)),
          ),
        )
        .limit(2);
      if (previous.length > 1) sourceFailure();
      // This freezes one cohort even after closing its Incident or a late source arrival.
      if (previous.length) continue;
      const selected = cohort(proofs, detector, (evaluated ??= matches(proofs)));
      if (!selected) continue;
      const detected = (await candidate(selected, detector)).candidate;
      await npObserveIncidentCandidate({
        transaction: db,
        candidate: detected,
        now: () => new Date(currentTime.getTime()),
        notifications,
        resolveEvidence: async (tx) => {
          const current = await npReadAgentEventRowsV1(
            tx,
            activity.siteId,
            selected.map(({ row }) => row.id),
          );
          const rebuilt = (
            await candidate(await verifyEvents(tx, current, currentTime, budget), detector)
          ).candidate;
          return same(rebuilt, detected);
        },
      });
    }
  }
  async function evidenceProof(
    input: { db: Db; siteId: string; incident: NpAgentIncidentV1 },
    currentTime: Date,
  ): Promise<NpAgentGuardianRuntimeEvidenceV1[]> {
    const siteId = canonicalBodySiteId(input.siteId, "guardian.runtime.siteId");
    if (!installed.has(siteId)) unavailable();
    const sources = await npReadAgentIncidentCanonicalSourcesV1(input);
    if (!sources.signals.length || sources.signals.length > 100) unavailable();
    const rows = await npReadAgentEventRowsV1(
      input.db,
      siteId,
      [
        ...new Set(
          sources.signals.flatMap((signal) =>
            signal.evidence.flatMap((ref) => (ref.kind === "event" ? [ref.eventId] : [])),
          ),
        ),
      ].sort(),
    );
    let proofs: Proof[];
    try {
      proofs = await verifyEvents(input.db, rows, currentTime);
    } catch {
      return unavailable();
    }
    const byId = new Map(proofs.map((proof) => [proof.row.id, proof]));
    const signals = await input.db
      .select()
      .from(npAgentSignals)
      .where(
        and(
          eq(npAgentSignals.siteId, siteId),
          eq(npAgentSignals.incidentId, input.incident.id),
          inArray(npAgentSignals.id, input.incident.signalIds),
        ),
      );
    if (signals.length !== sources.signals.length) unavailable();
    const evidence: NpAgentGuardianRuntimeEvidenceV1[] = [];
    for (const signal of signals) {
      if (!npAgentGuardianRuntimeDetectorIdsV1.some((id) => id === signal.detectorId))
        unavailable();
      const detector = signal.detectorId as Detector;
      const selected = signal.evidence.map((ref) =>
        ref.kind === "event" ? byId.get(ref.eventId) : undefined,
      );
      if (selected.some((proof) => proof === undefined)) unavailable();
      const exact = selected.filter((proof) => proof !== undefined);
      const rebuilt = await candidate(exact, detector);
      const c = rebuilt.candidate;
      if (
        signal.evidenceDigest !== c.evidenceDigest ||
        signal.fingerprint !== c.fingerprint ||
        signal.detectorVersion !== 1 ||
        signal.severity !== c.severity ||
        signal.confidenceBasis !== "exact-rule" ||
        signal.scoreBasisPoints !== null ||
        !same(signal.subject, c.canonicalEvidence.subject) ||
        !same(signal.evidence, c.canonicalEvidence.evidence) ||
        signal.windowStartedAt.toISOString() !== c.canonicalEvidence.window.startedAt ||
        signal.windowEndedAt.toISOString() !== c.canonicalEvidence.window.endedAt ||
        signal.category !== "agent-abuse" ||
        input.incident.category !== "agent-abuse" ||
        input.incident.fingerprint !== c.fingerprint ||
        !same(input.incident.primarySubject, c.canonicalEvidence.subject)
      )
        unavailable();
      const { observationIds, ...safe } = rebuilt.match;
      if (observationIds.length !== exact.length) unavailable();
      evidence.push(
        npRequireAgentGuardianRuntimeEvidenceV1({
          schemaVersion: "np.agent-guardian-runtime-evidence.v1",
          signalId: signal.id,
          ...safe,
          sourceDigest: c.evidenceDigest,
        }),
      );
    }
    const [currentIncident] = await input.db
      .select()
      .from(npAgentIncidents)
      .where(and(eq(npAgentIncidents.siteId, siteId), eq(npAgentIncidents.id, input.incident.id)))
      .limit(1);
    if (
      !currentIncident ||
      currentIncident.versionNumber !== input.incident.versionNumber ||
      currentIncident.updatedAt.toISOString() !== input.incident.updatedAt ||
      currentIncident.fingerprint !== input.incident.fingerprint ||
      currentIncident.category !== input.incident.category ||
      currentIncident.severity !== input.incident.severity ||
      currentIncident.status !== input.incident.status ||
      currentIncident.eventCount !== input.incident.eventCount ||
      currentIncident.signalCount !== input.incident.signalIds.length ||
      !same(currentIncident.primarySubject, input.incident.primarySubject)
    )
      unavailable();
    return evidence.sort((left, right) => left.signalId.localeCompare(right.signalId));
  }
  return {
    observer: {
      async record(input) {
        npAssertAgentPreviewEffectsAllowed();
        const siteId = canonicalBodySiteId(input.run.siteId, "guardian.runtime.siteId");
        if (!installed.has(siteId)) return;
        await npRequireAgentRuntimeExecutionIntegrityV1(input.run);
        if (input.fact.kind === "provider-cost") {
          if (
            !input.accountingSource ||
            !same(
              input.fact,
              npRequireAgentRuntimeCostSourceFactV1({
                ...input.accountingSource,
                run: input.run,
                phase: input.fact.phase,
              }),
            )
          )
            sourceFailure();
        }
        const activity = copiedActivity(input),
          bodyHash = digest(activity),
          sourceMac = mac(currentKey, currentKeyId, activity, bodyHash);
        await withBudget(input.db, 500, async () => {
          if ((await npReadAgentGuardianCaptureAdmissionV1(input.db, siteId)).state === "disabled")
            return;
          const [written] = await input.db
            .insert(npAgentRuntimeReceipts)
            .values({
              id: activity.observationId,
              siteId,
              agentId: activity.agentId,
              agentVersionId: activity.agentVersionId,
              runId: activity.runId,
              principalId: activity.principalId,
              body: activity,
              bodyHash,
              keyId: currentKeyId,
              sourceMac,
              occurredAt: new Date(activity.occurredAt),
              createdAt: new Date(activity.occurredAt),
              nextAttemptAt: new Date(activity.occurredAt),
              state: "pending",
            })
            .onConflictDoUpdate({
              target: npAgentRuntimeReceipts.id,
              set: { bodyHash },
              setWhere: and(
                eq(npAgentRuntimeReceipts.siteId, siteId),
                eq(npAgentRuntimeReceipts.bodyHash, bodyHash),
                eq(npAgentRuntimeReceipts.sourceMac, sourceMac),
                eq(npAgentRuntimeReceipts.keyId, currentKeyId),
              ),
            })
            .returning({ id: npAgentRuntimeReceipts.id });
          if (!written) sourceFailure();
        });
      },
    },
    async collect(input) {
      npAssertAgentPreviewEffectsAllowed();
      const siteId = canonicalBodySiteId(input.siteId, "guardian.runtime.siteId");
      const limit = input.limit ?? 25;
      if (!installed.has(siteId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 25)
        unavailable();
      const budget = collectionBudget();
      return budget.wait(() =>
        getDb().transaction(async (raw) => {
          const outer = raw as unknown as Db;
          budget.checkpoint();
          const scope = npCreateAgentGuardianTransactionScopeV1(outer, {
            checkpoint: budget.checkpoint,
            unavailable,
            closed: () => {
              throw new CollectionTimeout();
            },
          });
          try {
            const collected = await withBudget(outer, Math.min(500, budget.remaining()), () =>
              budget.wait(() =>
                npWithAgentRuntimeControlTransactionV1(
                  siteId,
                  async ({ db }) => {
                    if (
                      (await npReadAgentGuardianCaptureAdmissionV1(db, siteId)).state === "disabled"
                    )
                      return {
                        state: "disabled" as const,
                        processed: 0,
                        emitted: 0,
                        blocked: 0,
                        sampled: 0,
                        held: 0,
                        backlog: null,
                      };
                    await collectionCallback(db, budget, (callbackDb) =>
                      authorize({ db: callbackDb, siteId }),
                    );
                    const currentTime = time();
                    const closure = await npReadAgentGuardianSourceClosureV1(db, siteId, "runtime");
                    const pending = await db
                      .select()
                      .from(npAgentRuntimeReceipts)
                      .where(
                        and(
                          eq(npAgentRuntimeReceipts.siteId, siteId),
                          inArray(npAgentRuntimeReceipts.state, ["pending", "blocked"]),
                          lte(npAgentRuntimeReceipts.nextAttemptAt, currentTime),
                        ),
                      )
                      .orderBy(
                        asc(npAgentRuntimeReceipts.nextAttemptAt),
                        asc(npAgentRuntimeReceipts.createdAt),
                        asc(npAgentRuntimeReceipts.id),
                      )
                      .limit(limit)
                      .for("update", { skipLocked: true });
                    const result = {
                      state: "collecting" as const,
                      processed: 0,
                      emitted: 0,
                      blocked: 0,
                      sampled: 0,
                      held: 0,
                      backlog: 0 as number | null,
                    };
                    let maximumReceiptWorkMs = 0;
                    for (const receipt of pending) {
                      budget.checkpoint();
                      // Historical proof work grows with the retained cohort. Leave
                      // room for the largest completed receipt plus owner cleanup.
                      // This estimate never replaces the absolute timeout: a new
                      // stalled key or callback still rolls the whole batch back.
                      if (budget.remaining() < Math.max(500, maximumReceiptWorkMs + 500)) {
                        result.backlog = null;
                        break;
                      }
                      result.processed++;
                      const receiptStartedAt = performance.now();
                      try {
                        const outcome = await withBudget(
                          db,
                          Math.min(500, budget.remaining()),
                          () =>
                            db.transaction(async (savepoint) => {
                              const receiptScope = npCreateAgentGuardianTransactionScopeV1(
                                savepoint,
                                {
                                  checkpoint: budget.checkpoint,
                                  unavailable,
                                  closed: () => {
                                    throw new CollectionTimeout();
                                  },
                                },
                              );
                              const tx = receiptScope.db;
                              try {
                                const activity = await verifyReceipt(
                                  receipt,
                                  currentTime,
                                  tx,
                                  budget,
                                );
                                if (closure && activity.occurredAt < closure.closedBefore) {
                                  await tx
                                    .update(npAgentRuntimeReceipts)
                                    .set({ state: "held", failureCode: "DELIVERY_CLOSED" })
                                    .where(
                                      and(
                                        eq(npAgentRuntimeReceipts.siteId, siteId),
                                        eq(npAgentRuntimeReceipts.id, receipt.id),
                                      ),
                                    );
                                  return "held" as const;
                                }
                                const startedAt = windowStart(Date.parse(activity.occurredAt));
                                const [usage] = await tx
                                  .select({ count: count() })
                                  .from(npAgentRuntimeReceipts)
                                  .where(
                                    and(
                                      eq(npAgentRuntimeReceipts.siteId, siteId),
                                      eq(npAgentRuntimeReceipts.state, "emitted"),
                                      gte(npAgentRuntimeReceipts.occurredAt, new Date(startedAt)),
                                      lt(
                                        npAgentRuntimeReceipts.occurredAt,
                                        new Date(startedAt + WINDOW_MS),
                                      ),
                                    ),
                                  );
                                if (Number(usage?.count ?? 0) >= 100) {
                                  await tx
                                    .update(npAgentRuntimeReceipts)
                                    .set({ state: "sampled", failureCode: "COVERAGE_CAPPED" })
                                    .where(eq(npAgentRuntimeReceipts.id, receipt.id));
                                  return "sampled" as const;
                                }
                                const event = eventFor(activity);
                                await npAssertAgentGuardianDeliveryKeyAvailableV1(
                                  tx,
                                  event,
                                  "runtime",
                                );
                                const recorded = await collectionCallback(
                                  tx,
                                  budget,
                                  (callbackDb) => recordEvent({ db: callbackDb, siteId, event }),
                                );
                                const [row] = await npReadAgentEventRowsV1(tx, siteId, [
                                  recorded.eventId,
                                ]);
                                if (!row || !same(await npReadAgentEventRowEvidenceV1(row), event))
                                  sourceFailure();
                                await tx
                                  .update(npAgentRuntimeReceipts)
                                  .set({
                                    state: "emitted",
                                    failureCode: null,
                                    emittedEventId: row.id,
                                    emittedAt: row.recordedAt,
                                  })
                                  .where(eq(npAgentRuntimeReceipts.id, receipt.id));
                                await tx
                                  .update(npAgentEvents)
                                  .set({ dispatchedAt: row.recordedAt })
                                  .where(
                                    and(
                                      eq(npAgentEvents.siteId, siteId),
                                      eq(npAgentEvents.id, row.id),
                                    ),
                                  );
                                await detect(tx, activity, currentTime, budget);
                                budget.checkpoint();
                                return "emitted" as const;
                              } finally {
                                receiptScope.close();
                              }
                            }),
                        );
                        result[outcome] += 1;
                      } catch (error) {
                        budget.checkpoint();
                        if (error instanceof CollectionTimeout) throw error;
                        const failureCode =
                          error instanceof SourceFailure ? error.code : "DELIVERY_UNAVAILABLE";
                        await db
                          .update(npAgentRuntimeReceipts)
                          .set({
                            state: "blocked",
                            failureCode,
                            nextAttemptAt: new Date(currentTime.getTime() + RETRY_MS),
                          })
                          .where(
                            and(
                              eq(npAgentRuntimeReceipts.siteId, siteId),
                              eq(npAgentRuntimeReceipts.id, receipt.id),
                            ),
                          );
                        result.blocked += 1;
                      } finally {
                        maximumReceiptWorkMs = Math.max(
                          maximumReceiptWorkMs,
                          performance.now() - receiptStartedAt,
                        );
                      }
                    }
                    budget.checkpoint();
                    if (result.backlog === null) return result;
                    const [remaining] = await db
                      .select({ count: count() })
                      .from(npAgentRuntimeReceipts)
                      .where(
                        and(
                          eq(npAgentRuntimeReceipts.siteId, siteId),
                          inArray(npAgentRuntimeReceipts.state, ["pending", "blocked"]),
                        ),
                      );
                    result.backlog = Number(remaining?.count ?? 0);
                    return result;
                  },
                  scope.db,
                ),
              ),
            );
            budget.checkpoint();
            return collected;
          } finally {
            scope.close();
          }
        }),
      );
    },
    async verifyReceiptForRetention(input) {
      const siteId = canonicalBodySiteId(input.siteId, "guardian.runtime.siteId");
      const receiptId = canonicalBodyUuid(input.receiptId, "guardian.runtime.receiptId");
      if (!installed.has(siteId)) unavailable();
      const [receipt] = await input.db
        .select()
        .from(npAgentRuntimeReceipts)
        .where(
          and(eq(npAgentRuntimeReceipts.siteId, siteId), eq(npAgentRuntimeReceipts.id, receiptId)),
        )
        .limit(1);
      if (!receipt || !["pending", "blocked", "emitted", "sampled", "held"].includes(receipt.state))
        unavailable();
      const activity = await verifyReceipt(receipt, time(), input.db);
      return {
        sourceProofDigest: receipt.bodyHash,
        occurredAt: activity.occurredAt,
        state: receipt.state as "pending" | "blocked" | "emitted" | "sampled" | "held",
        emittedEventId: receipt.emittedEventId,
      };
    },
    async verifySignal(input) {
      if (!installed.has(input.siteId)) return false;
      return npVerifyGuardianSignalRuleV1(input, async (row, ids) => {
        const detector = npAgentGuardianRuntimeDetectorIdsV1.find((id) => id === row.detectorId);
        if (!detector) return sourceFailure();
        const rows = await npReadAgentEventRowsV1(input.db, input.siteId, ids);
        return (await candidate(await verifyEvents(input.db, rows, time()), detector)).candidate;
      });
    },
    async verifyEvent(input) {
      const siteId = canonicalBodySiteId(input.siteId, "guardian.runtime.siteId");
      const eventId = canonicalBodyUuid(input.eventId, "guardian.runtime.eventId");
      if (!installed.has(siteId)) unavailable();
      try {
        const rows = await npReadAgentEventRowsV1(input.db, siteId, [eventId]);
        if (rows.length !== 1) unavailable();
        const [proof] = await verifyEvents(input.db, rows, time());
        return npRequireAgentGuardianVerifiedEventV1({
          schemaVersion: "np.agent-guardian-verified-event.v1",
          eventId,
          source: "runtime",
          observedAt: proof.activity.occurredAt,
          sourceDigest: proof.row.eventHash,
          detectorId: null,
        });
      } catch {
        return unavailable();
      }
    },
    async evidence(input) {
      const siteId = canonicalBodySiteId(input.siteId, "guardian.runtime.siteId");
      if (!installed.has(siteId)) unavailable();
      const authorization = await npResolveAgentStaffSessionAuthorizationV1(
        input.db,
        siteId,
        input.actor,
        time(),
      );
      if (!authorization.authority.capabilities.includes("admin.manage")) unavailable();
      const evidence = await evidenceProof(input, time());
      if (
        !same(
          authorization,
          await npResolveAgentStaffSessionAuthorizationV1(input.db, siteId, input.actor, time()),
        )
      )
        unavailable();
      return evidence;
    },
    async assessmentEvidence(input) {
      return evidenceProof(input, time());
    },
  };
}
