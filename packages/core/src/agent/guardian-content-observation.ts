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
import type { getDb } from "../db/runtime.js";
import { npAgentEvents, npAgentIncidents, npAgentSignals } from "../db/schema/agent.js";
import { npAgentContentReceipts } from "../db/schema/guardian.js";
import { npUsers } from "../db/schema/system.js";
import { npUserRoles, type NpAuthUser } from "../auth-contract/types.js";
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
  npAgentGuardianContentDetectorIdsV1,
  npRequireAgentGuardianContentActivityV1,
  npRequireAgentGuardianContentEvidenceV1,
  type NpAgentGuardianContentActivityV1,
  type NpAgentGuardianContentEvidenceV1,
} from "../agent-contract/guardian-content-contract.js";
import {
  npRequireAgentGuardianVerifiedEventV1,
  type NpAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import type { NpAgentEventCanonicalV1 } from "../agent-contract/types.js";
import type {
  NpCollectionMutationObservationV1,
  NpCollectionMutationObserverV1,
} from "../collections/mutation-observer.js";
import {
  npAssertCollectionReadAccess,
  npGetPersistedCollectionDocumentById,
  type NpTransaction,
} from "../collections/pipeline.js";
import { getCollectionConfig } from "../collections/registry.js";
import { withCurrentSite } from "../sites/context.js";
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
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import type { NpAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";

type Db = ReturnType<typeof getDb>;
type Receipt = typeof npAgentContentReceipts.$inferSelect;
type EventRow = typeof npAgentEvents.$inferSelect;
type Detector = (typeof npAgentGuardianContentDetectorIdsV1)[number];
type Failure = "KEY_UNAVAILABLE" | "SOURCE_INTEGRITY" | "DELIVERY_UNAVAILABLE";
interface Proof {
  row: EventRow;
  activity: NpAgentGuardianContentActivityV1;
}
const COMPONENT = "guardian.content.v1";
const RECEIPT_DOMAIN = "np.agent-guardian-content-source.v1";
const WINDOW_MS = 600_000;
const RETRY_MS = 300_000;
const same = (left: unknown, right: unknown) =>
  serializeAgentCanonicalJson(left) === serializeAgentCanonicalJson(right);
const digest = (value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const windowStart = (time: number) => Math.floor(time / WINDOW_MS) * WINDOW_MS;
const documentSubject = (activity: NpAgentGuardianContentActivityV1) => ({
  kind: "document" as const,
  collection: activity.collection,
  documentId: activity.documentId,
});
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_CONTENT_EVIDENCE_UNAVAILABLE",
    409,
    "Content observation evidence is unavailable.",
  );
}
class SourceFailure extends Error {
  constructor(readonly code: Failure) {
    super(code);
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
  input: NpCollectionMutationObservationV1,
): NpAgentGuardianContentActivityV1 {
  const revision = input.fact.revision;
  const activity = npRequireAgentGuardianContentActivityV1({
    schemaVersion: "np.agent-guardian-content-activity.v1",
    writeId: input.writeId,
    siteId: input.siteId,
    collection: input.collection,
    documentId: input.documentId,
    occurredAt: isoDate(input.occurredAt),
    actor: input.actor,
    fact: {
      ...input.fact,
      revision: revision === null ? null : { ...revision, createdAt: isoDate(revision.createdAt) },
    },
  });
  if (activity.fact.revision && activity.fact.revision.createdAt > activity.occurredAt)
    unavailable();
  return activity;
}
function account(activity: NpAgentGuardianContentActivityV1): string | null {
  return activity.actor.kind === "staff"
    ? `staff:${activity.actor.userId}`
    : activity.actor.kind === "member"
      ? `member:${activity.actor.memberId}`
      : null;
}
function correlation(activity: NpAgentGuardianContentActivityV1, detectorId: Detector): string {
  return digest({
    domain: "np.guardian-content-correlation.v1",
    siteId: activity.siteId,
    detectorId,
    detectorVersion: 1,
    document: documentSubject(activity),
  });
}
function ordered(proofs: readonly Proof[]): Proof[] {
  return [...proofs].sort(
    (left, right) =>
      left.activity.occurredAt.localeCompare(right.activity.occurredAt) ||
      left.activity.writeId.localeCompare(right.activity.writeId),
  );
}
function cohort(proofs: readonly Proof[], detector: Detector): Proof[] | null {
  const sorted = ordered(proofs);
  if (detector === "guardian.revision-volume") {
    const seen = new Set<string>();
    const result = sorted.filter(({ activity }) => {
      const id = activity.fact.revision?.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return result.length >= 20 ? result.slice(0, 20) : null;
  }
  const saves = sorted.filter(
    ({ activity }) => activity.fact.kind === "document-save" && account(activity) !== null,
  );
  if (saves.length < 5) return null;
  const accounts = new Set<string>();
  const selected: Proof[] = [];
  for (const proof of saves) {
    const id = account(proof.activity);
    if (id && !accounts.has(id)) {
      accounts.add(id);
      selected.push(proof);
      if (selected.length === 3) break;
    }
  }
  if (selected.length !== 3) return null;
  return ordered([...selected, ...saves.filter((proof) => !selected.includes(proof))].slice(0, 5));
}

export interface NpAgentGuardianContentObservationOptionsV1 {
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
export interface NpAgentGuardianContentCollectionResultV1 {
  state: "collecting" | "disabled";
  processed: number;
  emitted: number;
  blocked: number;
  sampled: number;
  held: number;
  /** Actual retained pending/blocked facts, including delayed retries. */
  backlog: number | null;
}
export interface NpAgentGuardianContentObservationServiceV1 {
  mutationObserver: NpCollectionMutationObserverV1;
  collect(input: {
    siteId: string;
    limit?: number;
  }): Promise<NpAgentGuardianContentCollectionResultV1>;
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
  }): Promise<NpAgentGuardianContentEvidenceV1[]>;
}

/** Explicit source and maintenance owner. No registry, worker or response policy is installed. */
export function createAgentGuardianContentObservationServiceV1(
  options: NpAgentGuardianContentObservationOptionsV1,
): NpAgentGuardianContentObservationServiceV1 {
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
    options.installedSiteIds.map((id) => canonicalBodySiteId(id, "guardian.content.siteId")),
  );
  const authorize = options.authorize.bind(options);
  const recordEvent = options.events.record.bind(options.events);
  const resolveRetainedKey = options.resolveReceiptKey?.bind(options);
  const notifications = options.notifications;
  const now = options.now ?? (() => new Date());
  const time = () => new Date(isoDate(now()));
  const resolveKey = async (id: string) => {
    if (id === currentKeyId) return currentKey;
    let key: Uint8Array | null | undefined;
    try {
      key = await npAwaitAgentGuardianHostReadV1(() => resolveRetainedKey?.(id));
    } catch {
      return sourceFailure("KEY_UNAVAILABLE");
    }
    if (!validKey(key)) sourceFailure("KEY_UNAVAILABLE");
    return new Uint8Array(key);
  };
  const mac = (key: Uint8Array, id: string, body: NpAgentGuardianContentActivityV1, hash: string) =>
    `hmac-sha256:${createHmac("sha256", key)
      .update(RECEIPT_DOMAIN)
      .update("\0")
      .update(
        serializeAgentCanonicalJson({
          receiptId: body.writeId,
          siteId: body.siteId,
          keyId: id,
          bodyHash: hash,
          body,
        }),
      )
      .digest("base64url")}`;
  function eventFor(activity: NpAgentGuardianContentActivityV1): NpAgentEventCanonicalV1 {
    return npRequireAgentEventCanonical({
      version: "np.agent-event.v1",
      siteId: activity.siteId,
      kind: "content.activity.observed",
      occurredAt: activity.occurredAt,
      source: { kind: "content", component: COMPONENT },
      subject: documentSubject(activity),
      actor: { ...activity.actor },
      causation: null,
      correlationId: null,
      deduplicationKey: `content:${activity.writeId}`,
      privacy: "sensitive",
      payload: { kind: "content.activity.observed", receiptId: activity.writeId, activity },
    });
  }
  async function verifyReceipt(row: Receipt, currentTime: Date) {
    let activity: NpAgentGuardianContentActivityV1;
    try {
      activity = npRequireAgentGuardianContentActivityV1(row.body);
      if (
        row.id !== activity.writeId ||
        row.siteId !== activity.siteId ||
        isoDate(row.occurredAt) !== activity.occurredAt ||
        Date.parse(activity.occurredAt) > currentTime.getTime() ||
        (activity.fact.revision && activity.fact.revision.createdAt > activity.occurredAt) ||
        digest(activity) !== row.bodyHash ||
        !/^hmac-sha256:[A-Za-z0-9_-]{43}$/u.test(row.sourceMac)
      )
        sourceFailure();
      keyId(row.keyId);
    } catch {
      return sourceFailure();
    }
    const key = await resolveKey(row.keyId);
    const expected = mac(key, row.keyId, activity, row.bodyHash);
    if (!timingSafeEqual(Buffer.from(row.sourceMac), Buffer.from(expected))) sourceFailure();
    return activity;
  }
  async function verifyEvents(
    db: Db,
    rows: readonly EventRow[],
    currentTime: Date,
  ): Promise<Proof[]> {
    const parsed = await Promise.all(rows.map((row) => npReadAgentEventRowEvidenceV1(row)));
    const ids = parsed.map((event) => {
      if (event.payload.kind !== "content.activity.observed") return sourceFailure();
      return event.payload.receiptId;
    });
    if (new Set(ids).size !== ids.length) sourceFailure();
    const receipts: Receipt[] = [];
    for (let offset = 0; offset < ids.length; offset += 100)
      receipts.push(
        ...(await db
          .select()
          .from(npAgentContentReceipts)
          .where(
            and(
              eq(npAgentContentReceipts.siteId, rows[0].siteId),
              inArray(npAgentContentReceipts.id, ids.slice(offset, offset + 100)),
            ),
          )),
      );
    if (receipts.length !== rows.length) sourceFailure();
    const byId = new Map(receipts.map((row) => [row.id, row]));
    const proofs: Proof[] = [];
    for (const [index, row] of rows.entries()) {
      const receipt = byId.get(ids[index]);
      if (!receipt) sourceFailure();
      proofs.push(await verifyProof(row, receipt, currentTime, parsed[index]));
    }
    return proofs;
  }
  async function verifyProof(
    row: EventRow,
    receipt: Receipt,
    currentTime: Date,
    event?: NpAgentEventCanonicalV1,
  ): Promise<Proof> {
    const activity = await verifyReceipt(receipt, currentTime);
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
  async function candidate(proofs: readonly Proof[], detector: Detector) {
    const selected = cohort(proofs, detector);
    if (!selected || selected.length !== proofs.length) sourceFailure();
    const first = selected[0].activity;
    const startedAt = windowStart(Date.parse(first.occurredAt));
    if (
      selected.some(
        ({ activity }) =>
          activity.siteId !== first.siteId ||
          !same(documentSubject(activity), documentSubject(first)) ||
          windowStart(Date.parse(activity.occurredAt)) !== startedAt,
      )
    )
      sourceFailure();
    const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId: first.siteId,
      detectorId: detector,
      detectorVersion: 1,
      category: "integrity",
      subject: documentSubject(first),
      window: {
        startedAt: new Date(startedAt).toISOString(),
        endedAt: selected[selected.length - 1].activity.occurredAt,
      },
      evidence: selected
        .map(({ row, activity }) => ({
          kind: "event",
          eventId: row.id,
          eventKind: "content.activity.observed",
          observedAt: activity.occurredAt,
          digest: Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString(
            "hex",
          ),
          excerpt: null,
        }))
        .sort(
          (left, right) =>
            left.observedAt.localeCompare(right.observedAt) ||
            left.eventId.localeCompare(right.eventId),
        ),
    });
    const result: NpIncidentObservationCandidate = {
      canonicalEvidence,
      evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonicalEvidence),
      fingerprint: correlation(first, detector),
      severity: detector === "guardian.content-churn" ? "medium" : "low",
      confidenceBasis: "exact-rule",
      scoreBasisPoints: null,
      title:
        detector === "guardian.content-churn"
          ? "Committed content changes for review"
          : "Recorded revision volume for review",
      summary:
        detector === "guardian.content-churn"
          ? "At least five committed saves by at least three distinct staff or member accounts were observed in ten minutes. This activity does not establish malicious intent."
          : "At least twenty distinct persisted revisions were observed in ten minutes. This activity does not establish malicious intent.",
    };
    return {
      candidate: result,
      distinctAccountCount: new Set(
        selected.map(({ activity }) => account(activity)).filter((value) => value !== null),
      ).size,
    };
  }
  async function detect(db: Db, activity: NpAgentGuardianContentActivityV1, currentTime: Date) {
    const startedAt = windowStart(Date.parse(activity.occurredAt));
    const receipts = await db
      .select()
      .from(npAgentContentReceipts)
      .where(
        and(
          eq(npAgentContentReceipts.siteId, activity.siteId),
          eq(npAgentContentReceipts.state, "emitted"),
          sql`${npAgentContentReceipts.body}->>'collection'=${activity.collection}`,
          sql`${npAgentContentReceipts.body}->>'documentId'=${activity.documentId}`,
          gte(npAgentContentReceipts.occurredAt, new Date(startedAt)),
          lt(npAgentContentReceipts.occurredAt, new Date(startedAt + WINDOW_MS)),
        ),
      )
      .orderBy(asc(npAgentContentReceipts.occurredAt), asc(npAgentContentReceipts.id))
      .limit(101);
    if (receipts.length > 100) sourceFailure();
    const rows = await npReadAgentEventRowsV1(
      db,
      activity.siteId,
      receipts.flatMap((row) => (row.emittedEventId ? [row.emittedEventId] : [])),
    );
    const proofs: Proof[] = [];
    const receiptsByEvent = new Map(receipts.map((receipt) => [receipt.emittedEventId, receipt]));
    // Corrupt older retained sources cannot contaminate a new valid cohort.
    for (const row of rows) {
      try {
        const receipt = receiptsByEvent.get(row.id);
        if (receipt) proofs.push(await verifyProof(row, receipt, currentTime));
      } catch {
        /* Retain but do not count unverifiable facts. */
      }
    }
    for (const detector of npAgentGuardianContentDetectorIdsV1) {
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
      const selected = cohort(proofs, detector);
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
          const rebuilt = (await candidate(await verifyEvents(tx, current, currentTime), detector))
            .candidate;
          return same(rebuilt, detected);
        },
      });
    }
  }
  return {
    mutationObserver: {
      async record(input) {
        npAssertAgentPreviewEffectsAllowed();
        const siteId = canonicalBodySiteId(input.siteId, "guardian.content.siteId");
        if (!installed.has(siteId)) return;
        const activity = copiedActivity(input);
        if (
          (await npReadAgentGuardianCaptureAdmissionV1(input.db as unknown as Db, siteId)).state ===
          "disabled"
        )
          return;
        const bodyHash = digest(activity);
        await input.db.insert(npAgentContentReceipts).values({
          id: activity.writeId,
          siteId,
          body: activity,
          bodyHash,
          keyId: currentKeyId,
          sourceMac: mac(currentKey, currentKeyId, activity, bodyHash),
          occurredAt: new Date(activity.occurredAt),
          createdAt: new Date(activity.occurredAt),
          nextAttemptAt: new Date(activity.occurredAt),
          state: "pending",
        });
      },
    },
    async collect(input) {
      npAssertAgentPreviewEffectsAllowed();
      const siteId = canonicalBodySiteId(input.siteId, "guardian.content.siteId");
      const limit = input.limit ?? 25;
      if (!installed.has(siteId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 25)
        unavailable();
      return npWithAgentRuntimeControlTransactionV1(siteId, async ({ db }) => {
        if ((await npReadAgentGuardianCaptureAdmissionV1(db, siteId)).state === "disabled")
          return {
            state: "disabled",
            processed: 0,
            emitted: 0,
            blocked: 0,
            sampled: 0,
            held: 0,
            backlog: null,
          };
        await authorize({ db, siteId });
        const currentTime = time();
        const closure = await npReadAgentGuardianSourceClosureV1(db, siteId, "content");
        const pending = await db
          .select()
          .from(npAgentContentReceipts)
          .where(
            and(
              eq(npAgentContentReceipts.siteId, siteId),
              inArray(npAgentContentReceipts.state, ["pending", "blocked"]),
              lte(npAgentContentReceipts.nextAttemptAt, currentTime),
            ),
          )
          .orderBy(
            asc(npAgentContentReceipts.nextAttemptAt),
            asc(npAgentContentReceipts.createdAt),
            asc(npAgentContentReceipts.id),
          )
          .limit(limit)
          .for("update", { skipLocked: true });
        const result = {
          state: "collecting" as const,
          processed: pending.length,
          emitted: 0,
          blocked: 0,
          sampled: 0,
          held: 0,
          backlog: 0,
        };
        for (const receipt of pending) {
          try {
            const outcome = await db.transaction(async (savepoint) => {
              const tx = savepoint as unknown as Db;
              const activity = await verifyReceipt(receipt, currentTime);
              if (closure && activity.occurredAt < closure.closedBefore) {
                await tx
                  .update(npAgentContentReceipts)
                  .set({ state: "held", failureCode: "DELIVERY_CLOSED" })
                  .where(
                    and(
                      eq(npAgentContentReceipts.siteId, siteId),
                      eq(npAgentContentReceipts.id, receipt.id),
                    ),
                  );
                return "held" as const;
              }
              const startedAt = windowStart(Date.parse(activity.occurredAt));
              const [usage] = await tx
                .select({ count: count() })
                .from(npAgentContentReceipts)
                .where(
                  and(
                    eq(npAgentContentReceipts.siteId, siteId),
                    eq(npAgentContentReceipts.state, "emitted"),
                    gte(npAgentContentReceipts.occurredAt, new Date(startedAt)),
                    lt(npAgentContentReceipts.occurredAt, new Date(startedAt + WINDOW_MS)),
                  ),
                );
              if (Number(usage?.count ?? 0) >= 100) {
                await tx
                  .update(npAgentContentReceipts)
                  .set({ state: "sampled", failureCode: "COVERAGE_CAPPED" })
                  .where(eq(npAgentContentReceipts.id, receipt.id));
                return "sampled" as const;
              }
              const event = eventFor(activity);
              await npAssertAgentGuardianDeliveryKeyAvailableV1(tx, event, "content");
              const recorded = await recordEvent({ db: tx, siteId, event });
              const [row] = await npReadAgentEventRowsV1(tx, siteId, [recorded.eventId]);
              if (!row || !same(await npReadAgentEventRowEvidenceV1(row), event)) sourceFailure();
              await tx
                .update(npAgentContentReceipts)
                .set({
                  state: "emitted",
                  failureCode: null,
                  emittedEventId: row.id,
                  emittedAt: row.recordedAt,
                })
                .where(eq(npAgentContentReceipts.id, receipt.id));
              await tx
                .update(npAgentEvents)
                .set({ dispatchedAt: row.recordedAt })
                .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, row.id)));
              await detect(tx, activity, currentTime);
              return "emitted" as const;
            });
            result[outcome] += 1;
          } catch (error) {
            const failureCode =
              error instanceof SourceFailure ? error.code : "DELIVERY_UNAVAILABLE";
            await db
              .update(npAgentContentReceipts)
              .set({
                state: "blocked",
                failureCode,
                nextAttemptAt: new Date(currentTime.getTime() + RETRY_MS),
              })
              .where(
                and(
                  eq(npAgentContentReceipts.siteId, siteId),
                  eq(npAgentContentReceipts.id, receipt.id),
                ),
              );
            result.blocked += 1;
          }
        }
        const [remaining] = await db
          .select({ count: count() })
          .from(npAgentContentReceipts)
          .where(
            and(
              eq(npAgentContentReceipts.siteId, siteId),
              inArray(npAgentContentReceipts.state, ["pending", "blocked"]),
            ),
          );
        result.backlog = Number(remaining?.count ?? 0);
        return result;
      });
    },
    async verifyReceiptForRetention(input) {
      const siteId = canonicalBodySiteId(input.siteId, "guardian.content.siteId");
      const receiptId = canonicalBodyUuid(input.receiptId, "guardian.content.receiptId");
      if (!installed.has(siteId)) unavailable();
      const [receipt] = await input.db
        .select()
        .from(npAgentContentReceipts)
        .where(
          and(eq(npAgentContentReceipts.siteId, siteId), eq(npAgentContentReceipts.id, receiptId)),
        )
        .limit(1);
      if (!receipt || !["pending", "blocked", "emitted", "sampled", "held"].includes(receipt.state))
        unavailable();
      const activity = await verifyReceipt(receipt, time());
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
        const detector = npAgentGuardianContentDetectorIdsV1.find((id) => id === row.detectorId);
        if (!detector) return sourceFailure();
        const rows = await npReadAgentEventRowsV1(input.db, input.siteId, ids);
        return (await candidate(await verifyEvents(input.db, rows, time()), detector)).candidate;
      });
    },
    async verifyEvent(input) {
      const siteId = canonicalBodySiteId(input.siteId, "guardian.content.siteId");
      const eventId = canonicalBodyUuid(input.eventId, "guardian.content.eventId");
      if (!installed.has(siteId)) unavailable();
      try {
        const rows = await npReadAgentEventRowsV1(input.db, siteId, [eventId]);
        if (rows.length !== 1) unavailable();
        const [proof] = await verifyEvents(input.db, rows, time());
        return npRequireAgentGuardianVerifiedEventV1({
          schemaVersion: "np.agent-guardian-verified-event.v1",
          eventId,
          source: "content",
          observedAt: proof.activity.occurredAt,
          sourceDigest: proof.row.eventHash,
          detectorId: null,
        });
      } catch {
        return unavailable();
      }
    },
    async evidence(input) {
      const siteId = canonicalBodySiteId(input.siteId, "guardian.content.siteId");
      if (!installed.has(siteId)) unavailable();
      const currentTime = time();
      const authorization = await npResolveAgentStaffSessionAuthorizationV1(
        input.db,
        siteId,
        input.actor,
        currentTime,
      );
      if (!authorization.authority.capabilities.includes("admin.manage")) unavailable();
      const [storedUser] = await input.db
        .select()
        .from(npUsers)
        .where(eq(npUsers.id, authorization.userId))
        .limit(1);
      const role =
        authorization.authority.kind === "super-admin" ? "admin" : authorization.authority.role;
      const effectiveRole = npUserRoles.find((registered) => registered === role);
      if (!storedUser || !effectiveRole) unavailable();
      const user: NpAuthUser = {
        id: storedUser.id,
        email: storedUser.email,
        name: storedUser.name,
        role: effectiveRole,
        tokenVersion: storedUser.tokenVersion,
      };
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
      const documents = new Map<string, { collection: string; documentId: string }>();
      const evidence: NpAgentGuardianContentEvidenceV1[] = [];
      for (const signal of signals) {
        if (!npAgentGuardianContentDetectorIdsV1.some((id) => id === signal.detectorId))
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
          signal.category !== "integrity" ||
          input.incident.category !== "integrity" ||
          input.incident.fingerprint !== c.fingerprint ||
          !same(input.incident.primarySubject, c.canonicalEvidence.subject)
        )
          unavailable();
        const activity = exact[0].activity;
        const document = { collection: activity.collection, documentId: activity.documentId };
        documents.set(`${document.collection}:${document.documentId}`, document);
        evidence.push(
          npRequireAgentGuardianContentEvidenceV1({
            schemaVersion: "np.agent-guardian-content-evidence.v1",
            signalId: signal.id,
            detectorId: detector,
            detectorVersion: 1,
            document,
            window: c.canonicalEvidence.window,
            basis:
              detector === "guardian.content-churn" ? "committed-saves" : "persisted-revisions",
            observedCount: exact.length,
            distinctAccountCount: rebuilt.distinctAccountCount,
            countBasis: "at-least",
            sourceDigest: c.evidenceDigest,
          }),
        );
      }
      await withCurrentSite(siteId, async () => {
        for (const document of documents.values()) {
          const current = await npGetPersistedCollectionDocumentById(
            document.collection,
            document.documentId,
            siteId,
            { tx: input.db as unknown as NpTransaction },
          );
          if (!current) unavailable();
          await npAssertCollectionReadAccess(
            getCollectionConfig(document.collection),
            document.collection,
            user,
            current,
          );
        }
      });
      if (
        !same(
          authorization,
          await npResolveAgentStaffSessionAuthorizationV1(input.db, siteId, input.actor, time()),
        )
      )
        unavailable();
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
    },
  };
}
