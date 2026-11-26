import {
  npPrepareAgentRuntimeEventV1,
  npAssertPreparedAgentRuntimeEventRowV1,
  npRecordFreshConsumedAgentRuntimeEventWithControlContextV1,
} from "./runtime-event-service.js";
import {
  npVerifyGuardianSignalRuleV1,
  type NpGuardianSignalRuleVerificationV1,
} from "./guardian-signal-rule-verifier.js";
import { npReadAgentGuardianCaptureAdmissionFromRetainedRowV1 } from "./guardian-capture-admission.js";
import {
  npIsAgentGuardianSourceDeliveryClosedFromRetainedRowV1,
  npAgentGuardianSourceClosureKeyV1,
  npAssertAgentGuardianDeliveryKeyAvailableV1,
  npAgentGuardianDeliveryKeyLookupV1,
} from "./guardian-source-closure.js";
import {
  createAgentGuardianActorProjectionV1,
  NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1,
  npNormalizeAgentGuardianNetworkAddressV1,
} from "./guardian-actor-projection.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAgentEvents, npAgentSignals, npAgentSourceReleases } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  canonicalBodyEnum,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import {
  NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1,
  NP_AGENT_GUARDIAN_THRESHOLD_V1,
  NP_AGENT_GUARDIAN_WINDOW_MS_V1,
  npAgentGuardianRouteFamiliesV1,
  npRequireAgentGuardianEvidenceV1,
  type NpAgentGuardianEvidenceV1,
  type NpAgentGuardianRouteFamilyV1,
} from "../agent-contract/guardian-contract.js";
import type { NpAgentActorBucketRefV1, NpAgentEventCanonicalV1 } from "../agent-contract/types.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import { NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1 } from "../agent-contract/guardian-controls-contract.js";
import { npWithAgentRuntimeControlSettingsTransactionV1 } from "./runtime-controls.js";
import { npCreateAgentGuardianTransactionScopeV1 } from "./guardian-transaction-scope.js";
import {
  npObserveIncidentCandidate,
  type NpIncidentObservationCandidate,
} from "./incident-observation-service.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
import { npReadAgentIncidentCanonicalSourcesV1 } from "./incident-source-evidence.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import type { NpAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";

import {
  npRequireAgentGuardianVerifiedEventV1,
  type NpAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import { npAwaitAgentGuardianHostReadV1 } from "./guardian-host-read.js";
import {
  NP_GUARDIAN_REQUEST_SOURCE_ACTION_V1,
  NP_GUARDIAN_REQUEST_SOURCE_RECEIPT_SCHEMA_V1,
  npGuardianRequestSourceKeyBytesV1,
  npGuardianRequestSourceKeyIdV1,
  npGuardianRequestSourceMacV1,
  npGuardianRequestSourceUnavailableV1,
  npRequireGuardianRequestSourceReceiptV1,
  npVerifyGuardianRequestSourceMacV1,
  type NpGuardianRequestSourceReceiptBodyV1,
} from "./guardian-request-source-receipt.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;
type AuditRow = typeof npAuditEvents.$inferSelect;
const components = ["auth.guardian", "api.guardian"];
const hash = (value: unknown) =>
  createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url");
const projectionFingerprint = NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1;
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_OBSERVATION_UNAVAILABLE",
    503,
    "Security observation is unavailable.",
  );
}
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
function isPreviousSourceEvent(value: unknown): value is { id: string; eventHash: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === "eventHash,id" &&
    "id" in value &&
    typeof value.id === "string" &&
    "eventHash" in value &&
    typeof value.eventHash === "string"
  );
}

function network(value: unknown): string {
  try {
    return npNormalizeAgentGuardianNetworkAddressV1(value);
  } catch {
    return unavailable();
  }
}

/** Trusted source input only. Raw values live only until the HMAC projection;
 * observationId and occurredAt are source-owned and stable across retries. */
export type NpAgentGuardianObservationV1 = {
  siteId: string;
  observationId: string;
  occurredAt: string;
  networkAddress: string;
} & (
  | { kind: "login-failed"; audience: "staff" | "member"; loginIdentifier: string }
  | { kind: "rate-limited"; routeFamily: NpAgentGuardianRouteFamilyV1 }
);
export interface NpAgentGuardianObservationServiceV1 {
  observe(input: NpAgentGuardianObservationV1): Promise<{
    disposition: "recorded" | "replayed" | "capped" | "disabled" | "closed";
    eventId: string | null;
    incidentId: string | null;
  }>;
}

/** Authenticity only. Current viewer, response policy and admission remain
 * separate owners; a factory brand alone never establishes a detector fact. */
export interface NpAgentGuardianAuthenticatedRequestSourceV1 extends NpAgentGuardianObservationServiceV1 {
  verifyEvent(
    this: void,
    input: {
      db: Db;
      siteId: string;
      eventId: string;
    },
  ): Promise<NpAgentGuardianVerifiedEventV1>;
  verifySignal(this: void, input: NpGuardianSignalRuleVerificationV1): Promise<boolean>;
}
const authenticatedRequestSources = new WeakSet<object>();
export function npIsAgentGuardianAuthenticatedRequestSourceV1(
  value: unknown,
): value is NpAgentGuardianAuthenticatedRequestSourceV1 {
  return typeof value === "object" && value !== null && authenticatedRequestSources.has(value);
}

export interface NpAgentGuardianObservationOptionsV1 {
  /** Explicit host installation. A copied existing host secret may be derived for this purpose;
   * the factory neither loads nor creates credentials. Rotate id with the key. */
  actorKey: { id: string; bytes: Uint8Array };
  /** Explicit independent host integrity key. Absent keeps manual observation
   * behavior; unsigned historical facts never become authenticated by replay. */
  receiptKey?: { id: string; bytes: Uint8Array };
  resolveReceiptKey?(this: void, id: string): Uint8Array | null | Promise<Uint8Array | null>;
  isInstalledSite(siteId: string): Promise<boolean>;
  /** Current deployment/site source authority, never caller-provided HTTP authority. */
  authorize(input: { siteId: string; db: Db }): Promise<void>;
  events: Pick<NpAgentRuntimeEventServiceV1, "record">;
  notifications?: Pick<NpAgentIncidentNotificationsServiceV1, "record" | "recordFailure">;
  now?: () => Date;
}

function sourceDimension(event: NpAgentEventCanonicalV1): string {
  if (
    event.payload.kind === "auth.login.failed" &&
    event.source.component === "auth.guardian" &&
    event.source.kind === "auth"
  )
    return event.payload.audience;
  if (
    event.payload.kind === "api.rate-limited" &&
    event.source.component === "api.guardian" &&
    event.source.kind === "api"
  )
    return event.payload.routeFamily;
  return unavailable();
}
function actor(
  event: NpAgentEventCanonicalV1,
): NpAgentActorBucketRefV1 & { purpose: "network-address" } {
  const payload = event.payload;
  if (payload.kind !== "auth.login.failed" && payload.kind !== "api.rate-limited")
    return unavailable();
  const bucket = payload.ipBucket;
  if (
    bucket.projectionVersion !== 1 ||
    bucket.projectionFingerprint !== projectionFingerprint ||
    !same(event.actor, { kind: "anonymous", ...bucket }) ||
    event.causation !== null ||
    event.correlationId !== null ||
    event.privacy !== "sensitive" ||
    !event.deduplicationKey
  )
    return unavailable();
  if (payload.kind === "auth.login.failed") {
    if (
      payload.reasonCode !== "INVALID_CREDENTIALS" ||
      payload.sessionFamilyId !== null ||
      payload.userAgentFamily !== null ||
      event.subject?.kind !== "actor-bucket" ||
      event.subject.purpose !== "login-identifier" ||
      event.subject.projectionVersion !== bucket.projectionVersion ||
      event.subject.projectionFingerprint !== bucket.projectionFingerprint ||
      event.subject.keyId !== bucket.keyId
    )
      return unavailable();
  } else if (!same(event.subject, { kind: "actor-bucket", ...bucket })) return unavailable();
  sourceDimension(event);
  return bucket;
}

/** Rebuild one exact rule from five immutable, same-site source events. No prose is an input. */
async function candidate(rows: EventRow[]): Promise<NpIncidentObservationCandidate> {
  if (rows.length !== NP_AGENT_GUARDIAN_THRESHOLD_V1) return unavailable();
  const events = await Promise.all(rows.map(npReadAgentEventRowEvidenceV1));
  const first = events[0];
  const bucket = actor(first),
    dimension = sourceDimension(first);
  const start =
    Math.floor(Date.parse(first.occurredAt) / NP_AGENT_GUARDIAN_WINDOW_MS_V1) *
    NP_AGENT_GUARDIAN_WINDOW_MS_V1;
  if (
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    new Set(events.map((e) => e.deduplicationKey)).size !== rows.length ||
    events.some(
      (event) =>
        event.siteId !== first.siteId ||
        event.kind !== first.kind ||
        sourceDimension(event) !== dimension ||
        !same(actor(event), bucket) ||
        Date.parse(event.occurredAt) < start ||
        Date.parse(event.occurredAt) >= start + NP_AGENT_GUARDIAN_WINDOW_MS_V1,
    )
  )
    return unavailable();
  const login = first.kind === "auth.login.failed";
  const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId: first.siteId,
    detectorId: login ? "guardian.login-failures" : "guardian.rate-limits",
    detectorVersion: 1,
    category: login ? "authentication" : "traffic",
    subject: { kind: "actor-bucket", ...bucket },
    window: {
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(Math.max(...events.map((e) => Date.parse(e.occurredAt)))).toISOString(),
    },
    evidence: rows
      .map((row, i) => ({
        kind: "event",
        eventId: row.id,
        eventKind: events[i].kind,
        observedAt: events[i].occurredAt,
        digest: Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString("hex"),
        excerpt: null,
      }))
      .sort(
        (a, b) => a.observedAt.localeCompare(b.observedAt) || a.eventId.localeCompare(b.eventId),
      ),
  });
  return {
    canonicalEvidence,
    evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonicalEvidence),
    fingerprint: `cj1:sha256:${hash({ purpose: "np.agent-guardian-correlation.v1", siteId: first.siteId, detectorId: canonicalEvidence.detectorId, bucket, dimension })}`,
    severity: "medium",
    confidenceBasis: "exact-rule",
    scoreBasisPoints: null,
    title: login ? "Repeated login failures" : "Repeated request limits",
    summary: `At least 5 ${login ? `failed ${dimension} logins` : `request-limit decisions for ${dimension}`} observed in one ten-minute window. This rule does not establish malicious intent.`,
  };
}

/** Installs no worker, trigger, model, response capability or default site. Request hooks contain
 * failures; a 750 ms work deadline closes late callbacks and releases the owning
 * transaction after bounded SQL drain. Per-site/per-source caps bound stored work. */
export function createAgentGuardianObservationServiceV1(
  options: NpAgentGuardianObservationOptionsV1,
): NpAgentGuardianAuthenticatedRequestSourceV1 {
  if (
    !options.actorKey ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.actorKey.id) ||
    !(options.actorKey.bytes instanceof Uint8Array) ||
    options.actorKey.bytes.length < 32 ||
    options.actorKey.bytes.length > 64 ||
    typeof options.isInstalledSite !== "function" ||
    typeof options.authorize !== "function" ||
    typeof options.events?.record !== "function"
  )
    unavailable();
  const configuredReceiptKey = options.receiptKey;
  if (
    configuredReceiptKey !== undefined &&
    (!configuredReceiptKey ||
      !npGuardianRequestSourceKeyBytesV1(configuredReceiptKey.bytes) ||
      (configuredReceiptKey.bytes.length === options.actorKey.bytes.length &&
        timingSafeEqual(configuredReceiptKey.bytes, options.actorKey.bytes)))
  )
    npGuardianRequestSourceUnavailableV1();
  const receiptKey = configuredReceiptKey
    ? {
        id: npGuardianRequestSourceKeyIdV1(configuredReceiptKey.id),
        bytes: new Uint8Array(configuredReceiptKey.bytes),
      }
    : null;
  if (options.resolveReceiptKey !== undefined && typeof options.resolveReceiptKey !== "function")
    npGuardianRequestSourceUnavailableV1();
  const resolveReceiptKey = options.resolveReceiptKey;
  async function retainedKey(id: string): Promise<Uint8Array> {
    if (!receiptKey) return npGuardianRequestSourceUnavailableV1();
    if (id === receiptKey.id) return receiptKey.bytes;
    const bytes = await npAwaitAgentGuardianHostReadV1(() => resolveReceiptKey?.(id));
    if (!npGuardianRequestSourceKeyBytesV1(bytes)) return npGuardianRequestSourceUnavailableV1();
    return new Uint8Array(bytes);
  }
  async function verifyRow(db: Db, row: EventRow): Promise<void> {
    if (!receiptKey) return npGuardianRequestSourceUnavailableV1();
    const event = await npReadAgentEventRowEvidenceV1(row);
    actor(event);
    canonicalBodyUuid(event.deduplicationKey, "guardian.request.source.observationId");
    if (event.kind !== event.payload.kind || !components.includes(event.source.component))
      npGuardianRequestSourceUnavailableV1();
    const receipts = await db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.siteId, row.siteId),
          eq(npAuditEvents.action, NP_GUARDIAN_REQUEST_SOURCE_ACTION_V1),
          eq(npAuditEvents.targetType, "agent-event"),
          eq(npAuditEvents.targetId, row.id),
        ),
      )
      .limit(2);
    if (receipts.length !== 1) return npGuardianRequestSourceUnavailableV1();
    await verifyAudit(row, receipts[0]);
  }
  async function verifyAudit(row: EventRow, audit: AuditRow): Promise<void> {
    const receipt = npRequireGuardianRequestSourceReceiptV1(audit.payload);
    if (
      audit.siteId !== row.siteId ||
      audit.action !== NP_GUARDIAN_REQUEST_SOURCE_ACTION_V1 ||
      audit.targetType !== "agent-event" ||
      audit.targetId !== row.id ||
      receipt.receiptId !== audit.id ||
      receipt.siteId !== row.siteId ||
      receipt.eventId !== row.id ||
      receipt.eventHash !== row.eventHash ||
      receipt.recordedAt !== row.recordedAt.toISOString() ||
      audit.createdAt.toISOString() !== receipt.recordedAt ||
      audit.actorKind !== "system" ||
      audit.actorUserId !== null ||
      audit.actorMemberId !== null ||
      !npVerifyGuardianRequestSourceMacV1(receipt, await retainedKey(receipt.keyId))
    )
      npGuardianRequestSourceUnavailableV1();
  }
  const projection = createAgentGuardianActorProjectionV1(options.actorKey);
  const now = options.now ?? (() => new Date());
  const bucket = (siteId: string, purpose: NpAgentActorBucketRefV1["purpose"], value: string) =>
    projection.project({ siteId, purpose, value });
  let inFlight = 0;
  const service: NpAgentGuardianAuthenticatedRequestSourceV1 = {
    async verifyEvent(input) {
      if (!receiptKey) return npGuardianRequestSourceUnavailableV1();
      canonicalBodySiteId(input.siteId, "guardian.request.source.siteId");
      canonicalBodyUuid(input.eventId, "guardian.request.source.eventId");
      const rows = await npReadAgentEventRowsV1(input.db, input.siteId, [input.eventId]);
      if (rows.length !== 1) return npGuardianRequestSourceUnavailableV1();
      await verifyRow(input.db, rows[0]);
      return npRequireAgentGuardianVerifiedEventV1({
        schemaVersion: "np.agent-guardian-verified-event.v1",
        eventId: rows[0].id,
        source: "requests",
        observedAt: rows[0].occurredAt.toISOString(),
        sourceDigest: rows[0].eventHash,
        detectorId: null,
      });
    },
    async verifySignal(input) {
      if (!receiptKey) return false;
      return npVerifyGuardianSignalRuleV1(input, async (_row, ids) => {
        if (ids.length !== NP_AGENT_GUARDIAN_THRESHOLD_V1)
          return npGuardianRequestSourceUnavailableV1();
        const rows = await npReadAgentEventRowsV1(input.db, input.siteId, ids);
        if (rows.length !== ids.length) return npGuardianRequestSourceUnavailableV1();
        for (const row of rows) await verifyRow(input.db, row);
        return candidate(rows);
      });
    },
    async observe(input) {
      // An HTTP flood cannot queue an unbounded number of observations in the DB pool.
      // This is an observation budget only; request admission remains with auth/proxy.
      if (inFlight >= 4) unavailable();
      inFlight++;
      try {
        npAssertAgentPreviewEffectsAllowed();
        const path = "guardian.observation";
        const raw = cloneCanonicalRuntimeInput(input, path, 8192);
        const login =
          typeof raw === "object" && raw !== null && "kind" in raw && raw.kind === "login-failed";
        const keys = [
          "siteId",
          "observationId",
          "occurredAt",
          "networkAddress",
          "kind",
          ...(login ? ["audience", "loginIdentifier"] : ["routeFamily"]),
        ];
        const row = canonicalBodyRecord(raw, path, keys, keys, { seen: new WeakSet() });
        const siteId = canonicalBodySiteId(row.siteId, path);
        const id = canonicalBodyUuid(row.observationId, path),
          occurredAt = canonicalBodyUtc(row.occurredAt, path);
        canonicalBodyEnum(row.kind, path, new Set(["login-failed", "rate-limited"]));
        const ipBucket = {
          ...bucket(siteId, "network-address", network(row.networkAddress)),
          purpose: "network-address" as const,
        };
        let subject: NpAgentEventCanonicalV1["subject"];
        let payload: NpAgentEventCanonicalV1["payload"];
        if (login) {
          if (
            typeof row.loginIdentifier !== "string" ||
            !row.loginIdentifier.trim() ||
            row.loginIdentifier.length > 320 ||
            /[\p{Cc}\p{Cs}]/u.test(row.loginIdentifier)
          )
            unavailable();
          subject = {
            kind: "actor-bucket",
            ...bucket(siteId, "login-identifier", row.loginIdentifier.trim().toLowerCase()),
          };
          payload = {
            kind: "auth.login.failed",
            audience: canonicalBodyEnum(row.audience, path, new Set(["staff", "member"] as const)),
            outcome: "failed",
            reasonCode: "INVALID_CREDENTIALS",
            sessionFamilyId: null,
            ipBucket,
            userAgentFamily: null,
          };
        } else {
          subject = { kind: "actor-bucket", ...ipBucket };
          payload = {
            kind: "api.rate-limited",
            routeFamily: canonicalBodyEnum(
              row.routeFamily,
              path,
              new Set(npAgentGuardianRouteFamiliesV1),
            ),
            ipBucket,
          };
        }
        const { event, eventHash } = await npPrepareAgentRuntimeEventV1({
          version: "np.agent-event.v1",
          siteId,
          kind: payload.kind,
          occurredAt,
          source: {
            kind: login ? "auth" : "api",
            component: login ? components[0] : components[1],
          },
          subject,
          actor: { kind: "anonymous", ...ipBucket },
          causation: null,
          correlationId: null,
          deduplicationKey: id,
          privacy: "sensitive",
          payload,
        });
        const deadline = performance.now() + 750;
        let live = true;
        let closeScope: (() => void) | undefined;
        const checkpoint = () => {
          if (!live || performance.now() >= deadline) {
            live = false;
            closeScope?.();
            unavailable();
          }
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            live = false;
            closeScope?.();
            reject(
              new NpAgentGatewayError(
                "GUARDIAN_OBSERVATION_UNAVAILABLE",
                503,
                "Security observation is unavailable.",
              ),
            );
          }, 750);
        });
        const wait = <T>(work: () => Promise<T>): Promise<T> => {
          checkpoint();
          return Promise.race([work(), timeout]);
        };
        try {
          if ((await wait(() => options.isInstalledSite(siteId))) !== true) return unavailable();
          checkpoint();
          return await wait(() =>
            getDb().transaction(async (rawTx) => {
              checkpoint();
              const scope = npCreateAgentGuardianTransactionScopeV1(rawTx, {
                checkpoint,
                unavailable,
                closed: unavailable,
              });
              closeScope = () => scope.close();
              try {
                return await wait(async () => {
                  const tx = scope.db;
                  return npWithAgentRuntimeControlSettingsTransactionV1(
                    siteId,
                    [
                      NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1,
                      npAgentGuardianSourceClosureKeyV1("requests"),
                    ],
                    async (controlContext, settingRows) => {
                      const { db } = controlContext;
                      // Fresh rows from the held admission lock are parsed by their own
                      // owners before any host callback/write. They are never cached.
                      if (
                        npReadAgentGuardianCaptureAdmissionFromRetainedRowV1(
                          siteId,
                          settingRows.find(
                            (row) => row.key === NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1,
                          ),
                        ).state === "disabled"
                      )
                        return {
                          disposition: "disabled" as const,
                          eventId: null,
                          incidentId: null,
                        };
                      if (
                        await npIsAgentGuardianSourceDeliveryClosedFromRetainedRowV1(
                          siteId,
                          "requests",
                          occurredAt,
                          settingRows.find(
                            (row) => row.key === npAgentGuardianSourceClosureKeyV1("requests"),
                          ),
                        )
                      )
                        return { disposition: "closed" as const, eventId: null, incidentId: null };
                      // The site control lock serializes capture and maintenance. New source rows
                      // are unexpired; creating same-site references needs no global deletion fence.
                      await options.authorize({ db, siteId });
                      checkpoint();
                      const start =
                        Math.floor(Date.parse(occurredAt) / NP_AGENT_GUARDIAN_WINDOW_MS_V1) *
                        NP_AGENT_GUARDIAN_WINDOW_MS_V1;
                      const dimension = sourceDimension(event);
                      // Both bounded source reads share the held site lock and have no
                      // intervening callback or write. Return thin rows in one snapshot.
                      const releaseLookup = await npAgentGuardianDeliveryKeyLookupV1(event);
                      const snapshotResult = await db.execute(sql`
                select
                  exists(select 1 from ${npAgentSourceReleases}
                    where ${releaseLookup.predicate}) as "released",
                  (select jsonb_build_object('id', ${npAgentEvents.id}, 'eventHash', ${npAgentEvents.eventHash})
                    from ${npAgentEvents}
                    where ${npAgentEvents.siteId}=${siteId}
                      and ${npAgentEvents.sourceComponent}=${event.source.component}
                      and ${npAgentEvents.kind}=${event.kind}
                      and ${npAgentEvents.deduplicationKey}=${id}
                    limit 1) as "previous",
                  coalesce((select jsonb_agg(
                    jsonb_build_object('id', bounded_window.id, 'matches', bounded_window.matches)
                    order by bounded_window.occurred_at, bounded_window.id)
                    from (select ${npAgentEvents.id} as id, ${npAgentEvents.occurredAt} as occurred_at,
                      coalesce((${npAgentEvents.kind}=${event.kind}
                        and ${npAgentEvents.actor}=${serializeAgentCanonicalJson(event.actor)}::jsonb
                        and case when ${npAgentEvents.payload}->>'kind'='auth.login.failed'
                          then ${npAgentEvents.payload}->>'audience'
                          when ${npAgentEvents.payload}->>'kind'='api.rate-limited'
                          then ${npAgentEvents.payload}->>'routeFamily' else null end=${dimension}),false) as matches
                      from ${npAgentEvents}
                      where ${npAgentEvents.siteId}=${siteId}
                        and ${npAgentEvents.sourceComponent} in (${components[0]},${components[1]})
                        and ${npAgentEvents.recordedAt}>=${new Date(start).toISOString()}::timestamptz
                        and ${npAgentEvents.recordedAt}<${new Date(start + NP_AGENT_GUARDIAN_WINDOW_MS_V1 + 60_000).toISOString()}::timestamptz
                        and ${npAgentEvents.occurredAt}>=${new Date(start).toISOString()}::timestamptz
                        and ${npAgentEvents.occurredAt}<${new Date(start + NP_AGENT_GUARDIAN_WINDOW_MS_V1).toISOString()}::timestamptz
                      order by ${npAgentEvents.occurredAt},${npAgentEvents.id}
                      limit ${NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1 + 1}) as bounded_window),'[]'::jsonb) as "rows"
              `);
                      const snapshot = snapshotResult.rows[0];
                      if (
                        snapshotResult.rows.length !== 1 ||
                        !snapshot ||
                        Object.keys(snapshot).sort().join(",") !== "previous,released,rows" ||
                        typeof snapshot.released !== "boolean"
                      )
                        unavailable();
                      const previous = snapshot.previous;
                      if (previous !== null && !isPreviousSourceEvent(previous)) unavailable();
                      const rows = snapshot.rows;
                      if (
                        !Array.isArray(rows) ||
                        rows.length > NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1 + 1 ||
                        !rows.every(
                          (value: unknown): value is { id: string; matches: boolean } =>
                            typeof value === "object" &&
                            value !== null &&
                            !Array.isArray(value) &&
                            Object.keys(value).sort().join(",") === "id,matches" &&
                            "id" in value &&
                            typeof value.id === "string" &&
                            "matches" in value &&
                            typeof value.matches === "boolean",
                        )
                      )
                        unavailable();
                      if (previous && previous.eventHash !== eventHash)
                        throw new NpAgentGatewayError(
                          "IDEMPOTENCY_KEY_REUSED",
                          409,
                          "Security observation conflicts with retained evidence.",
                        );
                      if (previous) {
                        const [retained] = await npReadAgentEventRowsV1(db, siteId, [previous.id]);
                        if (!retained || retained.eventHash !== eventHash) unavailable();
                        await npReadAgentEventRowEvidenceV1(retained);
                        // A configured authenticated source cannot distinguish a deleted
                        // receipt from unsigned legacy history. Both fail closed here;
                        // the observe-only no-key service retains legacy replay behavior.
                        if (receiptKey) await verifyRow(db, retained);
                      }
                      const time = now();
                      if (
                        !Number.isFinite(time.getTime()) ||
                        (!previous &&
                          (Date.parse(occurredAt) > time.getTime() ||
                            time.getTime() - Date.parse(occurredAt) > 60_000))
                      )
                        unavailable();
                      if (rows.length > NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1) unavailable();
                      const matchingIds = rows.filter((r) => r.matches).map((r) => r.id);
                      if (matchingIds.length > NP_AGENT_GUARDIAN_THRESHOLD_V1) unavailable();
                      const matches = matchingIds.length
                        ? await npReadAgentEventRowsV1(db, siteId, matchingIds)
                        : [];
                      if (matches.length !== matchingIds.length) unavailable();
                      let eventId = previous?.id ?? null;
                      const capped =
                        !previous &&
                        (rows.length >= NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1 ||
                          matches.length >= NP_AGENT_GUARDIAN_THRESHOLD_V1);
                      if (!previous && !capped) {
                        // Retention shares the held quota lock, so a negative
                        // lookup remains current until insertion. A matching row
                        // still goes through its owner's complete proof validator.
                        if (snapshot.released)
                          await npAssertAgentGuardianDeliveryKeyAvailableV1(db, event, "requests");
                        const recorded =
                          await npRecordFreshConsumedAgentRuntimeEventWithControlContextV1(
                            options.events,
                            controlContext,
                            {
                              siteId,
                              event,
                              expiresAt: new Date(time.getTime() + 86400000),
                              db,
                            },
                          );
                        eventId = recorded.eventId;
                        // The actual owner can consume a new insertion atomically. Custom
                        // recorders must instead read/consume their real stored row here.
                        // Row proof and mandatory Audit still share the awaited transaction.
                        const stored =
                          recorded.consumedRow ??
                          (
                            await db
                              .update(npAgentEvents)
                              .set({ dispatchedAt: npAgentEvents.recordedAt })
                              .where(
                                and(
                                  eq(npAgentEvents.siteId, siteId),
                                  eq(npAgentEvents.id, eventId),
                                ),
                              )
                              .returning()
                          )[0];
                        if (
                          !stored ||
                          stored.id !== eventId ||
                          stored.siteId !== siteId ||
                          stored.recordedAt.getTime() < start ||
                          stored.recordedAt.getTime() >=
                            start + NP_AGENT_GUARDIAN_WINDOW_MS_V1 + 60_000 ||
                          stored.expiresAt.getTime() !== time.getTime() + 86400000 ||
                          stored.eventHash !== eventHash ||
                          stored.dispatchedAt?.getTime() !== stored.recordedAt.getTime()
                        )
                          unavailable();
                        await npAssertPreparedAgentRuntimeEventRowV1(event, stored);
                        if (receiptKey) {
                          if (recorded.replayed) npGuardianRequestSourceUnavailableV1();
                          const receiptId = randomUUID();
                          const body: NpGuardianRequestSourceReceiptBodyV1 = {
                            schemaVersion: NP_GUARDIAN_REQUEST_SOURCE_RECEIPT_SCHEMA_V1,
                            receiptId,
                            keyId: receiptKey.id,
                            siteId,
                            eventId: stored.id,
                            eventHash: stored.eventHash,
                            recordedAt: stored.recordedAt.toISOString(),
                          };
                          const receipt = {
                            ...body,
                            sourceMac: npGuardianRequestSourceMacV1(body, receiptKey.bytes),
                          };
                          const audits = await db
                            .insert(npAuditEvents)
                            .values({
                              id: receiptId,
                              siteId,
                              actorKind: "system",
                              actorUserId: null,
                              actorMemberId: null,
                              action: NP_GUARDIAN_REQUEST_SOURCE_ACTION_V1,
                              targetType: "agent-event",
                              targetId: stored.id,
                              payload: receipt,
                              createdAt: stored.recordedAt,
                            })
                            .returning();
                          if (audits.length !== 1) npGuardianRequestSourceUnavailableV1();
                          await verifyAudit(stored, audits[0]);
                        }
                        matches.push(stored);
                      }
                      let incidentId: string | null = null;
                      if (matches.length === NP_AGENT_GUARDIAN_THRESHOLD_V1) {
                        const detected = await candidate(matches);
                        const result = await npObserveIncidentCandidate({
                          candidate: detected,
                          now,
                          notifications: options.notifications,
                          transaction: db,
                          resolveEvidence: async (readDb) => {
                            const retained = await npReadAgentEventRowsV1(
                              readDb,
                              siteId,
                              matches.map((r) => r.id),
                            );
                            return same(
                              (await candidate(retained)).canonicalEvidence,
                              detected.canonicalEvidence,
                            );
                          },
                        });
                        incidentId = result.incidentId;
                      }
                      return {
                        disposition: previous ? "replayed" : capped ? "capped" : "recorded",
                        eventId,
                        incidentId,
                      };
                    },
                    tx,
                  );
                });
              } finally {
                scope.close();
              }
            }),
          );
        } finally {
          live = false;
          closeScope?.();
          if (timer !== undefined) clearTimeout(timer);
        }
      } finally {
        inFlight--;
      }
    },
  };
  Object.freeze(service);
  if (receiptKey) authenticatedRequestSources.add(service);
  return service;
}

/** Same source owner for current staff visibility and the read-only Studio projection.
 * Throws on an unknown detector, altered digest, source mismatch or incomplete source set. */
export async function npReadAgentGuardianIncidentEvidenceV1(input: {
  db: Db;
  siteId: string;
  incident: NpAgentIncidentV1;
}): Promise<NpAgentGuardianEvidenceV1[]> {
  const sources = await npReadAgentIncidentCanonicalSourcesV1(input);
  const allIds = sources.signals.flatMap((signal) =>
    signal.evidence.flatMap((ref) => (ref.kind === "event" ? [ref.eventId] : [])),
  );
  const allRows = await npReadAgentEventRowsV1(input.db, input.siteId, [...new Set(allIds)]);
  const storedSignals = await input.db
    .select({ id: npAgentSignals.id, digest: npAgentSignals.evidenceDigest })
    .from(npAgentSignals)
    .where(
      and(
        eq(npAgentSignals.siteId, input.siteId),
        eq(npAgentSignals.incidentId, input.incident.id),
        inArray(npAgentSignals.id, input.incident.signalIds),
      ),
    )
    .limit(101);
  if (storedSignals.length !== sources.signals.length) unavailable();
  const output: NpAgentGuardianEvidenceV1[] = [];
  for (const signal of sources.signals) {
    const refs = signal.evidence.filter((ref) => ref.kind === "event");
    if (refs.length !== signal.evidence.length) unavailable();
    const ids = new Set(refs.map((ref) => ref.eventId));
    const rows = allRows.filter((row) => ids.has(row.id));
    const rebuilt = await candidate(rows);
    if (
      !same(rebuilt.canonicalEvidence, signal) ||
      rebuilt.fingerprint !== input.incident.fingerprint ||
      !same(input.incident.primarySubject, signal.subject) ||
      input.incident.category !== signal.category
    )
      unavailable();
    const storedSignal = storedSignals.filter((signal) => signal.digest === rebuilt.evidenceDigest);
    if (storedSignal.length !== 1) unavailable();
    const first = sources.events.find(
      (event) => event.deduplicationKey === rows[0].deduplicationKey,
    );
    if (!first) unavailable();
    output.push(
      npRequireAgentGuardianEvidenceV1({
        schemaVersion: "np.agent-guardian-evidence.v1",
        signalId: storedSignal[0].id,
        detectorId: signal.detectorId,
        audience: first.payload.kind === "auth.login.failed" ? first.payload.audience : null,
        routeFamily: first.payload.kind === "api.rate-limited" ? first.payload.routeFamily : null,
        window: signal.window,
        observedCount: rows.length,
        threshold: NP_AGENT_GUARDIAN_THRESHOLD_V1,
        countBasis: "at-least",
      }),
    );
  }
  return output;
}

/** Rebuilds the original deterministic rule; it does not establish source MAC authenticity. */
export async function npVerifyAgentGuardianRequestSignalV1(
  input: NpGuardianSignalRuleVerificationV1,
): Promise<boolean> {
  return npVerifyGuardianSignalRuleV1(input, async (_row, ids) =>
    candidate(await npReadAgentEventRowsV1(input.db, input.siteId, ids)),
  );
}
