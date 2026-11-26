import { npAgentGuardianRuntimeDetectorIdsV1 } from "../agent-contract/guardian-runtime-contract.js";
import type { NpAgentGuardianRuntimeObservationServiceV1 } from "./guardian-runtime-observation.js";
import {
  npDigestAgentGuardianAssessmentObservationV1,
  npRequireAgentGuardianAssessmentSourceProofV1,
} from "./guardian-assessment-proof.js";
export {
  npDigestAgentGuardianAssessmentObservationV1,
  npDigestAgentGuardianAssessmentSourcesV1,
  npRequireAgentGuardianAssessmentSourceProofV1,
} from "./guardian-assessment-proof.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { canonicalBodyUtc } from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentGuardianAssessmentEvidenceV1,
  npRequireAgentGuardianAssessmentFactV1,
  NP_AGENT_GUARDIAN_ASSESSMENT_EVIDENCE_MAX_BYTES_V1,
  npGuardianAssessmentCategoriesV1,
  type NpAgentGuardianAssessmentEvidenceV1,
  type NpAgentGuardianAssessmentFactV1,
} from "../agent-contract/guardian-assessment-contract.js";
import { npAgentProviderCalls, npAgentSignals } from "../db/schema/agent.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import {
  npAssertAgentGuardianAssessmentContextV1,
  npAgentGuardianAssessmentIncidentContextV1,
} from "./guardian-assessment-context.js";
import { npReadAgentGuardianAssessmentEligibilityV1 } from "./guardian-assessment-budget.js";
import {
  npIsAgentGuardianAuthenticatedRequestSourceV1,
  npReadAgentGuardianIncidentEvidenceV1,
  type NpAgentGuardianAuthenticatedRequestSourceV1,
} from "./guardian-observation-service.js";
import { npReadGuardianSessionIncidentEvidenceV1 } from "./guardian-session-observation.js";
import type { NpAgentGuardianSecurityObservationServiceV1 } from "./guardian-security-observation.js";
import { npReadAgentIncidentCanonicalSourcesV1 } from "./incident-source-evidence.js";
import type { NpAgentIncidentServiceV1 } from "./incident-service.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";
import { npRequireAgentRecipeSettingsV1 } from "../agent-contract/runtime-contract.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import type { NpAgentGuardianAssessmentRecipeIdV1 } from "../agent-contract/guardian-assessment-recipe-contract.js";

const issued = new WeakSet<object>();
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_ASSESSMENT_UNAVAILABLE",
    409,
    "Guardian assessment evidence is unavailable.",
  );
}
export interface NpAgentGuardianAssessmentSourceResultV1 {
  metadata: NpAgentGuardianAssessmentEvidenceV1;
  observations: { id: string; digest: string; observedAt: string; text: string }[];
}
export interface NpAgentGuardianAssessmentSourceV1 {
  read(
    context: NpAgentRuntimeRunContextV1,
    observedAt?: string,
  ): Promise<NpAgentGuardianAssessmentSourceResultV1>;
}
export function npIsAgentGuardianAssessmentSourceV1(
  value: unknown,
): value is NpAgentGuardianAssessmentSourceV1 {
  return typeof value === "object" && value !== null && issued.has(value);
}
/** Only verified current Guardian sources; no raw Event payload, identity, policy text or executable target is returned. */
export function createAgentGuardianAssessmentSourceV1(options: {
  incidents: NpAgentIncidentServiceV1;
  securityObservations?: Pick<NpAgentGuardianSecurityObservationServiceV1, "evidence">;
  runtimeObservations?: Pick<NpAgentGuardianRuntimeObservationServiceV1, "assessmentEvidence">;
  requestObservations?: NpAgentGuardianAuthenticatedRequestSourceV1;
}): NpAgentGuardianAssessmentSourceV1 {
  async function permitted(
    context: NpAgentRuntimeRunContextV1,
    incident: NpAgentIncidentV1,
    recipeId: NpAgentGuardianAssessmentRecipeIdV1,
  ): Promise<boolean> {
    const settings = context.evidence.definition.settings.filter((s) => s.recipeId === recipeId);
    if (settings.length !== 1) unavailable();
    const selected = npRequireAgentRecipeSettingsV1(settings[0]);
    const sources = await npReadAgentIncidentCanonicalSourcesV1({
      db: context.db,
      siteId: context.siteId,
      incident,
    });
    if (recipeId === "guardian.credential-stuffing") {
      if (selected.recipeId !== recipeId) unavailable();
      // A network rate decision does not establish a failed credential or an account.
      // Session correlation remains readable through its existing owner; until its
      // success source has an authenticated receipt it cannot qualify this advisory.
      if (
        !sources.signals.every((s) => s.detectorId === "guardian.login-failures") ||
        !npIsAgentGuardianAuthenticatedRequestSourceV1(options.requestObservations)
      )
        return false;
      const requestSource = options.requestObservations;
      for (const signalId of incident.signalIds)
        if (
          !(await requestSource.verifySignal({
            db: context.db,
            siteId: context.siteId,
            signalId,
          }))
        )
          return false;
      const ids = [
        ...new Set(
          sources.signals.flatMap((s) =>
            s.evidence.flatMap((ref) => (ref.kind === "event" ? [ref.eventId] : [])),
          ),
        ),
      ].sort();
      for (const eventId of ids) {
        const proof = await requestSource.verifyEvent({
          db: context.db,
          siteId: context.siteId,
          eventId,
        });
        const references = sources.signals
          .flatMap((s) => s.evidence)
          .filter((ref) => ref.kind === "event" && ref.eventId === eventId);
        const digest = Buffer.from(
          proof.sourceDigest.slice("cj1:sha256:".length),
          "base64url",
        ).toString("hex");
        if (
          proof.source !== "requests" ||
          references.some(
            (ref) =>
              ref.kind !== "event" || ref.observedAt !== proof.observedAt || ref.digest !== digest,
          )
        )
          return false;
      }
      const proofs = await npReadAgentGuardianIncidentEvidenceV1({
        db: context.db,
        siteId: context.siteId,
        incident,
      });
      if (!proofs.every((p) => p.audience !== null && selected.audiences.includes(p.audience)))
        return false;
      // These private canonical bucket commitments never enter model evidence.
      // Require each selected rule cohort to meet the configured settings; counts
      // from unrelated networks/windows cannot be added to authorize an advisory.
      const eventsById = new Map(ids.map((id, index) => [id, sources.events[index]]));
      return sources.signals.every((signal) => {
        const events = signal.evidence.flatMap((ref) =>
          ref.kind === "event" ? [eventsById.get(ref.eventId)] : [],
        );
        if (
          events.some(
            (event) =>
              !event ||
              event.kind !== "auth.login.failed" ||
              event.subject?.kind !== "actor-bucket" ||
              event.subject.purpose !== "login-identifier",
          )
        )
          return false;
        const buckets = new Set(events.map((event) => serializeAgentCanonicalJson(event!.subject)));
        const times = events.map((event) => Date.parse(event!.occurredAt));
        return (
          events.length >= selected.minimumFailures &&
          buckets.size >= selected.minimumDistinctAccountBuckets &&
          Math.max(...times) - Math.min(...times) <= selected.windowSeconds * 1000
        );
      });
    }
    if (
      sources.signals.every((s) =>
        npAgentGuardianRuntimeDetectorIdsV1.some((id) => id === s.detectorId),
      )
    ) {
      if (!options.runtimeObservations) unavailable();
      if (selected.recipeId !== "guardian.agent-abuse") return false;
      const proofs = await options.runtimeObservations.assessmentEvidence({
        db: context.db,
        siteId: context.siteId,
        incident,
      });
      return proofs.every((proof) => {
        if (
          Date.parse(proof.window.endedAt) - Date.parse(proof.window.startedAt) >
          selected.windowSeconds * 1000
        )
          return false;
        switch (proof.detectorId) {
          case "guardian.repeated-proposals":
            return proof.observedCount >= selected.repeatedProposalThreshold;
          case "guardian.denied-scopes":
            return proof.observedCount >= selected.deniedScopeThreshold;
          case "guardian.action-velocity":
            return proof.observedCount >= selected.actionThreshold;
          case "guardian.spend-velocity":
            return (
              proof.accounting !== null &&
              proof.accounting.knownCostMicros >= selected.costVelocityMicros
            );
        }
      });
    }
    if (
      !sources.signals.every((s) =>
        ["guardian.authority-escalated", "guardian.policy-activated"].includes(s.detectorId),
      )
    )
      return false;
    if (!options.securityObservations) unavailable();
    await options.securityObservations.evidence({
      db: context.db,
      siteId: context.siteId,
      incident,
    });
    return true;
  }
  const service: NpAgentGuardianAssessmentSourceV1 = Object.freeze({
    async read(context: NpAgentRuntimeRunContextV1, observedAt = context.now.toISOString()) {
      npAssertAgentGuardianAssessmentContextV1(context);
      const readContext = npAgentGuardianAssessmentIncidentContextV1(context);
      const recipeId = context.run.recipeId;
      if (recipeId !== "guardian.agent-abuse" && recipeId !== "guardian.credential-stuffing")
        unavailable();
      const metadata: NpAgentGuardianAssessmentEvidenceV1 = {
        schemaVersion: "np.agent-guardian-assessment-evidence.v1",
        recipeId,
        observedAt: canonicalBodyUtc(observedAt, "guardian.assessment.observedAt"),
        incident: null,
        truncated: false,
        sources: [],
      };
      const calls = await context.db
        .select()
        .from(npAgentProviderCalls)
        .where(
          and(
            eq(npAgentProviderCalls.siteId, context.siteId),
            eq(npAgentProviderCalls.runId, context.run.id),
          ),
        )
        .orderBy(asc(npAgentProviderCalls.sequence))
        .limit(1001);
      if (calls.length > 1000) unavailable();
      let pinned: NpAgentGuardianAssessmentEvidenceV1 | undefined;
      for (const call of calls) {
        const d = call.requestRedacted;
        if (
          !d ||
          Object.keys(d).length !== 3 ||
          d.schemaVersion !== "np.agent-guardian-assessment-diagnostic.v1" ||
          d.requestDigest !== call.requestDigest ||
          call.recipeFingerprint !== context.run.recipeFingerprint ||
          call.instructionDigest !== context.run.instructionDigest
        )
          unavailable();
        const retained = npRequireAgentGuardianAssessmentSourceProofV1(call, d.assessmentEvidence);
        if (retained.recipeId !== recipeId || (pinned && !same(pinned, retained))) unavailable();
        pinned = retained;
      }
      if (pinned) metadata.observedAt = pinned.observedAt;
      let incident: Awaited<ReturnType<typeof options.incidents.get>>["incident"] | undefined;
      if (pinned) {
        if (!pinned.incident) return { metadata: pinned, observations: [] };
        incident = (await options.incidents.get({ incidentId: pinned.incident.id }, readContext))
          .incident;
        if (
          incident.versionNumber !== pinned.incident.versionNumber ||
          incident.fingerprint !== pinned.incident.fingerprint ||
          !(await permitted(context, incident, recipeId))
        )
          unavailable();
      } else {
        const eligible = await npReadAgentGuardianAssessmentEligibilityV1(context);
        let cursor: string | null = null,
          blocked = false;
        for (let scanned = 0; scanned < 25; scanned++) {
          const page = await options.incidents.list(
            {
              statuses: ["open", "investigating"],
              categories: npGuardianAssessmentCategoriesV1(recipeId),
              severities: [],
              updatedAfter: null,
              limit: 1,
              cursor,
            },
            readContext,
          );
          const candidate = page.items[0];
          const supported = candidate && (await permitted(context, candidate, recipeId));
          if (candidate && supported && eligible(candidate.fingerprint)) {
            incident = candidate;
            break;
          }
          if (supported) blocked = true;
          cursor = page.nextCursor;
          if (cursor === null) break;
          if (scanned === 24) metadata.truncated = true;
        }
        if (!incident && blocked)
          throw new NpAgentGatewayError(
            "RUNTIME_BUDGET_BLOCKED",
            409,
            "Guardian analysis budget is exhausted.",
          );
      }
      if (!incident)
        return { metadata: npRequireAgentGuardianAssessmentEvidenceV1(metadata), observations: [] };
      if (
        incident.siteId !== context.siteId ||
        !["open", "investigating"].includes(incident.status) ||
        !npGuardianAssessmentCategoriesV1(recipeId).includes(incident.category)
      )
        unavailable();
      await npReadAgentIncidentCanonicalSourcesV1({
        db: context.db,
        siteId: context.siteId,
        incident,
      });
      const signals = await context.db
        .select()
        .from(npAgentSignals)
        .where(
          and(
            eq(npAgentSignals.siteId, context.siteId),
            inArray(npAgentSignals.id, incident.signalIds),
          ),
        )
        .orderBy(asc(npAgentSignals.id));
      if (
        !signals.length ||
        signals.length !== incident.signalIds.length ||
        signals.some(
          (s) =>
            s.incidentId !== incident.id ||
            s.status !== "attached" ||
            s.fingerprint !== incident.fingerprint,
        )
      )
        unavailable();
      const facts = new Map<string, NpAgentGuardianAssessmentFactV1>();
      if (
        recipeId === "guardian.credential-stuffing" &&
        signals.every((s) =>
          ["guardian.login-failures", "guardian.rate-limits"].includes(s.detectorId),
        )
      ) {
        for (const proof of await npReadAgentGuardianIncidentEvidenceV1({
          db: context.db,
          siteId: context.siteId,
          incident,
        }))
          facts.set(
            proof.signalId,
            npRequireAgentGuardianAssessmentFactV1({
              detectorId: proof.detectorId,
              detectorVersion: 1,
              category:
                proof.detectorId === "guardian.login-failures" ? "authentication" : "traffic",
              severity: "medium",
              window: proof.window,
              observedCount: proof.observedCount,
              audience: proof.audience,
              routeFamily: proof.routeFamily,
              impact: "site",
            }),
          );
      } else if (
        recipeId === "guardian.credential-stuffing" &&
        signals.length === 1 &&
        signals[0].detectorId === "guardian.login-after-failures"
      ) {
        const proof = await npReadGuardianSessionIncidentEvidenceV1({
          db: context.db,
          siteId: context.siteId,
          incident,
        });
        facts.set(
          signals[0].id,
          npRequireAgentGuardianAssessmentFactV1({
            detectorId: "guardian.login-after-failures",
            detectorVersion: 1,
            category: "authentication",
            severity: "high",
            window: {
              startedAt: signals[0].windowStartedAt.toISOString(),
              endedAt: signals[0].windowEndedAt.toISOString(),
            },
            observedCount: 6,
            audience: proof.actorKind,
            routeFamily: null,
            impact: "site",
          }),
        );
      } else if (
        recipeId === "guardian.agent-abuse" &&
        signals.every((s) =>
          npAgentGuardianRuntimeDetectorIdsV1.some((id) => id === s.detectorId),
        ) &&
        options.runtimeObservations
      ) {
        for (const proof of await options.runtimeObservations.assessmentEvidence({
          db: context.db,
          siteId: context.siteId,
          incident,
        })) {
          facts.set(
            proof.signalId,
            npRequireAgentGuardianAssessmentFactV1({
              detectorId: proof.detectorId,
              detectorVersion: 1,
              category: "agent-abuse",
              severity: "medium",
              window: proof.window,
              observedCount: proof.observedCount,
              audience: null,
              routeFamily: null,
              impact: "site",
              accounting: proof.accounting,
            }),
          );
        }
      } else if (
        recipeId === "guardian.agent-abuse" &&
        signals.every((s) =>
          ["guardian.authority-escalated", "guardian.policy-activated"].includes(s.detectorId),
        ) &&
        options.securityObservations
      ) {
        for (const proof of await options.securityObservations.evidence({
          db: context.db,
          siteId: context.siteId,
          incident,
        })) {
          const signal = signals.find((s) => s.id === proof.signalId);
          if (!signal) unavailable();
          facts.set(
            proof.signalId,
            npRequireAgentGuardianAssessmentFactV1({
              detectorId: proof.detectorId,
              detectorVersion: 1,
              category:
                proof.detectorId === "guardian.policy-activated" ? "agent-abuse" : "authorization",
              severity: proof.impact.scope === "deployment" ? "high" : "medium",
              window: {
                startedAt: signal.windowStartedAt.toISOString(),
                endedAt: signal.windowEndedAt.toISOString(),
              },
              observedCount: 1,
              audience: null,
              routeFamily: null,
              impact: proof.impact.scope,
            }),
          );
        }
      } else unavailable();
      if (facts.size !== signals.length) unavailable();
      metadata.incident = {
        id: incident.id,
        versionNumber: incident.versionNumber,
        fingerprint: incident.fingerprint,
      };
      metadata.truncated = signals.length > 20;
      metadata.sources = signals.slice(0, 20).map((signal, index) => {
        const fact = facts.get(signal.id);
        if (!fact || signal.severity !== fact.severity) unavailable();
        const source = { signalId: signal.id, signalDigest: signal.evidenceDigest, fact };
        return {
          id: `guardian-assessment-${index.toString().padStart(3, "0")}`,
          ...source,
          digest: npDigestAgentGuardianAssessmentObservationV1(source),
        };
      });
      while (
        Buffer.byteLength(serializeAgentCanonicalJson(metadata), "utf8") >
        NP_AGENT_GUARDIAN_ASSESSMENT_EVIDENCE_MAX_BYTES_V1
      ) {
        if (!metadata.sources.length) unavailable();
        metadata.sources.pop();
        metadata.truncated = true;
      }
      const result = npRequireAgentGuardianAssessmentEvidenceV1(metadata);
      const current = (await options.incidents.get({ incidentId: incident.id }, readContext))
        .incident;
      if (
        current.versionNumber !== incident.versionNumber ||
        current.fingerprint !== incident.fingerprint
      )
        unavailable();
      if (pinned && !same(result, pinned)) unavailable();
      return {
        metadata: result,
        observations: result.sources.map((s) => ({
          id: s.id,
          digest: s.digest,
          observedAt: s.fact.window.endedAt,
          text: serializeAgentCanonicalJson(s.fact),
        })),
      };
    },
  });
  issued.add(service);
  return service;
}
