import {
  npVerifyGuardianSignalRuleV1,
  type NpGuardianSignalRuleVerificationV1,
} from "./guardian-signal-rule-verifier.js";
import { npReadAgentGuardianCaptureAdmissionV1 } from "./guardian-capture-admission.js";
import {
  npIsAgentGuardianSourceDeliveryClosedV1,
  npAssertAgentGuardianDeliveryKeyAvailableV1,
} from "./guardian-source-closure.js";
import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npSessions, npUsers } from "../db/schema/system.js";
import { npMembers, npMemberSessions } from "../db/schema/community.js";
import { npAgentEvents, npAgentSignals } from "../db/schema/agent.js";
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
  npDigestAgentEventCanonical,
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentEventCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import {
  NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1,
  NP_AGENT_GUARDIAN_THRESHOLD_V1,
  NP_AGENT_GUARDIAN_WINDOW_MS_V1,
} from "../agent-contract/guardian-contract.js";
import type { NpAgentEventCanonicalV1 } from "../agent-contract/types.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import {
  createAgentGuardianActorProjectionV1,
  NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1,
  npNormalizeAgentGuardianNetworkAddressV1,
} from "./guardian-actor-projection.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
import { npReadAgentIncidentCanonicalSourcesV1 } from "./incident-source-evidence.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "./incident-service.js";
import {
  npObserveIncidentCandidate,
  type NpIncidentObservationCandidate,
} from "./incident-observation-service.js";
import type { NpAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const hash = (value: unknown) =>
  createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url");
const component = "auth.guardian-session";
const detector = "guardian.login-after-failures";
const loginBinding = (value: unknown) => `gs1:${hash(value)}`;
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_SESSION_EVIDENCE_UNAVAILABLE",
    409,
    "Trusted login-session evidence is unavailable.",
  );
}

/** Trusted auth success, after a new session was persisted. Never accepts tokens or model targets. */
export interface NpAgentGuardianSessionObservationV1 {
  siteId: string;
  observationId: string;
  occurredAt: string;
  networkAddress: string;
  audience: "staff" | "member";
  principalId: string;
  sessionFamilyId: string;
}
export interface NpAgentGuardianSessionObservationServiceV1 {
  observe(input: NpAgentGuardianSessionObservationV1): Promise<{
    disposition: "recorded" | "replayed" | "capped" | "disabled" | "closed";
    eventId: string | null;
    incidentId: string | null;
  }>;
}
export interface NpAgentGuardianSessionObservationOptionsV1 {
  /** Must match the installed failure collector projection. Copied, never loaded/generated here. */
  actorKey: { id: string; bytes: Uint8Array };
  isInstalledSite(siteId: string): Promise<boolean>;
  authorize(input: { siteId: string; db: Db }): Promise<void>;
  events: Pick<NpAgentRuntimeEventServiceV1, "record">;
  notifications?: Pick<NpAgentIncidentNotificationsServiceV1, "record" | "recordFailure">;
  now?: () => Date;
}
export interface NpGuardianSessionIncidentEvidenceV1 {
  actorKind: "staff" | "member";
  principalId: string;
  sessionFamilyId: string;
  createdAt: string;
  sourceDigest: string;
}

function successIdentity(
  event: NpAgentEventCanonicalV1,
): Omit<NpGuardianSessionIncidentEvidenceV1, "sourceDigest"> {
  const { payload, subject, actor } = event;
  if (
    payload.kind !== "auth.login.succeeded" ||
    event.source.kind !== "auth" ||
    event.source.component !== component ||
    payload.reasonCode !== "SESSION_CREATED" ||
    payload.userAgentFamily !== null ||
    event.privacy !== "sensitive" ||
    event.causation !== null ||
    event.deduplicationKey !== `session:${payload.audience}:${payload.sessionFamilyId}` ||
    typeof event.correlationId !== "string" ||
    !/^gs1:[A-Za-z0-9_-]{43}$/u.test(event.correlationId) ||
    subject?.kind !== "session" ||
    subject.actorKind !== payload.audience ||
    subject.sessionFamilyId !== payload.sessionFamilyId ||
    actor?.kind !== payload.audience ||
    payload.ipBucket.projectionVersion !== 1 ||
    payload.ipBucket.projectionFingerprint !== NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1
  )
    return unavailable();
  const principalId =
    actor.kind === "staff"
      ? actor.userId
      : actor.kind === "member"
        ? actor.memberId
        : unavailable();
  return {
    actorKind: payload.audience,
    principalId,
    sessionFamilyId: payload.sessionFamilyId,
    createdAt: event.occurredAt,
  };
}
function matchingFailure(
  event: NpAgentEventCanonicalV1,
  success: NpAgentEventCanonicalV1,
): boolean {
  if (success.payload.kind !== "auth.login.succeeded") return false;
  const payload = event.payload;
  if (payload.kind !== "auth.login.failed") return false;
  const subject = event.subject;
  return (
    event.source.kind === "auth" &&
    event.source.component === "auth.guardian" &&
    event.siteId === success.siteId &&
    payload.audience === success.payload.audience &&
    payload.reasonCode === "INVALID_CREDENTIALS" &&
    payload.sessionFamilyId === null &&
    payload.userAgentFamily === null &&
    event.causation === null &&
    event.correlationId === null &&
    event.privacy === "sensitive" &&
    event.deduplicationKey !== null &&
    same(payload.ipBucket, success.payload.ipBucket) &&
    same(event.actor, { kind: "anonymous", ...payload.ipBucket }) &&
    subject?.kind === "actor-bucket" &&
    subject.purpose === "login-identifier" &&
    subject.projectionVersion === payload.ipBucket.projectionVersion &&
    subject.projectionFingerprint === payload.ipBucket.projectionFingerprint &&
    subject.keyId === payload.ipBucket.keyId &&
    loginBinding({
      purpose: subject.purpose,
      projectionVersion: subject.projectionVersion,
      projectionFingerprint: subject.projectionFingerprint,
      keyId: subject.keyId,
      bucket: subject.bucket,
    }) === success.correlationId &&
    Date.parse(event.occurredAt) <= Date.parse(success.occurredAt) &&
    Date.parse(event.occurredAt) >= Date.parse(success.occurredAt) - NP_AGENT_GUARDIAN_WINDOW_MS_V1
  );
}
function sessionFingerprint(success: NpAgentEventCanonicalV1): string {
  return `cj1:sha256:${hash({ purpose: "np.agent-guardian-session-correlation.v1", siteId: success.siteId, detector, identity: successIdentity(success) })}`;
}
async function candidate(rows: EventRow[]): Promise<NpIncidentObservationCandidate> {
  if (
    rows.length !== NP_AGENT_GUARDIAN_THRESHOLD_V1 + 1 ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    return unavailable();
  const events = await Promise.all(rows.map(npReadAgentEventRowEvidenceV1));
  if (
    rows.some(
      (row, index) =>
        row.recordedAt.getTime() < Date.parse(events[index].occurredAt) ||
        row.recordedAt.getTime() - Date.parse(events[index].occurredAt) > 60_000,
    )
  )
    return unavailable();
  const successes = events.filter((e) => e.kind === "auth.login.succeeded");
  if (successes.length !== 1) return unavailable();
  const success = successes[0];
  successIdentity(success);
  const failures = events.filter((e) => e.kind !== "auth.login.succeeded");
  if (
    new Set(events.map((e) => e.deduplicationKey)).size !== rows.length ||
    failures.some((e) => !matchingFailure(e, success))
  )
    return unavailable();
  const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId: success.siteId,
    detectorId: detector,
    detectorVersion: 1,
    category: "authentication",
    subject: success.subject,
    window: {
      startedAt: new Date(Math.min(...events.map((e) => Date.parse(e.occurredAt)))).toISOString(),
      endedAt: success.occurredAt,
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
    fingerprint: sessionFingerprint(success),
    severity: "high",
    confidenceBasis: "exact-rule",
    scoreBasisPoints: null,
    title: "Login after repeated credential failures",
    summary:
      "A new browser session followed at least five failed logins for the same login identifier and network within ten minutes. This rule does not establish malicious intent. Session termination always requires a separate human approval.",
  };
}

/** Bounded deterministic observation only. Installs no response, worker, provider, or authority. */
export function createAgentGuardianSessionObservationServiceV1(
  options: NpAgentGuardianSessionObservationOptionsV1,
): NpAgentGuardianSessionObservationServiceV1 {
  const projection = createAgentGuardianActorProjectionV1(options.actorKey);
  if (
    typeof options.isInstalledSite !== "function" ||
    typeof options.authorize !== "function" ||
    typeof options.events?.record !== "function"
  )
    unavailable();
  const now = options.now ?? (() => new Date());
  let inFlight = 0;
  return {
    async observe(input) {
      npAssertAgentPreviewEffectsAllowed();
      if (inFlight >= 4) unavailable();
      inFlight++;
      try {
        const keys = [
          "siteId",
          "observationId",
          "occurredAt",
          "networkAddress",
          "audience",
          "principalId",
          "sessionFamilyId",
        ];
        const raw = canonicalBodyRecord(
          cloneCanonicalRuntimeInput(input, "guardianSession.observation", 8192),
          "guardianSession.observation",
          keys,
          keys,
          { seen: new WeakSet() },
        );
        const siteId = canonicalBodySiteId(raw.siteId, "guardianSession.siteId");
        canonicalBodyUuid(raw.observationId, "guardianSession.observationId");
        const observedAt = canonicalBodyUtc(raw.occurredAt, "guardianSession.occurredAt");
        const principalId = canonicalBodyUuid(raw.principalId, "guardianSession.principalId");
        const sessionFamilyId = canonicalBodyUuid(
          raw.sessionFamilyId,
          "guardianSession.sessionFamilyId",
        );
        const audience = canonicalBodyEnum(
          raw.audience,
          "guardianSession.audience",
          new Set(["staff", "member"] as const),
        );
        const sourceKey = `session:${audience}:${sessionFamilyId}`;
        const ipBucket = {
          ...projection.project({
            siteId,
            purpose: "network-address",
            value: npNormalizeAgentGuardianNetworkAddressV1(raw.networkAddress),
          }),
          purpose: "network-address" as const,
        };
        if ((await options.isInstalledSite(siteId)) !== true) unavailable();
        return await getDb().transaction(async (tx) => {
          await tx.execute(
            sql`select set_config('lock_timeout','100ms',true), set_config('statement_timeout','500ms',true)`,
          );
          return npWithAgentRuntimeControlTransactionV1(
            siteId,
            async ({ db }) => {
              if ((await npReadAgentGuardianCaptureAdmissionV1(db, siteId)).state === "disabled")
                return { disposition: "disabled" as const, eventId: null, incidentId: null };
              if (await npIsAgentGuardianSourceDeliveryClosedV1(db, siteId, "requests", observedAt))
                return { disposition: "closed" as const, eventId: null, incidentId: null };
              await options.authorize({ siteId, db });
              const time = now();
              if (!Number.isFinite(time.getTime()) || Date.parse(observedAt) > time.getTime())
                unavailable();
              const [previous] = await db
                .select()
                .from(npAgentEvents)
                .where(
                  and(
                    eq(npAgentEvents.siteId, siteId),
                    eq(npAgentEvents.sourceComponent, component),
                    eq(npAgentEvents.kind, "auth.login.succeeded"),
                    eq(npAgentEvents.deduplicationKey, sourceKey),
                  ),
                )
                .limit(1);
              let event: NpAgentEventCanonicalV1;
              if (previous) {
                event = await npReadAgentEventRowEvidenceV1(previous);
                const identity = successIdentity(event);
                if (
                  identity.actorKind !== audience ||
                  identity.principalId !== principalId ||
                  identity.sessionFamilyId !== sessionFamilyId ||
                  event.payload.kind !== "auth.login.succeeded" ||
                  !same(event.payload.ipBucket, ipBucket)
                )
                  unavailable();
              } else {
                if (
                  Date.parse(observedAt) > time.getTime() ||
                  time.getTime() - Date.parse(observedAt) > 60_000
                )
                  unavailable();
                const rows =
                  audience === "staff"
                    ? await db
                        .select({ createdAt: npSessions.createdAt, email: npUsers.email })
                        .from(npSessions)
                        .innerJoin(npUsers, eq(npUsers.id, npSessions.userId))
                        .where(
                          and(
                            eq(npSessions.id, sessionFamilyId),
                            eq(npSessions.userId, principalId),
                            gte(npSessions.refreshExpiresAt, time),
                          ),
                        )
                        .limit(1)
                    : await db
                        .select({ createdAt: npMemberSessions.createdAt, email: npMembers.email })
                        .from(npMemberSessions)
                        .innerJoin(npMembers, eq(npMembers.id, npMemberSessions.memberId))
                        .where(
                          and(
                            eq(npMemberSessions.id, sessionFamilyId),
                            eq(npMemberSessions.memberId, principalId),
                            gte(npMemberSessions.refreshExpiresAt, time),
                          ),
                        )
                        .limit(1);
                const session = rows[0];
                if (
                  !session ||
                  session.createdAt.getTime() > time.getTime() ||
                  time.getTime() - session.createdAt.getTime() > 60_000 ||
                  Math.abs(Date.parse(observedAt) - session.createdAt.getTime()) > 60_000
                )
                  unavailable();
                event = npRequireAgentEventCanonical({
                  version: "np.agent-event.v1",
                  siteId,
                  kind: "auth.login.succeeded",
                  // The immutable source timestamp freezes exact family creation identity after deletion.
                  occurredAt: session.createdAt.toISOString(),
                  source: { kind: "auth", component },
                  subject: { kind: "session", actorKind: audience, sessionFamilyId },
                  actor:
                    audience === "staff"
                      ? { kind: "staff", userId: principalId }
                      : { kind: "member", memberId: principalId },
                  causation: null,
                  correlationId: loginBinding(
                    projection.project({
                      siteId,
                      purpose: "login-identifier",
                      value: session.email,
                    }),
                  ),
                  deduplicationKey: sourceKey,
                  privacy: "sensitive",
                  payload: {
                    kind: "auth.login.succeeded",
                    audience,
                    outcome: "succeeded",
                    reasonCode: "SESSION_CREATED",
                    sessionFamilyId,
                    ipBucket,
                    userAgentFamily: null,
                  },
                });
              }
              if (previous) {
                // Once one exact source cohort was consumed, retries verify and reuse it.
                // Later floods/backfilled observations cannot change the frozen six events.
                const frozen = await db
                  .select()
                  .from(npAgentSignals)
                  .where(
                    and(
                      eq(npAgentSignals.siteId, siteId),
                      eq(npAgentSignals.detectorId, detector),
                      eq(npAgentSignals.fingerprint, sessionFingerprint(event)),
                    ),
                  )
                  .limit(2);
                if (frozen.length > 1) unavailable();
                if (frozen.length === 1) {
                  const signal = await npReadAgentIncidentSignalEvidenceV1(frozen[0]);
                  const refs = signal.evidence.filter((ref) => ref.kind === "event");
                  if (
                    refs.length !== signal.evidence.length ||
                    !refs.some((ref) => ref.eventId === previous.id)
                  )
                    unavailable();
                  const rows = await npReadAgentEventRowsV1(
                    db,
                    siteId,
                    refs.map((ref) => ref.eventId),
                  );
                  const detected = await candidate(rows);
                  if (
                    !same(detected.canonicalEvidence, signal) ||
                    detected.fingerprint !== frozen[0].fingerprint
                  )
                    unavailable();
                  const result = await npObserveIncidentCandidate({
                    candidate: detected,
                    now,
                    notifications: options.notifications,
                    transaction: db,
                    resolveEvidence: async (readDb) =>
                      same(
                        (
                          await candidate(
                            await npReadAgentEventRowsV1(
                              readDb,
                              siteId,
                              rows.map((row) => row.id),
                            ),
                          )
                        ).canonicalEvidence,
                        signal,
                      ),
                  });
                  return {
                    disposition: "replayed",
                    eventId: previous.id,
                    incidentId: result.incidentId,
                  };
                }
              }
              const start = new Date(Date.parse(event.occurredAt) - NP_AGENT_GUARDIAN_WINDOW_MS_V1);
              const retained = await db
                .select()
                .from(npAgentEvents)
                .where(
                  and(
                    eq(npAgentEvents.siteId, siteId),
                    inArray(npAgentEvents.sourceComponent, [
                      "auth.guardian",
                      "api.guardian",
                      component,
                    ]),
                    gte(npAgentEvents.occurredAt, start),
                    lte(npAgentEvents.occurredAt, new Date(event.occurredAt)),
                    gte(npAgentEvents.recordedAt, start),
                  ),
                )
                .orderBy(asc(npAgentEvents.occurredAt), asc(npAgentEvents.id))
                .limit(NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1 + 1);
              if (retained.length > NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1) unavailable();
              if (!previous && retained.length >= NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1)
                return { disposition: "capped", eventId: null, incidentId: null };
              let stored = previous;
              if (!stored) {
                await npAssertAgentGuardianDeliveryKeyAvailableV1(db, event, "requests");
                const recorded = await options.events.record({
                  siteId,
                  event,
                  expiresAt: new Date(time.getTime() + 86400000),
                  db,
                });
                [stored] = await npReadAgentEventRowsV1(db, siteId, [recorded.eventId]);
                if (
                  !stored ||
                  (await npDigestAgentEventCanonical(
                    await npReadAgentEventRowEvidenceV1(stored),
                  )) !== (await npDigestAgentEventCanonical(event))
                )
                  unavailable();
                await db
                  .update(npAgentEvents)
                  .set({ dispatchedAt: stored.recordedAt })
                  .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, stored.id)));
              }
              const failures: EventRow[] = [];
              for (const row of retained) {
                if (row.kind !== "auth.login.failed" || row.sourceComponent !== "auth.guardian")
                  continue;
                if (matchingFailure(await npReadAgentEventRowEvidenceV1(row), event))
                  failures.push(row);
              }
              let incidentId: string | null = null;
              if (failures.length >= NP_AGENT_GUARDIAN_THRESHOLD_V1) {
                const evidenceRows = [...failures.slice(0, NP_AGENT_GUARDIAN_THRESHOLD_V1), stored];
                const detected = await candidate(evidenceRows);
                const result = await npObserveIncidentCandidate({
                  candidate: detected,
                  now,
                  notifications: options.notifications,
                  transaction: db,
                  resolveEvidence: async (readDb) =>
                    same(
                      (
                        await candidate(
                          await npReadAgentEventRowsV1(
                            readDb,
                            siteId,
                            evidenceRows.map((r) => r.id),
                          ),
                        )
                      ).canonicalEvidence,
                      detected.canonicalEvidence,
                    ),
                });
                incidentId = result.incidentId;
              }
              return {
                disposition: previous ? "replayed" : "recorded",
                eventId: stored.id,
                incidentId,
              };
            },
            tx as Db,
          );
        });
      } finally {
        inFlight--;
      }
    },
  };
}

/** Private immutable source proof. It intentionally works after the session was terminated. */
export async function npReadGuardianSessionIncidentEvidenceV1(input: {
  db: Db;
  siteId: string;
  incident: NpAgentIncidentV1;
}): Promise<NpGuardianSessionIncidentEvidenceV1> {
  const sources = await npReadAgentIncidentCanonicalSourcesV1(input);
  if (
    sources.signals.length !== 1 ||
    sources.signals[0].detectorId !== detector ||
    sources.signals[0].detectorVersion !== 1
  )
    unavailable();
  const signal = sources.signals[0];
  const refs = signal.evidence.filter((ref) => ref.kind === "event");
  if (refs.length !== signal.evidence.length) unavailable();
  const rebuilt = await candidate(
    await npReadAgentEventRowsV1(
      input.db,
      input.siteId,
      refs.map((ref) => ref.eventId),
    ),
  );
  if (
    !same(rebuilt.canonicalEvidence, signal) ||
    rebuilt.fingerprint !== input.incident.fingerprint ||
    !same(input.incident.primarySubject, signal.subject) ||
    input.incident.category !== "authentication"
  )
    unavailable();
  const success = sources.events.find((e) => e.kind === "auth.login.succeeded");
  if (!success) unavailable();
  return { ...successIdentity(success), sourceDigest: rebuilt.evidenceDigest };
}

/** Rebuilds the original deterministic rule; it does not establish source MAC authenticity. */
export async function npVerifyAgentGuardianSessionSignalV1(
  input: NpGuardianSignalRuleVerificationV1,
): Promise<boolean> {
  return npVerifyGuardianSignalRuleV1(input, async (_row, ids) =>
    candidate(await npReadAgentEventRowsV1(input.db, input.siteId, ids)),
  );
}
