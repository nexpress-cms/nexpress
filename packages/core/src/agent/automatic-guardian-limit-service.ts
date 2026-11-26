import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAgentIncidents, npAgentIncidentTimeline, npAgentSignals } from "../db/schema/agent.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  npRequireAgentAutomaticGuardianLimitAuthorizationV1,
  npRequireAgentAutomaticGuardianLimitDeploymentV1,
  type NpAgentAutomaticGuardianLimitAuthorizationV1,
  type NpAgentAutomaticGuardianLimitDeploymentV1,
  type NpAgentAutomaticGuardianLimitScopeV1,
} from "../agent-contract/automatic-guardian-limit-contract.js";
import {
  npRequireAgentIncidentV1,
  type NpAgentIncidentV1,
} from "../agent-contract/incident-contract.js";
import { npAgentIncidentSeverityRank } from "../agent-contract/types.js";
import {
  npAgentAutonomyAllowsV1,
  npIsAgentPolicyQuietTimeV1,
  npResolveAgentPolicyV1,
  type NpAgentPolicyResolutionInputV1,
  type NpAgentResolvedPolicyV1,
} from "../agent-contract/runtime-policy.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import {
  npReadAgentGuardianIncidentEvidenceV1,
  npIsAgentGuardianAuthenticatedRequestSourceV1,
  type NpAgentGuardianAuthenticatedRequestSourceV1,
} from "./guardian-observation-service.js";
import { npRequireAgentGuardianVerifiedEventV1 } from "../agent-contract/guardian-operations-contract.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "./incident-service.js";
import { npRequireIncidentSeverityEvidence } from "./incident-severity-evidence.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
import { npCreateAgentGuardianTransactionScopeV1 } from "./guardian-transaction-scope.js";

type Db = ReturnType<typeof getDb>;
type Timeline = typeof npAgentIncidentTimeline.$inferSelect;
const authorities = new WeakSet<object>();
const authorizations = new WeakSet<object>();
const same = (left: unknown, right: unknown) =>
  serializeAgentCanonicalJson(left) === serializeAgentCanonicalJson(right);
export const npDigestAgentAutomaticGuardianLimitEvidenceV1 = (purpose: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256")
    .update(purpose + "\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
function blockedError(): NpAgentGatewayError {
  return new NpAgentGatewayError(
    "AUTOMATIC_GUARDIAN_LIMIT_BLOCKED",
    409,
    "Automatic request limiting is not currently authorized.",
  );
}
function blocked(): never {
  throw blockedError();
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function time(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(value))) blocked();
  return new Date(
    canonicalBodyUtc(Date.prototype.toISOString.call(value), "automaticGuardianLimit.now"),
  );
}
export interface NpAgentAutomaticGuardianLimitCurrentInputV1 {
  db: Db;
  siteId: string;
  principalId: string;
  now: Date;
}
export interface NpAgentAutomaticGuardianLimitAuthorizeInputV1 extends NpAgentAutomaticGuardianLimitCurrentInputV1 {
  /** Caller MUST establish current principal admission and Incident read ACL in this same transaction. */
  incident: NpAgentIncidentV1;
  signalId: string;
}
export interface NpAgentAutomaticGuardianLimitAuthorityV1 {
  readonly deployment: Readonly<NpAgentAutomaticGuardianLimitDeploymentV1>;
  readonly deploymentDigest: string;
  assertCurrent(input: NpAgentAutomaticGuardianLimitCurrentInputV1): Promise<void>;
  /** Requires the existing owning transaction/lock order; grants no principal or read authority. */
  authorize(
    input: NpAgentAutomaticGuardianLimitAuthorizeInputV1,
  ): Promise<NpAgentAutomaticGuardianLimitAuthorizationV1>;
}
export interface NpAgentAutomaticGuardianLimitAuthorityOptionsV1 {
  deployment: NpAgentAutomaticGuardianLimitDeploymentV1;
  /** Exact factory-branded signed request source, never structural verifier callbacks. */
  requestObservations: Pick<
    NpAgentGuardianAuthenticatedRequestSourceV1,
    "verifyEvent" | "verifySignal"
  >;
  /** Trusted host owner must verify the exact immutable artifact against real production
   * review, legitimate-user/NAT impact, shadow, successful compensation and current
   * deployment approval/revocation evidence. True also attests durable expiry readiness.
   * This callback must use the supplied transaction and may not acquire later authority locks.
   * No model, HTTP caller or synthetic corpus supplies this decision. */
  verifyDeployment(
    input: NpAgentAutomaticGuardianLimitCurrentInputV1 & {
      deployment: Readonly<NpAgentAutomaticGuardianLimitDeploymentV1>;
      deploymentDigest: string;
    },
  ): Promise<boolean>;
  /** Actual current policy owner. Resolve in the already prepared admission transaction;
   * no new authority locks, browser session fabrication, provider or external effects. */
  resolvePolicy(
    input: NpAgentAutomaticGuardianLimitCurrentInputV1 & {
      incident: NpAgentIncidentV1;
    },
  ): Promise<NpAgentPolicyResolutionInputV1>;
}
/** Work deadline, not cancellation of an already running SQL statement. The
 * owning transaction retains its stricter SQL budget and alone drains/rolls back. */
async function withAuthorityScope<Input extends NpAgentAutomaticGuardianLimitCurrentInputV1, T>(
  original: Input,
  work: (input: Input, checkpoint: () => void) => Promise<T>,
): Promise<T> {
  const deadline = performance.now() + 1000;
  const checkpoint = () => {
    if (performance.now() >= deadline) blocked();
  };
  const scope = npCreateAgentGuardianTransactionScopeV1(original.db, {
    checkpoint,
    unavailable: blocked,
    closed: blocked,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => {
        checkpoint();
        return work({ ...original, db: scope.db }, checkpoint);
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            scope.close();
            reject(blockedError());
          },
          Math.max(1, deadline - performance.now()),
        );
      }),
    ]);
    checkpoint();
    return result;
  } finally {
    scope.close();
    if (timer) clearTimeout(timer);
  }
}
export function npIsAgentAutomaticGuardianLimitAuthorityV1(
  value: unknown,
): value is NpAgentAutomaticGuardianLimitAuthorityV1 {
  return typeof value === "object" && value !== null && authorities.has(value);
}
/** Only the exact freshly issued object is a live proof. JSON/history copies are never grants. */
export function npIsAgentAutomaticGuardianLimitAuthorizationV1(
  value: unknown,
): value is NpAgentAutomaticGuardianLimitAuthorizationV1 {
  return typeof value === "object" && value !== null && authorizations.has(value);
}
function escalationDigest(entry: Timeline): string {
  return npDigestAgentAutomaticGuardianLimitEvidenceV1(
    "np.agent-automatic-guardian-limit-escalation.v1",
    {
      id: entry.id,
      siteId: entry.siteId,
      incidentId: entry.incidentId,
      sequence: entry.sequence,
      sourceKind: entry.sourceKind,
      sourceId: entry.sourceId,
      sourceFingerprint: entry.sourceFingerprint,
      auditEventId: entry.auditEventId,
      createdAt: entry.createdAt.toISOString(),
      details: entry.details,
    },
  );
}
/** Explicit host-only authority. Factory performs no I/O and installs no action, worker or provider. */
export function createAgentAutomaticGuardianLimitAuthorityV1(
  options: NpAgentAutomaticGuardianLimitAuthorityOptionsV1,
): NpAgentAutomaticGuardianLimitAuthorityV1 {
  let deployment: NpAgentAutomaticGuardianLimitDeploymentV1;
  try {
    deployment = freeze(npRequireAgentAutomaticGuardianLimitDeploymentV1(options.deployment));
  } catch {
    return blocked();
  }
  if (typeof options.verifyDeployment !== "function" || typeof options.resolvePolicy !== "function")
    blocked();
  if (!npIsAgentGuardianAuthenticatedRequestSourceV1(options.requestObservations)) blocked();
  const verifySourceEvent = options.requestObservations.verifyEvent;
  const verifySourceSignal = options.requestObservations.verifySignal;
  const verifyDeployment = options.verifyDeployment.bind(options),
    resolvePolicy = options.resolvePolicy.bind(options);
  const deploymentDigest = npDigestAgentAutomaticGuardianLimitEvidenceV1(
    "np.agent-automatic-guardian-limit-deployment.v1",
    deployment,
  );
  async function current(
    input: NpAgentAutomaticGuardianLimitCurrentInputV1,
    checkpoint: () => void,
  ): Promise<void> {
    checkpoint();
    const now = time(input.now);
    if (
      canonicalBodySiteId(input.siteId, "automaticGuardianLimit.siteId") !== deployment.siteId ||
      !deployment.principalIds.includes(
        canonicalBodyUuid(input.principalId, "automaticGuardianLimit.principalId"),
      ) ||
      now.getTime() < Date.parse(deployment.issuedAt) ||
      now.getTime() >= Date.parse(deployment.expiresAt) ||
      (await verifyDeployment({
        db: input.db,
        siteId: input.siteId,
        principalId: input.principalId,
        now,
        deployment,
        deploymentDigest,
      })) !== true
    )
      blocked();
    checkpoint();
  }
  async function policy(
    input: NpAgentAutomaticGuardianLimitAuthorizeInputV1,
    checkpoint: () => void,
  ): Promise<NpAgentResolvedPolicyV1> {
    checkpoint();
    const source = await resolvePolicy(input);
    checkpoint();
    const value = npResolveAgentPolicyV1(source);
    const mode = value.capabilityModes.find(
      (entry) => entry.capabilityId === "security.limitActor",
    )?.mode;
    const floor = value.automation.guardianLimitActorMinSeverity;
    if (
      !mode ||
      !npAgentAutonomyAllowsV1(mode, "execute-automatic") ||
      value.risk.automaticActionMaximum !== "reversible" ||
      floor === null ||
      npAgentIncidentSeverityRank[input.incident.severity] < npAgentIncidentSeverityRank[floor] ||
      npIsAgentPolicyQuietTimeV1(value, input.now.toISOString()) ||
      (value.resources.incidentCategories !== null &&
        !value.resources.incidentCategories.includes(input.incident.category)) ||
      value.risk.requirePreviewAtOrAbove === "reversible" ||
      value.risk.requireRecentAuthAtOrAbove === "reversible"
    )
      blocked();
    return value;
  }
  async function latestEscalation(db: Db, siteId: string, incidentId: string): Promise<Timeline> {
    const [entry] = await db
      .select()
      .from(npAgentIncidentTimeline)
      .where(
        and(
          eq(npAgentIncidentTimeline.siteId, siteId),
          eq(npAgentIncidentTimeline.incidentId, incidentId),
          sql`${npAgentIncidentTimeline.details}->>'schemaVersion' in ('np.agent-incident-severity-entry.v1','np.agent-incident-rule-severity-entry.v1')`,
        ),
      )
      .orderBy(desc(npAgentIncidentTimeline.sequence))
      .limit(1);
    if (
      !entry ||
      entry.kind !== "human_note" ||
      entry.sourceKind !== "staff" ||
      entry.details.schemaVersion !== "np.agent-incident-severity-entry.v1"
    )
      blocked();
    return entry;
  }
  const authority: NpAgentAutomaticGuardianLimitAuthorityV1 = {
    deployment,
    deploymentDigest,
    async assertCurrent(input) {
      try {
        await withAuthorityScope(input, current);
      } catch {
        blocked();
      }
    },
    async authorize(original) {
      try {
        return await withAuthorityScope(original, async (scoped, checkpoint) => {
          const incident = npRequireAgentIncidentV1(scoped.incident),
            now = time(scoped.now);
          const input = { ...scoped, incident, now };
          const signalId = canonicalBodyUuid(input.signalId, "automaticGuardianLimit.signalId");
          await current(input, checkpoint);
          if (
            incident.siteId !== input.siteId ||
            !["open", "investigating"].includes(incident.status) ||
            !["authentication", "traffic"].includes(incident.category) ||
            !["high", "critical"].includes(incident.severity) ||
            npAgentIncidentSeverityRank[incident.severity] <
              npAgentIncidentSeverityRank[deployment.rule.minimumSeverity] ||
            incident.primarySubject?.kind !== "actor-bucket" ||
            incident.primarySubject.purpose !== "network-address" ||
            !incident.signalIds.includes(signalId)
          )
            blocked();
          const resolved = await policy(input, checkpoint);
          if ((await verifySourceSignal({ db: input.db, siteId: input.siteId, signalId })) !== true)
            blocked();
          const sourceEvidence = (
            await npReadAgentGuardianIncidentEvidenceV1({
              db: input.db,
              siteId: input.siteId,
              incident,
            })
          ).find((entry) => entry.signalId === signalId);
          const [signal] = await input.db
            .select()
            .from(npAgentSignals)
            .where(and(eq(npAgentSignals.siteId, input.siteId), eq(npAgentSignals.id, signalId)))
            .limit(1);
          if (
            !sourceEvidence ||
            sourceEvidence.detectorId !== deployment.rule.detectorId ||
            sourceEvidence.observedCount !== 5 ||
            sourceEvidence.threshold !== 5 ||
            sourceEvidence.countBasis !== "at-least" ||
            !signal ||
            signal.incidentId !== incident.id ||
            signal.status !== "attached" ||
            signal.fingerprint !== incident.fingerprint ||
            signal.detectorId !== deployment.rule.detectorId ||
            signal.detectorVersion !== 1 ||
            signal.severity !== "medium" ||
            signal.confidenceBasis !== "exact-rule" ||
            signal.scoreBasisPoints !== null
          )
            blocked();
          const canonical = await npReadAgentIncidentSignalEvidenceV1(signal);
          if (
            !same(canonical.subject, incident.primarySubject) ||
            canonical.category !== incident.category ||
            canonical.evidence.length !== 5 ||
            canonical.evidence.some((ref) => ref.kind !== "event") ||
            !same(canonical.window, sourceEvidence.window) ||
            Date.parse(canonical.window.endedAt) > now.getTime() ||
            now.getTime() - Date.parse(canonical.window.startedAt) >
              deployment.rule.maximumEvidenceAgeSeconds * 1000
          )
            blocked();
          let scope: NpAgentAutomaticGuardianLimitScopeV1;
          if (
            sourceEvidence.detectorId === "guardian.login-failures" &&
            sourceEvidence.audience !== null
          )
            scope = sourceEvidence.audience === "staff" ? "auth.staff" : "auth.member";
          else if (
            sourceEvidence.detectorId === "guardian.rate-limits" &&
            ["staff-auth", "member-auth"].includes(sourceEvidence.routeFamily ?? "")
          )
            scope = sourceEvidence.routeFamily === "staff-auth" ? "auth.staff" : "auth.member";
          else return blocked();
          if (
            !deployment.actionScopes.includes(scope) ||
            (resolved.resources.actorRestrictionScopes !== null &&
              !resolved.resources.actorRestrictionScopes.includes(scope))
          )
            blocked();
          const sourceEventIds = canonical.evidence
            .flatMap((ref) => (ref.kind === "event" ? [ref.eventId] : []))
            .sort();
          if (new Set(sourceEventIds).size !== 5) blocked();
          const eventRows = await npReadAgentEventRowsV1(input.db, input.siteId, sourceEventIds);
          if (eventRows.length !== 5) blocked();
          const events = await Promise.all(eventRows.map(npReadAgentEventRowEvidenceV1));
          const expectedKind =
            deployment.rule.detectorId === "guardian.login-failures"
              ? "auth.login.failed"
              : "api.rate-limited";
          for (let index = 0; index < eventRows.length; index++) {
            const row = eventRows[index],
              event = events[index];
            const verified = npRequireAgentGuardianVerifiedEventV1(
              await verifySourceEvent({ db: input.db, siteId: input.siteId, eventId: row.id }),
            );
            if (
              event.kind !== expectedKind ||
              verified.source !== "requests" ||
              verified.detectorId !== null ||
              verified.eventId !== row.id ||
              verified.observedAt !== event.occurredAt ||
              verified.sourceDigest !== row.eventHash
            )
              blocked();
          }
          const entry = await latestEscalation(input.db, input.siteId, incident.id),
            change = await npRequireIncidentSeverityEvidence(input.db, entry);
          const transitionVersion = entry.details.transitionVersion;
          if (
            typeof transitionVersion !== "number" ||
            !Number.isSafeInteger(transitionVersion) ||
            transitionVersion < 2 ||
            transitionVersion > incident.versionNumber ||
            change.toSeverity !== incident.severity ||
            entry.createdAt > now ||
            entry.createdAt.getTime() < Date.parse(canonical.window.endedAt) ||
            signal.createdAt > entry.createdAt ||
            now.getTime() - entry.createdAt.getTime() >
              deployment.rule.maximumEscalationAgeSeconds * 1000
          )
            blocked();
          // Source readers precede parent locks. All principal/control preparation belongs to the caller.
          const [stored] = await input.db
            .select()
            .from(npAgentIncidents)
            .where(
              and(eq(npAgentIncidents.siteId, input.siteId), eq(npAgentIncidents.id, incident.id)),
            )
            .for("update")
            .limit(1);
          const [currentSignal] = await input.db
            .select()
            .from(npAgentSignals)
            .where(and(eq(npAgentSignals.siteId, input.siteId), eq(npAgentSignals.id, signalId)))
            .for("update")
            .limit(1);
          const currentEntry = await latestEscalation(input.db, input.siteId, incident.id);
          if (
            !stored ||
            stored.versionNumber !== incident.versionNumber ||
            stored.updatedAt.toISOString() !== incident.updatedAt ||
            stored.status !== incident.status ||
            stored.severity !== incident.severity ||
            stored.fingerprint !== incident.fingerprint ||
            stored.category !== incident.category ||
            stored.eventCount !== incident.eventCount ||
            stored.signalCount !== incident.signalIds.length ||
            !same(stored.primarySubject, incident.primarySubject) ||
            !currentSignal ||
            currentSignal.incidentId !== incident.id ||
            currentSignal.status !== "attached" ||
            currentSignal.updatedAt.getTime() !== signal.updatedAt.getTime() ||
            currentSignal.evidenceDigest !== signal.evidenceDigest ||
            !same(await npReadAgentIncidentSignalEvidenceV1(currentSignal), canonical) ||
            escalationDigest(currentEntry) !== escalationDigest(entry)
          )
            blocked();
          await current(input, checkpoint);
          if (!same(resolved, await policy(input, checkpoint))) blocked();
          const durationSeconds = Math.min(
            deployment.limits.restrictionSeconds,
            resolved.automation.guardianRestrictionTtlSeconds,
            Math.floor((Date.parse(deployment.expiresAt) - now.getTime()) / 1000),
          );
          if (durationSeconds < 60) blocked();
          const { kind: _kind, ...bucket } = incident.primarySubject;
          const proof = freeze(
            npRequireAgentAutomaticGuardianLimitAuthorizationV1({
              schemaVersion: "np.agent-automatic-guardian-limit-authorization.v1",
              policyId: deployment.policyId,
              policyVersion: deployment.policyVersion,
              deploymentDigest,
              policyDigest: npDigestAgentAutomaticGuardianLimitEvidenceV1(
                "np.agent-automatic-guardian-limit-policy.v1",
                resolved,
              ),
              siteId: input.siteId,
              principalId: input.principalId,
              ruleKind: deployment.rule.kind,
              incidentId: incident.id,
              incidentVersion: incident.versionNumber,
              incidentFingerprint: incident.fingerprint,
              incidentUpdatedAt: incident.updatedAt,
              incidentSeverity: incident.severity,
              signalId,
              detectorId: signal.detectorId,
              detectorVersion: 1,
              signalEvidenceDigest: signal.evidenceDigest,
              sourceEventIds,
              sourceFactsDigest: npDigestAgentAutomaticGuardianLimitEvidenceV1(
                "np.agent-automatic-guardian-limit-source.v1",
                events.sort((a, b) => {
                  const left = serializeAgentCanonicalJson(a),
                    right = serializeAgentCanonicalJson(b);
                  return left < right ? -1 : left > right ? 1 : 0;
                }),
              ),
              sourceWindow: canonical.window,
              sourceBaselineSeverity: "medium",
              observedCount: 5,
              countBasis: "at-least",
              staffEscalation: {
                timelineEntryId: entry.id,
                transitionVersion,
                fromSeverity: change.fromSeverity,
                toSeverity: change.toSeverity,
                createdAt: entry.createdAt.toISOString(),
                evidenceDigest: escalationDigest(entry),
              },
              subject: { kind: "opaque_actor_bucket", ...bucket },
              actionScopes: [scope],
              authorizedAt: now.toISOString(),
              expiresAt: new Date(now.getTime() + durationSeconds * 1000).toISOString(),
            }),
          );
          checkpoint();
          authorizations.add(proof);
          return proof;
        });
      } catch {
        return blocked();
      }
    },
  };
  authorities.add(authority);
  return Object.freeze(authority);
}
