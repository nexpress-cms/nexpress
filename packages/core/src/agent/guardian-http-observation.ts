import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAgentEvents, npAgentSignals } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentEventCanonical,
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentEventCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import {
  NP_AGENT_GUARDIAN_HTTP_ACTIVITY_HASH_DOMAIN_V1,
  NP_AGENT_GUARDIAN_HTTP_SOURCE_COMPONENT_V1,
  NP_AGENT_GUARDIAN_HTTP_SOURCE_MAC_DOMAIN_V1,
  npAgentGuardianHttpRuleBoundsV1,
  npEvaluateAgentGuardianHttpRulesV1,
  npRequireAgentGuardianHttpActivityV1,
  npRequireAgentGuardianHttpEvidenceV1,
  npRequireAgentGuardianHttpSourceReceiptV1,
  type NpAgentGuardianHttpActivityV1,
  type NpAgentGuardianHttpEvidenceV1,
  type NpAgentGuardianHttpSourceReceiptV1,
  type NpAgentGuardianHttpStatusV1,
} from "../agent-contract/guardian-http-contract.js";
import type { NpAgentGuardianRouteFamilyV1 } from "../agent-contract/guardian-contract.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import {
  npRequireAgentGuardianVerifiedEventV1,
  type NpAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { createAgentGuardianActorProjectionV1 } from "./guardian-actor-projection.js";
import { npReadAgentGuardianCaptureAdmissionV1 } from "./guardian-capture-admission.js";
import { npAwaitAgentGuardianHostReadV1 } from "./guardian-host-read.js";
import { npCreateAgentGuardianTransactionScopeV1 } from "./guardian-transaction-scope.js";
import {
  npAssertAgentGuardianDeliveryKeyAvailableV1,
  npIsAgentGuardianSourceDeliveryClosedV1,
} from "./guardian-source-closure.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
import { npReadAgentIncidentCanonicalSourcesV1 } from "./incident-source-evidence.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "./incident-service.js";
import {
  npObserveIncidentCandidate,
  type NpIncidentObservationCandidate,
} from "./incident-observation-service.js";
import {
  npVerifyGuardianSignalRuleV1,
  type NpGuardianSignalRuleVerificationV1,
} from "./guardian-signal-rule-verifier.js";
import type { NpAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;
type Waiter = <T>(work: Promise<T>) => Promise<T>;
const hostReadWait: Waiter = (work) => npAwaitAgentGuardianHostReadV1(() => work);
const SOURCE_ACTION = "agent.guardian_http.source";
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const digest = (domain: string, body: unknown) =>
  `cj1:sha256:${createHash("sha256").update(domain).update("\0").update(serializeAgentCanonicalJson(body)).digest("base64url")}`;
function unavailable(code = "GUARDIAN_HTTP_EVIDENCE_UNAVAILABLE", status = 409): never {
  throw new NpAgentGatewayError(code, status, "HTTP response observation is unavailable.");
}
function validKey(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length >= 32 && value.length <= 64;
}
function keyId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    unavailable("GUARDIAN_HTTP_INSTALLATION_INVALID", 503);
  return value;
}
function deadlineTransaction(db: Db, checkpoint: () => void): { db: Db; close(): void } {
  return npCreateAgentGuardianTransactionScopeV1(db, {
    checkpoint,
    unavailable: () => unavailable(),
    closed: () => unavailable("GUARDIAN_HTTP_SOURCE_TIMEOUT", 503),
  });
}
export interface NpAgentGuardianHttpObservationInputV1 {
  siteId: string;
  observationId: string;
  occurredAt: string;
  status: NpAgentGuardianHttpStatusV1;
  routeFamily: NpAgentGuardianRouteFamilyV1;
  /** Trusted host network metadata, discarded immediately after its projection. */
  networkAddress: string;
}
export interface NpAgentGuardianHttpObservationOptionsV1 {
  actorKey: { id: string; bytes: Uint8Array };
  resolveActorKey?(id: string): Uint8Array | null | Promise<Uint8Array | null>;
  receiptKey: { id: string; bytes: Uint8Array };
  resolveReceiptKey?(id: string): Uint8Array | null | Promise<Uint8Array | null>;
  isInstalledSite(siteId: string): Promise<boolean>;
  authorize(input: { db: Db; siteId: string }): Promise<void>;
  events: Pick<NpAgentRuntimeEventServiceV1, "record">;
  notifications?: Pick<NpAgentIncidentNotificationsServiceV1, "record" | "recordFailure">;
  now?: () => Date;
}
export interface NpAgentGuardianHttpObservationResultV1 {
  disposition: "recorded" | "replayed" | "capped" | "disabled" | "closed";
  eventId: string | null;
  incidentId: string | null;
}
export interface NpAgentGuardianHttpObservationServiceV1 {
  observe(
    input: NpAgentGuardianHttpObservationInputV1,
  ): Promise<NpAgentGuardianHttpObservationResultV1>;
  /** Diagnostic facets establish retained source proof, never viewer or effect authority. */
  verifyEvent(input: {
    db: Db;
    siteId: string;
    eventId: string;
  }): Promise<NpAgentGuardianVerifiedEventV1>;
  verifySignal(input: NpGuardianSignalRuleVerificationV1): Promise<boolean>;
  evidence(input: {
    db: Db;
    siteId: string;
    incident: NpAgentIncidentV1;
  }): Promise<NpAgentGuardianHttpEvidenceV1[]>;
}
/** Explicit final-response source only. Constructs no DB, route, provider, worker or credentials. */
export function createAgentGuardianHttpObservationServiceV1(
  options: NpAgentGuardianHttpObservationOptionsV1,
): NpAgentGuardianHttpObservationServiceV1 {
  const actorKeyId = keyId(options.actorKey?.id),
    receiptKeyId = keyId(options.receiptKey?.id);
  if (
    !validKey(options.actorKey?.bytes) ||
    !validKey(options.receiptKey?.bytes) ||
    typeof options.isInstalledSite !== "function" ||
    typeof options.authorize !== "function" ||
    typeof options.events?.record !== "function" ||
    (options.resolveActorKey !== undefined && typeof options.resolveActorKey !== "function") ||
    (options.resolveReceiptKey !== undefined && typeof options.resolveReceiptKey !== "function") ||
    (options.now !== undefined && typeof options.now !== "function")
  )
    unavailable("GUARDIAN_HTTP_INSTALLATION_INVALID", 503);
  const actorKey = new Uint8Array(options.actorKey.bytes),
    receiptKey = new Uint8Array(options.receiptKey.bytes);
  const projection = createAgentGuardianActorProjectionV1({ id: actorKeyId, bytes: actorKey });
  const now = options.now ?? (() => new Date());
  const bodyHash = (activity: NpAgentGuardianHttpActivityV1) =>
    digest(NP_AGENT_GUARDIAN_HTTP_ACTIVITY_HASH_DOMAIN_V1, activity);
  const mac = (key: Uint8Array, body: Omit<NpAgentGuardianHttpSourceReceiptV1, "sourceMac">) =>
    `hmac-sha256:${createHmac("sha256", key).update(NP_AGENT_GUARDIAN_HTTP_SOURCE_MAC_DOMAIN_V1).update("\0").update(serializeAgentCanonicalJson(body)).digest("base64url")}`;
  async function retainedKey(id: string, kind: "actor" | "receipt", wait: Waiter = hostReadWait) {
    const current = kind === "actor" ? actorKeyId : receiptKeyId;
    if (id === current) return kind === "actor" ? actorKey : receiptKey;
    const value = await wait(
      Promise.resolve(
        kind === "actor" ? options.resolveActorKey?.(id) : options.resolveReceiptKey?.(id),
      ),
    );
    if (!validKey(value)) unavailable("GUARDIAN_HTTP_SOURCE_KEY_UNAVAILABLE");
    return new Uint8Array(value);
  }
  async function verify(
    db: Db,
    row: EventRow,
    wait: Waiter = hostReadWait,
  ): Promise<NpAgentGuardianHttpActivityV1> {
    const event = await npReadAgentEventRowEvidenceV1(row);
    if (
      event.kind !== "http.response.observed" ||
      event.payload.kind !== "http.response.observed" ||
      !same(event.source, { kind: "api", component: NP_AGENT_GUARDIAN_HTTP_SOURCE_COMPONENT_V1 }) ||
      event.causation !== null ||
      event.correlationId !== null ||
      event.privacy !== "sensitive"
    )
      unavailable();
    const activity = npRequireAgentGuardianHttpActivityV1(event.payload.activity);
    if (
      event.siteId !== activity.siteId ||
      event.occurredAt !== activity.occurredAt ||
      event.payload.receiptId !== activity.observationId ||
      event.deduplicationKey !== `guardian-http:${activity.observationId}` ||
      !same(event.actor, { kind: "anonymous", ...activity.networkBucket }) ||
      !same(event.subject, { kind: "actor-bucket", ...activity.networkBucket }) ||
      row.dispatchedAt?.getTime() !== row.recordedAt.getTime() ||
      row.recordedAt < row.occurredAt ||
      row.recordedAt.getTime() - row.occurredAt.getTime() > 60_000
    )
      unavailable();
    const [audit] = await db
      .select({
        id: npAuditEvents.id,
        siteId: npAuditEvents.siteId,
        action: npAuditEvents.action,
        actorKind: npAuditEvents.actorKind,
        actorUserId: npAuditEvents.actorUserId,
        actorMemberId: npAuditEvents.actorMemberId,
        targetType: npAuditEvents.targetType,
        targetId: npAuditEvents.targetId,
        createdAt: npAuditEvents.createdAt,
        payload: sql<unknown>`case when octet_length(${npAuditEvents.payload}::text)<=8192 then ${npAuditEvents.payload} else null end`,
      })
      .from(npAuditEvents)
      .where(
        and(eq(npAuditEvents.siteId, row.siteId), eq(npAuditEvents.id, activity.observationId)),
      )
      .limit(1);
    if (!audit) unavailable();
    const receipt = npRequireAgentGuardianHttpSourceReceiptV1(audit.payload),
      { sourceMac, ...base } = receipt;
    if (
      receipt.siteId !== row.siteId ||
      receipt.receiptId !== audit.id ||
      receipt.eventId !== row.id ||
      receipt.eventHash !== row.eventHash ||
      receipt.bodyHash !== bodyHash(activity) ||
      receipt.recordedAt !== row.recordedAt.toISOString() ||
      audit.action !== SOURCE_ACTION ||
      audit.actorKind !== "system" ||
      audit.actorUserId !== null ||
      audit.actorMemberId !== null ||
      audit.targetType !== "agent-event" ||
      audit.targetId !== row.id ||
      audit.createdAt.getTime() !== row.recordedAt.getTime() ||
      !timingSafeEqual(
        Buffer.from(sourceMac),
        Buffer.from(mac(await retainedKey(receipt.keyId, "receipt", wait), base)),
      )
    )
      unavailable();
    return activity;
  }
  async function candidate(
    db: Db,
    rows: EventRow[],
    wait: Waiter = hostReadWait,
  ): Promise<NpIncidentObservationCandidate> {
    if (rows.length !== 5) unavailable();
    const activities = await Promise.all(rows.map((row) => verify(db, row, wait)));
    const startedAt = new Date(
      Math.floor(Date.parse(activities[0].occurredAt) / 600_000) * 600_000,
    ).toISOString();
    const matches = npEvaluateAgentGuardianHttpRulesV1({
      siteId: rows[0].siteId,
      windowStartedAt: startedAt,
      activities,
    });
    if (matches.length !== 1 || matches[0].observationIds.length !== rows.length) unavailable();
    const match = matches[0],
      byObservation = new Map(
        activities.map((activity, index) => [activity.observationId, rows[index]]),
      );
    const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId: rows[0].siteId,
      detectorId: match.detectorId,
      detectorVersion: 1,
      category: "traffic",
      subject: { kind: "actor-bucket", ...match.networkBucket },
      window: match.window,
      evidence: match.observationIds
        .map((id) => {
          const row = byObservation.get(id);
          if (!row) return unavailable();
          return {
            kind: "event",
            eventId: row.id,
            eventKind: row.kind,
            observedAt: row.occurredAt.toISOString(),
            digest: Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString(
              "hex",
            ),
            excerpt: null,
          };
        })
        .sort(
          (a, b) => a.observedAt.localeCompare(b.observedAt) || a.eventId.localeCompare(b.eventId),
        ),
    });
    return {
      canonicalEvidence,
      evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonicalEvidence),
      fingerprint: digest("np.guardian-http-correlation.v1", {
        siteId: rows[0].siteId,
        detectorId: match.detectorId,
        detectorVersion: 1,
        status: match.status,
        routeFamily: match.routeFamily,
        networkBucket: match.networkBucket,
      }),
      severity: "low",
      confidenceBasis: "exact-rule",
      scoreBasisPoints: null,
      title: "Repeated HTTP responses for review",
      summary: `At least five HTTP ${match.status} responses in the ${match.routeFamily} route family were observed for one network bucket in ten minutes. This observation does not establish an authorization failure or attack.`,
    };
  }
  let inFlight = 0;
  return {
    async observe(input) {
      npAssertAgentPreviewEffectsAllowed();
      if (inFlight >= 4) unavailable("GUARDIAN_HTTP_SOURCE_BUSY", 503);
      inFlight++;
      const deadline = performance.now() + 750;
      const checkpoint = () => {
        if (performance.now() >= deadline) unavailable("GUARDIAN_HTTP_SOURCE_TIMEOUT", 503);
      };
      async function bounded<T>(work: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            work,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new NpAgentGatewayError(
                      "GUARDIAN_HTTP_SOURCE_TIMEOUT",
                      503,
                      "HTTP response observation is unavailable.",
                    ),
                  ),
                Math.max(1, deadline - performance.now()),
              );
            }),
          ]);
          checkpoint();
          return result;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      try {
        const path = "guardian.http.input",
          keys = [
            "siteId",
            "observationId",
            "occurredAt",
            "status",
            "routeFamily",
            "networkAddress",
          ];
        const raw = canonicalBodyRecord(
          cloneCanonicalRuntimeInput(input, path, 8192),
          path,
          keys,
          keys,
          { seen: new WeakSet() },
        );
        const siteId = canonicalBodySiteId(raw.siteId, path),
          observationId = canonicalBodyUuid(raw.observationId, path),
          occurredAt = canonicalBodyUtc(raw.occurredAt, path);
        if (typeof raw.networkAddress !== "string") unavailable();
        const address = raw.networkAddress;
        const activity = npRequireAgentGuardianHttpActivityV1({
          schemaVersion: "np.agent-guardian-http-activity.v1",
          siteId,
          observationId,
          occurredAt,
          status: raw.status,
          routeFamily: raw.routeFamily,
          networkBucket: projection.project({ siteId, purpose: "network-address", value: address }),
        });
        if ((await bounded(options.isInstalledSite(siteId))) !== true)
          return { disposition: "disabled", eventId: null, incidentId: null };
        return await bounded(
          getDb().transaction(
            async (transaction): Promise<NpAgentGuardianHttpObservationResultV1> => {
              const scope = deadlineTransaction(transaction, checkpoint);
              const db = scope.db;
              try {
                const timeout = await db.execute(
                  sql`select extract(epoch from current_setting('statement_timeout')::interval)*1000 as milliseconds`,
                );
                const inherited = Number(timeout.rows[0]?.milliseconds);
                if (!Number.isFinite(inherited) || inherited < 0) unavailable();
                const before = async () => {
                  checkpoint();
                  const remaining = Math.min(
                    500,
                    inherited || 500,
                    Math.floor(deadline - performance.now()),
                  );
                  if (remaining <= 0) unavailable("GUARDIAN_HTTP_SOURCE_TIMEOUT", 503);
                  await db.execute(
                    sql`select set_config('lock_timeout',${`${Math.min(100, remaining)}ms`},true), set_config('statement_timeout',${`${remaining}ms`},true)`,
                  );
                };
                await before();
                return await npWithAgentRuntimeControlTransactionV1(
                  siteId,
                  async ({ db }) => {
                    if (
                      (await npReadAgentGuardianCaptureAdmissionV1(db, siteId)).state === "disabled"
                    )
                      return { disposition: "disabled", eventId: null, incidentId: null };
                    if (
                      await npIsAgentGuardianSourceDeliveryClosedV1(db, siteId, "http", occurredAt)
                    )
                      return { disposition: "closed", eventId: null, incidentId: null };
                    await bounded(options.authorize({ db, siteId }));
                    await before();
                    const [previous] = await db
                      .select()
                      .from(npAgentEvents)
                      .where(
                        and(
                          eq(npAgentEvents.siteId, siteId),
                          eq(
                            npAgentEvents.sourceComponent,
                            NP_AGENT_GUARDIAN_HTTP_SOURCE_COMPONENT_V1,
                          ),
                          eq(npAgentEvents.kind, "http.response.observed"),
                          eq(npAgentEvents.deduplicationKey, `guardian-http:${observationId}`),
                        ),
                      )
                      .limit(1);
                    let row: EventRow;
                    const time = now();
                    if (!Number.isFinite(time.getTime())) unavailable();
                    if (previous) {
                      const original = await verify(db, previous, bounded);
                      const historicalProjection = createAgentGuardianActorProjectionV1({
                        id: original.networkBucket.keyId,
                        bytes: await retainedKey(original.networkBucket.keyId, "actor", bounded),
                      });
                      const replay = npRequireAgentGuardianHttpActivityV1({
                        ...activity,
                        networkBucket: historicalProjection.project({
                          siteId,
                          purpose: "network-address",
                          value: address,
                        }),
                      });
                      if (!same(original, replay)) unavailable("GUARDIAN_HTTP_SOURCE_CONFLICT");
                      row = previous;
                    } else {
                      if (
                        Date.parse(occurredAt) > time.getTime() ||
                        time.getTime() - Date.parse(occurredAt) > 60_000
                      )
                        unavailable("GUARDIAN_HTTP_SOURCE_STALE");
                      const start = Math.floor(Date.parse(occurredAt) / 600_000) * 600_000;
                      await before();
                      const retained = await db
                        .select()
                        .from(npAgentEvents)
                        .where(
                          and(
                            eq(npAgentEvents.siteId, siteId),
                            eq(
                              npAgentEvents.sourceComponent,
                              NP_AGENT_GUARDIAN_HTTP_SOURCE_COMPONENT_V1,
                            ),
                            gte(npAgentEvents.occurredAt, new Date(start)),
                            lt(npAgentEvents.occurredAt, new Date(start + 600_000)),
                          ),
                        )
                        .limit(101);
                      if (retained.length >= npAgentGuardianHttpRuleBoundsV1.maximumActivities)
                        return { disposition: "capped", eventId: null, incidentId: null };
                      const alreadyObserved = retained.filter(
                        (event) =>
                          event.payload.kind === "http.response.observed" &&
                          event.payload.activity.status === activity.status &&
                          event.payload.activity.routeFamily === activity.routeFamily &&
                          same(event.payload.activity.networkBucket, activity.networkBucket),
                      );
                      if (alreadyObserved.length >= 5)
                        return { disposition: "capped", eventId: null, incidentId: null };
                      const event = npRequireAgentEventCanonical({
                        version: "np.agent-event.v1",
                        siteId,
                        kind: "http.response.observed",
                        occurredAt,
                        source: {
                          kind: "api",
                          component: NP_AGENT_GUARDIAN_HTTP_SOURCE_COMPONENT_V1,
                        },
                        actor: { kind: "anonymous", ...activity.networkBucket },
                        subject: { kind: "actor-bucket", ...activity.networkBucket },
                        causation: null,
                        correlationId: null,
                        deduplicationKey: `guardian-http:${observationId}`,
                        privacy: "sensitive",
                        payload: {
                          kind: "http.response.observed",
                          receiptId: observationId,
                          activity,
                        },
                      });
                      await before();
                      await npAssertAgentGuardianDeliveryKeyAvailableV1(db, event, "http");
                      const recorded = await bounded(
                        options.events.record({
                          db,
                          siteId,
                          event,
                          expiresAt: new Date(time.getTime() + 86400000),
                        }),
                      );
                      await before();
                      if (recorded.replayed) unavailable();
                      const rows = await npReadAgentEventRowsV1(db, siteId, [recorded.eventId]);
                      if (
                        rows.length !== 1 ||
                        !same(await npReadAgentEventRowEvidenceV1(rows[0]), event) ||
                        rows[0].eventHash !== (await npDigestAgentEventCanonical(event)) ||
                        rows[0].recordedAt < time ||
                        rows[0].recordedAt > now() ||
                        rows[0].recordedAt.getTime() - Date.parse(occurredAt) > 60_000
                      )
                        unavailable();
                      row = rows[0];
                      const base: Omit<NpAgentGuardianHttpSourceReceiptV1, "sourceMac"> = {
                        schemaVersion: "np.agent-guardian-http-receipt.v1",
                        siteId,
                        receiptId: observationId,
                        keyId: receiptKeyId,
                        eventId: row.id,
                        eventHash: row.eventHash,
                        bodyHash: bodyHash(activity),
                        recordedAt: row.recordedAt.toISOString(),
                      };
                      await before();
                      await db.insert(npAuditEvents).values({
                        id: observationId,
                        siteId,
                        actorKind: "system",
                        actorUserId: null,
                        actorMemberId: null,
                        action: SOURCE_ACTION,
                        targetType: "agent-event",
                        targetId: row.id,
                        payload: { ...base, sourceMac: mac(receiptKey, base) },
                        createdAt: row.recordedAt,
                      });
                      await db
                        .update(npAgentEvents)
                        .set({ dispatchedAt: row.recordedAt })
                        .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, row.id)));
                      row = { ...row, dispatchedAt: row.recordedAt };
                    }
                    const start = Math.floor(Date.parse(occurredAt) / 600_000) * 600_000;
                    await before();
                    const retained = await db
                      .select()
                      .from(npAgentEvents)
                      .where(
                        and(
                          eq(npAgentEvents.siteId, siteId),
                          eq(
                            npAgentEvents.sourceComponent,
                            NP_AGENT_GUARDIAN_HTTP_SOURCE_COMPONENT_V1,
                          ),
                          eq(npAgentEvents.kind, "http.response.observed"),
                          gte(npAgentEvents.occurredAt, new Date(start)),
                          lt(npAgentEvents.occurredAt, new Date(start + 600_000)),
                        ),
                      )
                      .orderBy(asc(npAgentEvents.occurredAt), asc(npAgentEvents.id))
                      .limit(101);
                    if (retained.length > 100) unavailable();
                    const matches: EventRow[] = [];
                    const observedActivity = await verify(db, row, bounded);
                    for (const retainedRow of retained) {
                      const event = await npReadAgentEventRowEvidenceV1(retainedRow);
                      if (
                        event.payload.kind === "http.response.observed" &&
                        event.payload.activity.status === activity.status &&
                        event.payload.activity.routeFamily === activity.routeFamily &&
                        same(event.payload.activity.networkBucket, observedActivity.networkBucket)
                      )
                        matches.push(retainedRow);
                    }
                    let incidentId: string | null = null;
                    if (matches.length >= 5) {
                      const selected = matches.slice(0, 5),
                        detected = await candidate(db, selected, bounded);
                      const notifications = options.notifications;
                      const observed = await npObserveIncidentCandidate({
                        transaction: db,
                        candidate: detected,
                        now,
                        notifications: notifications
                          ? {
                              record: async (input) => {
                                await bounded(notifications.record(input));
                                await before();
                              },
                            }
                          : undefined,
                        resolveEvidence: async (readDb) => {
                          const rebuilt = await candidate(
                            readDb,
                            await npReadAgentEventRowsV1(
                              readDb,
                              siteId,
                              selected.map((event) => event.id),
                            ),
                            bounded,
                          );
                          return (
                            same(rebuilt.canonicalEvidence, detected.canonicalEvidence) &&
                            rebuilt.fingerprint === detected.fingerprint
                          );
                        },
                      });
                      incidentId = observed.incidentId;
                    }
                    await before();
                    return {
                      disposition: previous ? "replayed" : "recorded",
                      eventId: row.id,
                      incidentId,
                    };
                  },
                  db,
                );
              } finally {
                scope.close();
              }
            },
          ),
        );
      } finally {
        inFlight--;
      }
    },
    async verifyEvent(input) {
      canonicalBodySiteId(input.siteId, "guardian.http.siteId");
      canonicalBodyUuid(input.eventId, "guardian.http.eventId");
      const rows = await npReadAgentEventRowsV1(input.db, input.siteId, [input.eventId]);
      if (rows.length !== 1) unavailable();
      const activity = await verify(input.db, rows[0]);
      return npRequireAgentGuardianVerifiedEventV1({
        schemaVersion: "np.agent-guardian-verified-event.v1",
        eventId: rows[0].id,
        source: "http",
        observedAt: activity.occurredAt,
        sourceDigest: rows[0].eventHash,
        detectorId: "guardian.http-responses",
      });
    },
    verifySignal: (input) =>
      npVerifyGuardianSignalRuleV1(input, async (_signal, ids) =>
        candidate(input.db, await npReadAgentEventRowsV1(input.db, input.siteId, ids)),
      ),
    async evidence(input) {
      const sources = await npReadAgentIncidentCanonicalSourcesV1(input);
      const stored = await input.db
        .select()
        .from(npAgentSignals)
        .where(
          and(
            eq(npAgentSignals.siteId, input.siteId),
            eq(npAgentSignals.incidentId, input.incident.id),
            inArray(npAgentSignals.id, input.incident.signalIds),
          ),
        )
        .limit(101);
      if (!stored.length || stored.length !== sources.signals.length) unavailable();
      const output: NpAgentGuardianHttpEvidenceV1[] = [];
      for (const signal of stored) {
        if (signal.detectorId !== "guardian.http-responses") unavailable();
        const canonical = await npReadAgentIncidentSignalEvidenceV1(signal);
        if (canonical.evidence.some((ref) => ref.kind !== "event")) unavailable();
        const rows = await npReadAgentEventRowsV1(
          input.db,
          input.siteId,
          canonical.evidence.flatMap((ref) => (ref.kind === "event" ? [ref.eventId] : [])),
        );
        const rebuilt = await candidate(input.db, rows);
        if (
          !same(rebuilt.canonicalEvidence, canonical) ||
          rebuilt.evidenceDigest !== signal.evidenceDigest ||
          rebuilt.fingerprint !== signal.fingerprint ||
          rebuilt.fingerprint !== input.incident.fingerprint ||
          signal.severity !== "low" ||
          signal.confidenceBasis !== "exact-rule" ||
          signal.scoreBasisPoints !== null ||
          input.incident.category !== "traffic" ||
          !same(input.incident.primarySubject, canonical.subject)
        )
          unavailable();
        const activity = await verify(input.db, rows[0]);
        output.push(
          npRequireAgentGuardianHttpEvidenceV1({
            schemaVersion: "np.agent-guardian-http-evidence.v1",
            signalId: signal.id,
            detectorId: "guardian.http-responses",
            detectorVersion: 1,
            status: activity.status,
            routeFamily: activity.routeFamily,
            window: canonical.window,
            observedCount: 5,
            countBasis: "at-least",
            assessment: "review-only",
            sourceDigest: signal.evidenceDigest,
          }),
        );
      }
      return output;
    },
  };
}
