import { npAwaitAgentGuardianHostReadV1 } from "./guardian-host-read.js";
import {
  npVerifyGuardianSignalRuleV1,
  type NpGuardianSignalRuleVerificationV1,
} from "./guardian-signal-rule-verifier.js";
import { npReadAgentGuardianCaptureAdmissionV1 } from "./guardian-capture-admission.js";
import {
  npIsAgentGuardianSourceDeliveryClosedV1,
  npAssertAgentGuardianDeliveryKeyAvailableV1,
} from "./guardian-source-closure.js";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAgentEvents, npAgentSignals } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentEventCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import {
  NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1,
  NP_AGENT_GUARDIAN_EXTERNAL_SITE_EVENT_LIMIT_V1,
  npRequireAgentExternalSignalAdapterIdentityV1,
  npRequireAgentGuardianExternalEvidenceV1,
  type NpAgentGuardianExternalEvidenceV1,
} from "../agent-contract/guardian-external-contract.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import {
  npRequireAgentGuardianVerifiedEventV1,
  type NpAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
import { npReadAgentIncidentCanonicalSourcesV1 } from "./incident-source-evidence.js";
import {
  npObserveIncidentCandidate,
  type NpIncidentObservationCandidate,
} from "./incident-observation-service.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import type { NpAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";
import {
  createAgentSentryIssueCreatedAdapterV1,
  npRequireAgentSentrySignatureKeyIdV1,
  type NpAgentSentryIssueCreatedAdapterOptionsV1,
} from "./guardian-sentry-adapter.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;
const RECEIPT_SCHEMA = "np.agent-guardian-external-source.v1";
const SOURCE_ACTION = "agent.guardian_external.source";
const SYSTEM_ACTOR = { kind: "system", component: "guardian.external" } as const;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const digest = (value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
function unavailable(code = "GUARDIAN_EXTERNAL_EVIDENCE_UNAVAILABLE", status = 409): never {
  throw new NpAgentGatewayError(code, status, "External security signal is unavailable.");
}
function validKey(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length >= 32 && value.length <= 64;
}
export interface NpAgentGuardianExternalObservationOptionsV1 {
  /** One explicit host mapping. No HTTP field or admin picker chooses its site. */
  binding: { id: string; siteId: string; installationId: string; projectId: string };
  signatureKeys: NpAgentSentryIssueCreatedAdapterOptionsV1["signatureKeys"];
  /** Existing host integrity key, independent from the upstream integration secret. */
  receiptKey: { id: string; bytes: Uint8Array };
  resolveReceiptKey?(id: string): Uint8Array | null | Promise<Uint8Array | null>;
  isInstalledSite(siteId: string): Promise<boolean>;
  authorize(input: { db: Db; siteId: string }): Promise<void>;
  events: Pick<NpAgentRuntimeEventServiceV1, "record">;
  notifications?: Pick<NpAgentIncidentNotificationsServiceV1, "record" | "recordFailure">;
  now?: () => Date;
}
export interface NpAgentGuardianExternalObservationInputV1 {
  rawBody: Uint8Array;
  signature: string;
  resource: string;
  signal: AbortSignal;
}
export interface NpAgentGuardianExternalObservationResultV1 {
  disposition: "recorded" | "replayed" | "ignored";
  code:
    | "UNSUPPORTED_RESOURCE"
    | "UNSUPPORTED_ACTION"
    | "UNSUPPORTED_ISSUE_CATEGORY"
    | "STALE_SOURCE"
    | "SOURCE_DISABLED"
    | "SOURCE_CLOSED"
    | null;
  eventId: string | null;
  incidentId: string | null;
}
export interface NpAgentGuardianExternalObservationServiceV1 {
  /** No current source admission is granted; caller owns diagnostic/viewer authority. */
  verifySignal(input: NpGuardianSignalRuleVerificationV1): Promise<boolean>;
  verifyEvent(input: {
    db: Db;
    siteId: string;
    eventId: string;
  }): Promise<NpAgentGuardianVerifiedEventV1>;
  ingest(
    input: NpAgentGuardianExternalObservationInputV1,
  ): Promise<NpAgentGuardianExternalObservationResultV1>;
  /** Current viewer and item authorization remains with the caller's Incident read owner. */
  evidence(input: {
    db: Db;
    siteId: string;
    incident: NpAgentIncidentV1;
  }): Promise<NpAgentGuardianExternalEvidenceV1[]>;
}
/** Explicit local source; installation creates no credentials, route, registry, worker or provider. */
export function createAgentGuardianExternalObservationServiceV1(
  options: NpAgentGuardianExternalObservationOptionsV1,
): NpAgentGuardianExternalObservationServiceV1 {
  const siteId = canonicalBodySiteId(options.binding.siteId, "guardian.external.siteId");
  const bindingId = canonicalBodyUuid(options.binding.id, "guardian.external.bindingId");
  const adapter = createAgentSentryIssueCreatedAdapterV1({
    installationId: options.binding.installationId,
    projectId: options.binding.projectId,
    signatureKeys: options.signatureKeys,
  });
  const identity = npRequireAgentExternalSignalAdapterIdentityV1(adapter.identity);
  const bindingDigest = digest({
    domain: "np.agent-guardian-external-binding.v1",
    bindingId,
    siteId,
    installationId: options.binding.installationId,
    projectId: options.binding.projectId,
  });
  const receiptKeyId = npRequireAgentSentrySignatureKeyIdV1(options.receiptKey.id);
  if (
    !validKey(options.receiptKey.bytes) ||
    typeof options.isInstalledSite !== "function" ||
    typeof options.authorize !== "function" ||
    typeof options.events?.record !== "function"
  )
    unavailable("GUARDIAN_EXTERNAL_INSTALLATION_INVALID", 503);
  const receiptKey = new Uint8Array(options.receiptKey.bytes);
  if (
    options.signatureKeys.some(
      (key) => key.bytes.length === receiptKey.length && timingSafeEqual(key.bytes, receiptKey),
    )
  )
    unavailable("GUARDIAN_EXTERNAL_INSTALLATION_INVALID", 503);
  const now = options.now ?? (() => new Date());
  const externalId = (sourceIdentityDigest: string) =>
    digest({
      domain: "np.agent-guardian-external-id.v1",
      siteId,
      bindingDigest,
      sourceIdentityDigest,
    });
  const sourceMac = (key: Uint8Array, body: unknown) =>
    `hmac-sha256:${createHmac("sha256", key).update(RECEIPT_SCHEMA).update("\0").update(serializeAgentCanonicalJson(body)).digest("base64url")}`;
  async function key(id: string): Promise<Uint8Array> {
    if (id === receiptKeyId) return receiptKey;
    const value = await npAwaitAgentGuardianHostReadV1(() => options.resolveReceiptKey?.(id));
    if (!validKey(value)) unavailable("GUARDIAN_EXTERNAL_SOURCE_KEY_UNAVAILABLE");
    return new Uint8Array(value);
  }
  async function verify(db: Db, row: EventRow) {
    const event = await npReadAgentEventRowEvidenceV1(row);
    const payload = event.payload;
    if (
      event.siteId !== siteId ||
      event.kind !== "security.error.signal" ||
      payload.kind !== "security.error.signal" ||
      !same(event.source, { kind: "integration", component: identity.id }) ||
      !same(event.actor, SYSTEM_ACTOR) ||
      event.subject !== null ||
      event.causation !== null ||
      event.privacy !== "sensitive" ||
      payload.adapterId !== identity.id ||
      payload.category !== "availability" ||
      payload.severity !== "medium" ||
      payload.count !== 1 ||
      event.deduplicationKey !== `external:${payload.externalSignalId}`
    )
      unavailable();
    const receiptId = canonicalBodyUuid(event.correlationId, "guardian.external.sourceReceiptId");
    const [audit] = await db
      .select({
        id: npAuditEvents.id,
        action: npAuditEvents.action,
        actorKind: npAuditEvents.actorKind,
        actorUserId: npAuditEvents.actorUserId,
        actorMemberId: npAuditEvents.actorMemberId,
        targetType: npAuditEvents.targetType,
        targetId: npAuditEvents.targetId,
        createdAt: npAuditEvents.createdAt,
        payload: sql<unknown>`case when octet_length(${npAuditEvents.payload}::text)<=4096 then ${npAuditEvents.payload} else null end`,
      })
      .from(npAuditEvents)
      .where(and(eq(npAuditEvents.siteId, siteId), eq(npAuditEvents.id, receiptId)))
      .limit(1);
    if (!audit) unavailable();
    const fields = [
      "schemaVersion",
      "adapter",
      "bindingDigest",
      "sourceIdentityDigest",
      "bodyDigest",
      "signingKeyId",
      "receiptKeyId",
      "eventId",
      "eventHash",
      "receivedAt",
      "sourceMac",
    ];
    const receipt = canonicalBodyRecord(
      audit.payload,
      "guardian.external.receipt",
      fields,
      fields,
      { seen: new WeakSet<object>() },
    );
    const checkedAdapter = npRequireAgentExternalSignalAdapterIdentityV1(receipt.adapter);
    const checkedBinding = canonicalBodySha256Digest(
      receipt.bindingDigest,
      "guardian.external.bindingDigest",
    );
    const sourceIdentityDigest = canonicalBodySha256Digest(
      receipt.sourceIdentityDigest,
      "guardian.external.sourceIdentityDigest",
    );
    const signingKeyId = npRequireAgentSentrySignatureKeyIdV1(receipt.signingKeyId);
    const signedKeyId = npRequireAgentSentrySignatureKeyIdV1(receipt.receiptKeyId);
    const receivedAt = canonicalBodyUtc(receipt.receivedAt, "guardian.external.receivedAt");
    if (
      typeof receipt.bodyDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(receipt.bodyDigest)
    )
      unavailable();
    const body = {
      schemaVersion: RECEIPT_SCHEMA,
      adapter: checkedAdapter,
      bindingDigest: checkedBinding,
      sourceIdentityDigest,
      bodyDigest: receipt.bodyDigest,
      signingKeyId,
      receiptKeyId: signedKeyId,
      eventId: row.id,
      eventHash: row.eventHash,
      receivedAt,
    };
    const material = await key(signedKeyId);
    if (
      receipt.schemaVersion !== RECEIPT_SCHEMA ||
      !same(checkedAdapter, identity) ||
      checkedBinding !== bindingDigest ||
      receipt.eventId !== row.id ||
      receipt.eventHash !== row.eventHash ||
      externalId(sourceIdentityDigest) !== payload.externalSignalId ||
      receivedAt !== row.recordedAt.toISOString() ||
      Date.parse(event.occurredAt) > Date.parse(receivedAt) + 60_000 ||
      typeof receipt.sourceMac !== "string" ||
      !/^hmac-sha256:[A-Za-z0-9_-]{43}$/u.test(receipt.sourceMac) ||
      !timingSafeEqual(
        Buffer.from(receipt.sourceMac),
        Buffer.from(sourceMac(material, { ...body, siteId })),
      ) ||
      audit.action !== SOURCE_ACTION ||
      audit.actorKind !== "system" ||
      audit.actorUserId !== null ||
      audit.actorMemberId !== null ||
      audit.targetType !== "agent-event" ||
      audit.targetId !== row.id ||
      audit.createdAt.toISOString() !== receivedAt
    )
      unavailable();
    return { event, body };
  }
  async function candidate(db: Db, row: EventRow): Promise<NpIncidentObservationCandidate> {
    const { event } = await verify(db, row);
    if (event.payload.kind !== "security.error.signal") unavailable();
    const startedAt = new Date(
      Math.floor(Date.parse(event.occurredAt) / 600_000) * 600_000,
    ).toISOString();
    const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId,
      detectorId: NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1,
      detectorVersion: 1,
      category: "availability",
      subject: null,
      window: { startedAt, endedAt: event.occurredAt },
      evidence: [
        {
          kind: "event",
          eventId: row.id,
          eventKind: "security.error.signal",
          observedAt: event.occurredAt,
          digest: Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString(
            "hex",
          ),
          excerpt: null,
        },
      ],
    });
    return {
      canonicalEvidence,
      evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonicalEvidence),
      fingerprint: digest({
        domain: "np.agent-guardian-external-correlation.v1",
        siteId,
        adapter: identity,
        bindingDigest,
        detectorVersion: 1,
        externalSignalId: event.payload.externalSignalId,
        startedAt,
      }),
      severity: "medium",
      confidenceBasis: "external",
      scoreBasisPoints: null,
      title: "External error issue created for review",
      summary:
        "One authenticated external error issue creation was observed. Imported evidence does not establish an attack, complete error counts or authority to respond.",
    };
  }
  let inFlight = 0;
  return {
    async ingest(input) {
      npAssertAgentPreviewEffectsAllowed();
      if (inFlight >= 4) unavailable("GUARDIAN_EXTERNAL_SOURCE_BUSY", 503);
      inFlight++;
      try {
        const signal = input.signal;
        const fact = adapter.verifyAndNormalize({ ...input, signal, receivedAt: now() });
        if (fact.kind === "ignored")
          return { disposition: "ignored", code: fact.code, eventId: null, incidentId: null };
        if ((await options.isInstalledSite(siteId)) !== true)
          return {
            disposition: "ignored",
            code: "SOURCE_DISABLED",
            eventId: null,
            incidentId: null,
          };
        const id = externalId(fact.sourceIdentityDigest);
        return await getDb().transaction(
          async (transaction): Promise<NpAgentGuardianExternalObservationResultV1> => {
            const db = transaction as Db;
            const deadline = performance.now() + 750;
            const timeout = await db.execute(
              sql`select extract(epoch from current_setting('statement_timeout')::interval)*1000 as milliseconds`,
            );
            const inherited = Number(timeout.rows[0]?.milliseconds);
            if (!Number.isFinite(inherited) || inherited < 0) unavailable();
            const before = async () => {
              const remaining = Math.min(
                500,
                inherited || 500,
                Math.floor(deadline - performance.now()),
              );
              if (signal.aborted || remaining <= 0) unavailable("GUARDIAN_EXTERNAL_ABORTED", 503);
              await db.execute(
                sql`select set_config('lock_timeout',${`${Math.min(100, remaining)}ms`},true), set_config('statement_timeout',${`${remaining}ms`},true)`,
              );
            };
            await before();
            return npWithAgentRuntimeControlTransactionV1(
              siteId,
              async ({ db: tx }) => {
                if ((await npReadAgentGuardianCaptureAdmissionV1(tx, siteId)).state === "disabled")
                  return {
                    disposition: "ignored",
                    code: "SOURCE_DISABLED",
                    eventId: null,
                    incidentId: null,
                  };
                if (
                  await npIsAgentGuardianSourceDeliveryClosedV1(
                    tx,
                    siteId,
                    "sentry",
                    fact.occurredAt,
                  )
                )
                  return {
                    disposition: "ignored",
                    code: "SOURCE_CLOSED",
                    eventId: null,
                    incidentId: null,
                  };
                await options.authorize({ db: tx, siteId });
                await before();
                const [previous] = await tx
                  .select()
                  .from(npAgentEvents)
                  .where(
                    and(
                      eq(npAgentEvents.siteId, siteId),
                      eq(npAgentEvents.kind, "security.error.signal"),
                      eq(npAgentEvents.sourceComponent, identity.id),
                      eq(npAgentEvents.deduplicationKey, `external:${id}`),
                    ),
                  )
                  .limit(1);
                let row: EventRow;
                if (previous) {
                  const proof = await verify(tx, previous);
                  if (
                    proof.body.bodyDigest !== fact.bodyDigest ||
                    proof.body.sourceIdentityDigest !== fact.sourceIdentityDigest ||
                    proof.event.occurredAt !== fact.occurredAt
                  )
                    unavailable("GUARDIAN_EXTERNAL_SOURCE_CONFLICT");
                  row = previous;
                } else {
                  if (fact.freshness === "stale")
                    return {
                      disposition: "ignored",
                      code: "STALE_SOURCE",
                      eventId: null,
                      incidentId: null,
                    };
                  const captureTime = now();
                  const windowStart = new Date(
                    Math.floor(captureTime.getTime() / 600_000) * 600_000,
                  );
                  const windowEnd = new Date(windowStart.getTime() + 600_000);
                  const retained = await tx
                    .select({ id: npAgentEvents.id })
                    .from(npAgentEvents)
                    .where(
                      and(
                        eq(npAgentEvents.siteId, siteId),
                        eq(npAgentEvents.sourceComponent, identity.id),
                        gte(npAgentEvents.recordedAt, windowStart),
                        lt(npAgentEvents.recordedAt, windowEnd),
                      ),
                    )
                    .limit(NP_AGENT_GUARDIAN_EXTERNAL_SITE_EVENT_LIMIT_V1);
                  if (retained.length >= NP_AGENT_GUARDIAN_EXTERNAL_SITE_EVENT_LIMIT_V1)
                    unavailable("GUARDIAN_EXTERNAL_SOURCE_CAP_REACHED", 429);
                  const receiptId = randomUUID();
                  const event = npRequireAgentEventCanonical({
                    version: "np.agent-event.v1",
                    siteId,
                    kind: "security.error.signal",
                    occurredAt: fact.occurredAt,
                    source: { kind: "integration", component: identity.id },
                    subject: null,
                    actor: SYSTEM_ACTOR,
                    causation: null,
                    correlationId: receiptId,
                    deduplicationKey: `external:${id}`,
                    privacy: "sensitive",
                    payload: {
                      kind: "security.error.signal",
                      adapterId: identity.id,
                      externalSignalId: id,
                      category: "availability",
                      severity: "medium",
                      count: 1,
                    },
                  });
                  await before();
                  await npAssertAgentGuardianDeliveryKeyAvailableV1(tx, event, "sentry");
                  const recorded = await options.events.record({ db: tx, siteId, event });
                  if (recorded.replayed) unavailable();
                  const rows = await npReadAgentEventRowsV1(tx, siteId, [recorded.eventId]);
                  if (
                    rows.length !== 1 ||
                    !same(await npReadAgentEventRowEvidenceV1(rows[0]), event)
                  )
                    unavailable();
                  row = rows[0];
                  if (
                    row.recordedAt < captureTime ||
                    row.recordedAt > now() ||
                    row.recordedAt >= windowEnd
                  )
                    unavailable();
                  const body = {
                    schemaVersion: RECEIPT_SCHEMA,
                    adapter: identity,
                    bindingDigest,
                    sourceIdentityDigest: fact.sourceIdentityDigest,
                    bodyDigest: fact.bodyDigest,
                    signingKeyId: fact.signingKeyId,
                    receiptKeyId,
                    eventId: row.id,
                    eventHash: row.eventHash,
                    receivedAt: row.recordedAt.toISOString(),
                  };
                  await before();
                  await tx.insert(npAuditEvents).values({
                    id: receiptId,
                    siteId,
                    actorKind: "system",
                    actorUserId: null,
                    actorMemberId: null,
                    action: SOURCE_ACTION,
                    targetType: "agent-event",
                    targetId: row.id,
                    payload: { ...body, sourceMac: sourceMac(receiptKey, { ...body, siteId }) },
                    createdAt: row.recordedAt,
                  });
                }
                await before();
                const detected = await candidate(tx, row);
                const observed = await npObserveIncidentCandidate({
                  transaction: tx,
                  candidate: detected,
                  now,
                  notifications: options.notifications,
                  resolveEvidence: async (readDb) => {
                    const rows = await npReadAgentEventRowsV1(readDb, siteId, [row.id]);
                    if (rows.length !== 1) return false;
                    const rebuilt = await candidate(readDb, rows[0]);
                    return (
                      same(rebuilt.canonicalEvidence, detected.canonicalEvidence) &&
                      rebuilt.fingerprint === detected.fingerprint
                    );
                  },
                });
                await before();
                await tx
                  .update(npAgentEvents)
                  .set({ dispatchedAt: row.recordedAt })
                  .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, row.id)));
                await before();
                return {
                  disposition: previous ? "replayed" : "recorded",
                  code: null,
                  eventId: row.id,
                  incidentId: observed.incidentId,
                };
              },
              db,
            );
          },
        );
      } catch (error) {
        if (error instanceof NpAgentGatewayError) throw error;
        return unavailable("GUARDIAN_EXTERNAL_SOURCE_UNAVAILABLE", 503);
      } finally {
        inFlight--;
      }
    },
    async verifySignal(input) {
      if (input.siteId !== siteId) return false;
      return npVerifyGuardianSignalRuleV1(input, async (_row, ids) => {
        if (ids.length !== 1) return unavailable();
        const rows = await npReadAgentEventRowsV1(input.db, input.siteId, ids);
        if (rows.length !== 1) return unavailable();
        return candidate(input.db, rows[0]);
      });
    },
    async verifyEvent(input) {
      if (input.siteId !== siteId) unavailable();
      canonicalBodyUuid(input.eventId, "guardian.external.eventId");
      const rows = await npReadAgentEventRowsV1(input.db, siteId, [input.eventId]);
      if (rows.length !== 1) unavailable();
      await verify(input.db, rows[0]);
      return npRequireAgentGuardianVerifiedEventV1({
        schemaVersion: "np.agent-guardian-verified-event.v1",
        eventId: rows[0].id,
        source: "sentry",
        observedAt: rows[0].occurredAt.toISOString(),
        sourceDigest: rows[0].eventHash,
        detectorId: NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1,
      });
    },
    async evidence(input) {
      if (input.siteId !== siteId || input.incident.siteId !== siteId) unavailable();
      const sources = await npReadAgentIncidentCanonicalSourcesV1(input);
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
      if (!signals.length || signals.length !== sources.signals.length) unavailable();
      const result: NpAgentGuardianExternalEvidenceV1[] = [];
      for (const signal of signals) {
        const ref = signal.evidence[0];
        if (signal.evidence.length !== 1 || ref?.kind !== "event") unavailable();
        const rows = await npReadAgentEventRowsV1(input.db, siteId, [ref.eventId]);
        if (rows.length !== 1) unavailable();
        const rebuilt = await candidate(input.db, rows[0]);
        if (
          signal.detectorId !== NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1 ||
          signal.detectorVersion !== 1 ||
          signal.evidenceDigest !== rebuilt.evidenceDigest ||
          signal.fingerprint !== rebuilt.fingerprint ||
          signal.severity !== "medium" ||
          signal.confidenceBasis !== "external" ||
          signal.scoreBasisPoints !== null ||
          input.incident.category !== "availability" ||
          input.incident.primarySubject !== null ||
          input.incident.fingerprint !== rebuilt.fingerprint
        )
          unavailable();
        result.push(
          npRequireAgentGuardianExternalEvidenceV1({
            schemaVersion: "np.agent-guardian-external-evidence.v1",
            signalId: signal.id,
            detectorId: NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1,
            detectorVersion: 1,
            adapter: identity,
            basis: "authenticated-external-fact",
            category: "availability",
            severity: "medium",
            confidenceBasis: "external",
            observedAt: rows[0].occurredAt.toISOString(),
            observedIssueCount: 1,
            sourceDigest: rows[0].eventHash,
          }),
        );
      }
      return result.sort((a, b) => a.signalId.localeCompare(b.signalId));
    },
  };
}
