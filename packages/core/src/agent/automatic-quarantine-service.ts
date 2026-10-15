import type { NpAgentModerationServiceV1 } from "./moderation-service.js";
import type { NpAgentCapabilityAuthenticationV1 } from "./capability-admission.js";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  npAgentAutomaticQuarantineQualificationV1,
  type NpAgentAutomaticQuarantineDeploymentV1,
  type NpAgentAutomaticQuarantineEvidenceV1,
} from "../agent-contract/automatic-quarantine-contract.js";
import type { NpAgentModeratorFactV1 } from "../agent-contract/moderator-contract.js";
import type { NpAuthUser } from "../config/types.js";
import type { getDb } from "../db/runtime.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentSignals,
  npAgentIncidentSignals,
} from "../db/schema/agent.js";
import type { NpCommunityContentTargetV1 } from "../community/content-containment.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "./incident-service.js";
import { npReadAgentModeratorContentEvidenceFactV1 } from "./moderator-content-evidence.js";

type Db = ReturnType<typeof getDb>;
const authorities = new WeakSet<object>();
const DIGEST = /^cj1:sha256:[A-Za-z0-9_-]{43}$/u;
export const npDigestAgentAutomaticQuarantineEvidenceV1 = (purpose: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256")
    .update(purpose + "\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
const blocked = () =>
  new NpAgentGatewayError(
    "AUTOMATIC_QUARANTINE_BLOCKED",
    409,
    "Automatic quarantine is not currently authorized.",
  );
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function validate(
  input: NpAgentAutomaticQuarantineDeploymentV1,
): NpAgentAutomaticQuarantineDeploymentV1 {
  try {
    // Canonical serialization rejects accessors, exotic objects, cycles and non-JSON input.
    const body = serializeAgentCanonicalJson(input);
    if (Buffer.byteLength(body, "utf8") > 32768) throw blocked();
    const value: NpAgentAutomaticQuarantineDeploymentV1 = JSON.parse(body);
    const inspection = { seen: new WeakSet<object>() };
    const check = (object: unknown, path: string, keys: string[]) =>
      canonicalBodyRecord(object, path, keys, keys, inspection);
    check(value, "automatic.deployment", [
      "schemaVersion",
      "policyId",
      "policyVersion",
      "siteId",
      "locale",
      "principalIds",
      "collectionSlugs",
      "rule",
      "limits",
      "qualification",
      "issuedAt",
      "expiresAt",
    ]);
    check(value.rule, "automatic.rule", [
      "kind",
      "domainHash",
      "minimumItems",
      "minimumIndependentAccounts",
      "maximumEvidenceAgeSeconds",
    ]);
    check(value.limits, "automatic.limits", [
      "containmentSeconds",
      "actionsPerHour",
      "activeContainments",
    ]);
    check(value.qualification, "automatic.qualification", [
      "source",
      "policyVersion",
      "locale",
      "reviewArtifactDigest",
      "reviewedPredictedPositives",
      "reviewedTruePositives",
      "reviewedLegitimateHardNegatives",
      "shadowArtifactDigest",
      "shadowStartedAt",
      "shadowEndedAt",
      "compensationTestArtifactDigest",
    ]);
    if (
      !Array.isArray(value.principalIds) ||
      !Array.isArray(value.collectionSlugs) ||
      value.principalIds.some((id) => typeof id !== "string") ||
      value.collectionSlugs.some((slug) => typeof slug !== "string")
    )
      throw blocked();
    canonicalBodySiteId(value.siteId, "automatic.siteId");
    for (const id of value.principalIds) canonicalBodyUuid(id, "automatic.principalId");
    for (const timestamp of [
      value.issuedAt,
      value.expiresAt,
      value.qualification.shadowStartedAt,
      value.qualification.shadowEndedAt,
    ])
      canonicalBodyUtc(timestamp, "automatic.timestamp");
    const bounded = (n: number, min: number, max: number) =>
      Number.isSafeInteger(n) && n >= min && n <= max;
    if (
      value.schemaVersion !== "np.agent-automatic-quarantine-deployment.v1" ||
      !/^[a-z][a-z0-9._-]{0,95}$/u.test(value.policyId) ||
      !bounded(value.policyVersion, 1, 2147483647) ||
      !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u.test(value.locale) ||
      value.principalIds.length < 1 ||
      value.principalIds.length > 100 ||
      new Set(value.principalIds).size !== value.principalIds.length ||
      value.collectionSlugs.length < 1 ||
      value.collectionSlugs.length > 100 ||
      value.collectionSlugs.some((slug) => !/^[a-z][a-z0-9_-]{0,63}$/u.test(slug)) ||
      new Set(value.collectionSlugs).size !== value.collectionSlugs.length ||
      value.rule.kind !== "reviewed-blocked-domain.v1" ||
      !/^[a-f0-9]{64}$/u.test(value.rule.domainHash) ||
      !bounded(value.rule.minimumItems, 2, 100) ||
      !bounded(value.rule.minimumIndependentAccounts, 2, value.rule.minimumItems) ||
      !bounded(value.rule.maximumEvidenceAgeSeconds, 600, 86400) ||
      !bounded(value.limits.containmentSeconds, 60, 86400) ||
      !bounded(value.limits.actionsPerHour, 1, 100) ||
      !bounded(value.limits.activeContainments, 1, 1000) ||
      [
        value.qualification.reviewArtifactDigest,
        value.qualification.shadowArtifactDigest,
        value.qualification.compensationTestArtifactDigest,
      ].some((digest) => !DIGEST.test(digest)) ||
      Date.parse(value.qualification.shadowEndedAt) > Date.parse(value.issuedAt) ||
      Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
      Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 30 * 86400000
    )
      throw blocked();
    return freeze(value);
  } catch {
    throw blocked();
  }
}
export interface NpAgentAutomaticQuarantineAuthorityV1 {
  readonly deployment: Readonly<NpAgentAutomaticQuarantineDeploymentV1>;
  readonly deploymentDigest: string;
  assertCurrent(input: {
    db: Db;
    siteId: string;
    principalId: string;
    now: Date;
    purpose: "quarantine" | "compensate";
  }): Promise<void>;
  authorize(input: {
    db: Db;
    siteId: string;
    principalId: string;
    user: NpAuthUser;
    now: Date;
    incidentId: string;
    signalId: string;
    target: NpCommunityContentTargetV1;
    expectedVersionDigest: string;
  }): Promise<NpAgentAutomaticQuarantineEvidenceV1>;
}
export function npIsAgentAutomaticQuarantineAuthorityV1(
  value: unknown,
): value is NpAgentAutomaticQuarantineAuthorityV1 {
  return typeof value === "object" && value !== null && authorities.has(value);
}
/** Host-only installation. JSON qualification alone is diagnostic and never grants execution authority. */
export function createAgentAutomaticQuarantineAuthorityV1(options: {
  deployment: NpAgentAutomaticQuarantineDeploymentV1;
  /** Verify the exact immutable artifact against a trusted deployment approval/revocation owner.
   * For purpose=compensate, true also attests the host's durable expiry processor is registered/ready.
   * Compensation can remain allowed after quarantine revocation/expiry. No public/model caller supplies this callback. */
  verifyDeployment: (input: {
    db: Db;
    deployment: Readonly<NpAgentAutomaticQuarantineDeploymentV1>;
    deploymentDigest: string;
    purpose: "quarantine" | "compensate";
    now: Date;
  }) => Promise<boolean>;
  /** Read authoritative target locale; report/model prose is not a locale source. */
  resolveLocale: (input: {
    db: Db;
    siteId: string;
    target: NpCommunityContentTargetV1;
    user: NpAuthUser;
  }) => Promise<string | null>;
}): NpAgentAutomaticQuarantineAuthorityV1 {
  const deployment = validate(options.deployment);
  if (typeof options.verifyDeployment !== "function" || typeof options.resolveLocale !== "function")
    throw blocked();
  const deploymentDigest = npDigestAgentAutomaticQuarantineEvidenceV1(
    "np.agent-automatic-quarantine-deployment.v1",
    deployment,
  );
  const authority: NpAgentAutomaticQuarantineAuthorityV1 = {
    deployment,
    deploymentDigest,
    async assertCurrent(input) {
      if (
        input.siteId !== deployment.siteId ||
        !deployment.principalIds.includes(input.principalId) ||
        (input.purpose === "quarantine" &&
          (!npAgentAutomaticQuarantineQualificationV1(deployment).qualified ||
            input.now.getTime() < Date.parse(deployment.issuedAt) ||
            input.now.getTime() >= Date.parse(deployment.expiresAt))) ||
        (await options.verifyDeployment({
          db: input.db,
          deployment,
          deploymentDigest,
          purpose: input.purpose,
          now: input.now,
        })) !== true
      )
        throw blocked();
    },
    async authorize(input) {
      await authority.assertCurrent({ ...input, purpose: "quarantine" });
      canonicalBodyUuid(input.incidentId, "automatic.incidentId");
      canonicalBodyUuid(input.signalId, "automatic.signalId");
      if (
        !deployment.collectionSlugs.includes(input.target.collection) ||
        (await options.resolveLocale(input)) !== deployment.locale
      )
        throw blocked();
      const [incident] = await input.db
        .select()
        .from(npAgentIncidents)
        .where(
          and(eq(npAgentIncidents.siteId, input.siteId), eq(npAgentIncidents.id, input.incidentId)),
        )
        .limit(1);
      const [signal] = await input.db
        .select()
        .from(npAgentSignals)
        .where(and(eq(npAgentSignals.siteId, input.siteId), eq(npAgentSignals.id, input.signalId)))
        .limit(1);
      if (
        !incident ||
        incident.category !== "spam" ||
        !["open", "investigating"].includes(incident.status) ||
        !signal ||
        signal.incidentId !== incident.id ||
        signal.status !== "attached" ||
        signal.fingerprint !== incident.fingerprint
      )
        throw blocked();
      const canonical = await npReadAgentIncidentSignalEvidenceV1(signal);
      if (
        canonical.category !== "spam" ||
        canonical.subject !== null ||
        canonical.detectorId !== "moderator.repeated-link-spam" ||
        canonical.detectorVersion !== 1 ||
        canonical.evidence.length < 1 ||
        canonical.evidence.length > 100 ||
        canonical.evidence.some((entry) => entry.kind !== "event") ||
        Date.parse(canonical.window.endedAt) >= input.now.getTime() ||
        input.now.getTime() - Date.parse(canonical.window.startedAt) >
          deployment.rule.maximumEvidenceAgeSeconds * 1000
      )
        throw blocked();
      const sourceEventIds = [
        ...new Set(
          canonical.evidence.flatMap((entry) => (entry.kind === "event" ? [entry.eventId] : [])),
        ),
      ].sort();
      const sources = await input.db
        .select()
        .from(npAgentEvents)
        .where(
          and(eq(npAgentEvents.siteId, input.siteId), inArray(npAgentEvents.id, sourceEventIds)),
        )
        .orderBy(asc(npAgentEvents.id));
      const facts: NpAgentModeratorFactV1[] = [];
      for (const source of sources) {
        const fact = await npReadAgentModeratorContentEvidenceFactV1(input.db, source, input.user);
        if (!fact) continue;
        if (
          !canonical.evidence.some(
            (ref) =>
              serializeAgentCanonicalJson(ref) === serializeAgentCanonicalJson(fact.evidence),
          )
        )
          throw blocked();
        facts.push(fact);
      }
      // Match the source owners' content-before-Incident lock order. Sources above hold
      // exact content locks; only now lock/recheck the parent and Signal snapshot.
      const [currentIncident] = await input.db
        .select()
        .from(npAgentIncidents)
        .where(and(eq(npAgentIncidents.siteId, input.siteId), eq(npAgentIncidents.id, incident.id)))
        .for("update")
        .limit(1);
      const [currentSignal] = await input.db
        .select()
        .from(npAgentSignals)
        .where(and(eq(npAgentSignals.siteId, input.siteId), eq(npAgentSignals.id, signal.id)))
        .for("update")
        .limit(1);
      const [link] = await input.db
        .select({ signalId: npAgentIncidentSignals.signalId })
        .from(npAgentIncidentSignals)
        .where(
          and(
            eq(npAgentIncidentSignals.siteId, input.siteId),
            eq(npAgentIncidentSignals.incidentId, incident.id),
            eq(npAgentIncidentSignals.signalId, signal.id),
          ),
        )
        .limit(1);
      if (
        !link ||
        !currentIncident ||
        !currentSignal ||
        currentIncident.updatedAt.getTime() !== incident.updatedAt.getTime() ||
        currentIncident.status !== incident.status ||
        currentIncident.category !== incident.category ||
        currentIncident.fingerprint !== incident.fingerprint ||
        currentSignal.updatedAt.getTime() !== signal.updatedAt.getTime() ||
        currentSignal.status !== signal.status ||
        currentSignal.incidentId !== incident.id ||
        currentSignal.evidenceDigest !== signal.evidenceDigest ||
        serializeAgentCanonicalJson(await npReadAgentIncidentSignalEvidenceV1(currentSignal)) !==
          serializeAgentCanonicalJson(canonical)
      )
        throw blocked();
      // This independent reviewed rule ignores advisory scores and all model output.
      const matching = facts.filter(
        (fact) =>
          fact.memberId !== null &&
          deployment.collectionSlugs.includes(fact.subject.collection) &&
          fact.domainHashes.includes(deployment.rule.domainHash),
      );
      const matched: NpAgentModeratorFactV1[] = [];
      for (const fact of matching) {
        const target = {
          kind: fact.subject.kind,
          collection: fact.subject.collection,
          id: fact.subject.kind === "comment" ? fact.subject.commentId : fact.subject.documentId,
        };
        if (
          (await options.resolveLocale({
            db: input.db,
            siteId: input.siteId,
            target,
            user: input.user,
          })) === deployment.locale
        )
          matched.push(fact);
      }
      const targetKey = (fact: NpAgentModeratorFactV1) =>
        `${fact.subject.kind}:${fact.subject.collection}:${fact.subject.kind === "comment" ? fact.subject.commentId : fact.subject.documentId}`;
      const itemCount = new Set(matched.map(targetKey)).size;
      const independentAccountCount = new Set(matched.map((fact) => fact.memberId)).size;
      const currentTarget = matched.find(
        (fact) =>
          targetKey(fact) ===
            `${input.target.kind}:${input.target.collection}:${input.target.id}` &&
          fact.targetVersionDigest === input.expectedVersionDigest,
      );
      if (
        itemCount < deployment.rule.minimumItems ||
        independentAccountCount < deployment.rule.minimumIndependentAccounts ||
        !currentTarget
      )
        throw blocked();
      return freeze({
        schemaVersion: "np.agent-automatic-quarantine-authorization.v1",
        policyId: deployment.policyId,
        policyVersion: deployment.policyVersion,
        deploymentDigest,
        locale: deployment.locale,
        incidentId: incident.id,
        signalId: signal.id,
        signalEvidenceDigest: signal.evidenceDigest,
        sourceEventIds,
        unavailableSourceEventIds: sourceEventIds.filter(
          (id) =>
            !facts.some((fact) => fact.evidence.kind === "event" && fact.evidence.eventId === id),
        ),
        sourceFactsDigest: npDigestAgentAutomaticQuarantineEvidenceV1(
          "np.agent-automatic-quarantine-source.v1",
          [...facts].sort((a, b) =>
            serializeAgentCanonicalJson(a).localeCompare(serializeAgentCanonicalJson(b)),
          ),
        ),
        itemCount,
        independentAccountCount,
        authorizedAt: input.now.toISOString(),
        expiresAt: new Date(
          input.now.getTime() + deployment.limits.containmentSeconds * 1000,
        ).toISOString(),
      });
    },
  };
  authorities.add(authority);
  return Object.freeze(authority);
}

/** Explicit registration adapter for existing host maintenance jobs. No job or worker is installed. */
export function createAgentAutomaticQuarantineExpiryProcessorV1(options: {
  moderation: Pick<NpAgentModerationServiceV1, "automatic">;
  resolveAuthentication: (input: { siteId: string }) => Promise<NpAgentCapabilityAuthenticationV1>;
}) {
  const parse = (input: unknown) => {
    try {
      const body = canonicalBodyRecord(
        input,
        "automatic.expiryJob",
        ["siteId", "limit", "cursor"],
        ["siteId"],
        { seen: new WeakSet<object>() },
      );
      const siteId = canonicalBodySiteId(body.siteId, "automatic.expiryJob.siteId");
      const limit = body.limit === undefined ? 20 : body.limit;
      const cursor =
        body.cursor == null ? null : canonicalBodyUuid(body.cursor, "automatic.expiryJob.cursor");
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw blocked();
      return { siteId, limit, cursor };
    } catch {
      throw blocked();
    }
  };
  return Object.freeze({
    resolveSiteId: (input: unknown) => parse(input).siteId,
    async process(input: unknown) {
      const data = parse(input);
      const authentication = await options.resolveAuthentication({ siteId: data.siteId });
      if (authentication.principal.siteId !== data.siteId) throw blocked();
      return options.moderation.automatic.processExpired({ ...data, authentication });
    },
  });
}
