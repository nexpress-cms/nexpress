import {
  createAgentGuardianActorProjectionV1,
  NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1,
  npNormalizeAgentGuardianNetworkAddressV1,
} from "./guardian-actor-projection.js";
import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
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
  npAgentGuardianRouteFamiliesV1,
  npRequireAgentGuardianEvidenceV1,
  type NpAgentGuardianEvidenceV1,
  type NpAgentGuardianRouteFamilyV1,
} from "../agent-contract/guardian-contract.js";
import type { NpAgentActorBucketRefV1, NpAgentEventCanonicalV1 } from "../agent-contract/types.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
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

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;
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
    disposition: "recorded" | "replayed" | "capped";
    eventId: string | null;
    incidentId: string | null;
  }>;
}

export interface NpAgentGuardianObservationOptionsV1 {
  /** Explicit host installation. A copied existing host secret may be derived for this purpose;
   * the factory neither loads nor creates credentials. Rotate id with the key. */
  actorKey: { id: string; bytes: Uint8Array };
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
 * failures; the short database timeouts and per-site/per-source caps bound observation work. */
export function createAgentGuardianObservationServiceV1(
  options: NpAgentGuardianObservationOptionsV1,
): NpAgentGuardianObservationServiceV1 {
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
  const projection = createAgentGuardianActorProjectionV1(options.actorKey);
  const now = options.now ?? (() => new Date());
  const bucket = (siteId: string, purpose: NpAgentActorBucketRefV1["purpose"], value: string) =>
    projection.project({ siteId, purpose, value });
  let inFlight = 0;
  return {
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
        const event = npRequireAgentEventCanonical({
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
        if ((await options.isInstalledSite(siteId)) !== true) return unavailable();
        const eventHash = await npDigestAgentEventCanonical(event);
        return await getDb().transaction(async (tx) => {
          await tx.execute(
            sql`select set_config('lock_timeout','100ms',true), set_config('statement_timeout','500ms',true)`,
          );
          return npWithAgentRuntimeControlTransactionV1(
            siteId,
            async ({ db }) => {
              // The site control lock serializes capture and maintenance. New source rows
              // are unexpired; creating same-site references needs no global deletion fence.
              await options.authorize({ db, siteId });
              const [previous] = await db
                .select()
                .from(npAgentEvents)
                .where(
                  and(
                    eq(npAgentEvents.siteId, siteId),
                    eq(npAgentEvents.sourceComponent, event.source.component),
                    eq(npAgentEvents.kind, event.kind),
                    eq(npAgentEvents.deduplicationKey, id),
                  ),
                )
                .limit(1);
              if (previous && previous.eventHash !== eventHash)
                throw new NpAgentGatewayError(
                  "IDEMPOTENCY_KEY_REUSED",
                  409,
                  "Security observation conflicts with retained evidence.",
                );
              if (previous) await npReadAgentEventRowEvidenceV1(previous);
              const time = now();
              if (
                !Number.isFinite(time.getTime()) ||
                (!previous &&
                  (Date.parse(occurredAt) > time.getTime() ||
                    time.getTime() - Date.parse(occurredAt) > 60_000))
              )
                unavailable();
              const start =
                Math.floor(Date.parse(occurredAt) / NP_AGENT_GUARDIAN_WINDOW_MS_V1) *
                NP_AGENT_GUARDIAN_WINDOW_MS_V1;
              const rows = await db
                .select()
                .from(npAgentEvents)
                .where(
                  and(
                    eq(npAgentEvents.siteId, siteId),
                    inArray(npAgentEvents.sourceComponent, components),
                    gte(npAgentEvents.recordedAt, new Date(start)),
                    lt(
                      npAgentEvents.recordedAt,
                      new Date(start + NP_AGENT_GUARDIAN_WINDOW_MS_V1 + 60_000),
                    ),
                    gte(npAgentEvents.occurredAt, new Date(start)),
                    lt(npAgentEvents.occurredAt, new Date(start + NP_AGENT_GUARDIAN_WINDOW_MS_V1)),
                  ),
                )
                .orderBy(asc(npAgentEvents.occurredAt), asc(npAgentEvents.id))
                .limit(NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1 + 1);
              if (rows.length > NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1) unavailable();
              const matches = rows.filter(
                (r) =>
                  r.kind === event.kind &&
                  same(r.actor, event.actor) &&
                  (r.payload.kind === "auth.login.failed"
                    ? r.payload.audience
                    : r.payload.kind === "api.rate-limited"
                      ? r.payload.routeFamily
                      : null) === sourceDimension(event),
              );
              if (matches.length > NP_AGENT_GUARDIAN_THRESHOLD_V1) unavailable();
              let eventId = previous?.id ?? null;
              const capped =
                !previous &&
                (rows.length >= NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1 ||
                  matches.length >= NP_AGENT_GUARDIAN_THRESHOLD_V1);
              if (!previous && !capped) {
                const recorded = await options.events.record({
                  siteId,
                  event,
                  expiresAt: new Date(time.getTime() + 86400000),
                  db,
                });
                eventId = recorded.eventId;
                const [stored] = await npReadAgentEventRowsV1(db, siteId, [eventId]);
                if (
                  !stored ||
                  stored.recordedAt.getTime() < start ||
                  stored.recordedAt.getTime() >= start + NP_AGENT_GUARDIAN_WINDOW_MS_V1 + 60_000 ||
                  stored.expiresAt.getTime() !== time.getTime() + 86400000 ||
                  (await npDigestAgentEventCanonical(
                    await npReadAgentEventRowEvidenceV1(stored),
                  )) !== eventHash
                )
                  unavailable();
                matches.push(stored);
                // Deterministic consumption is complete; no Runtime dispatch or Run is implied.
                await db
                  .update(npAgentEvents)
                  .set({ dispatchedAt: stored.recordedAt })
                  .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, eventId)));
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
            tx as Db,
          );
        });
      } finally {
        inFlight--;
      }
    },
  };
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
