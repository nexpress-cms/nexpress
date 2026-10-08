import { and, asc, eq, inArray } from "drizzle-orm";
import { canonicalBodyUtc } from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { NpAgentContractError } from "../agent-contract/contract.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import {
  npRequireAgentModeratorSettingsV1,
  npRequireAgentQuarantineProposalV1,
  type NpAgentModeratorFactV1,
  type NpAgentQuarantineProposalV1,
} from "../agent-contract/moderator-contract.js";
import { npAgentAutonomyAllowsV1 } from "../agent-contract/runtime-policy.js";
import { npAgentEvents, npAgentSignals } from "../db/schema/agent.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { withCurrentSite } from "../sites/context.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import {
  npReadAgentIncidentSignalEvidenceV1,
  type NpAgentIncidentReadContextV1,
  type NpAgentIncidentServiceV1,
} from "./incident-service.js";
import {
  npReadAgentModeratorCommentFactV1,
  npResolveAgentModeratorStaffUserV1,
} from "./moderator-collector.js";
import { npDetectAgentRepeatedLinkSpamV1 } from "./moderator-detector.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";

const RECIPE = "moderator.repeated-link-spam";
const MAXIMUM_INCIDENTS = 10;
const MAXIMUM_SIGNALS = 10;
const MAXIMUM_EVENTS = 100;
const MAXIMUM_CANDIDATES = 10;
const issued = new WeakSet<object>();

export interface NpAgentModeratorRecipeCandidateV1 {
  incidentId: string;
  signalId: string;
  sourceEventIds: string[];
  detector: {
    id: "moderator.repeated-link-spam";
    version: 1;
    advisory: true;
    itemCount: number;
    independentAccountCount: number;
  };
  proposal: NpAgentQuarantineProposalV1;
}
export interface NpAgentModeratorRecipeEvidenceV1 {
  observedAt: string;
  /** Authorized Incidents inspected; never a total that includes hidden rows. */
  scanned: number;
  truncated: boolean;
  candidates: NpAgentModeratorRecipeCandidateV1[];
}
export interface NpAgentModeratorRecipeSourceV1 {
  /** Admission supplies the current transaction and authority. The optional timestamp binds context revalidation. */
  read(
    context: NpAgentRuntimeRunContextV1,
    observedAt?: string,
  ): Promise<NpAgentModeratorRecipeEvidenceV1>;
}
export function npIsAgentModeratorRecipeSourceV1(
  value: unknown,
): value is NpAgentModeratorRecipeSourceV1 {
  return typeof value === "object" && value !== null && issued.has(value);
}
function unavailable(): never {
  throw new NpAgentGatewayError(
    "MODERATOR_SOURCE_UNAVAILABLE",
    409,
    "Moderator evidence is unavailable.",
  );
}

/** Explicit host installation. Reads existing evidence; never observes, collects, writes or starts Runtime. */
export function createAgentModeratorRecipeSourceV1(options: {
  incidents: NpAgentIncidentServiceV1;
}): NpAgentModeratorRecipeSourceV1 {
  if (typeof options.incidents?.list !== "function" || typeof options.incidents?.get !== "function")
    throw new Error("Moderator Incident read owner is required.");
  const service: NpAgentModeratorRecipeSourceV1 = {
    read: (context, observedAt = context.now.toISOString()) =>
      withCurrentSite(context.siteId, async () => {
        const principal = context.evidence.principal;
        const recipe = context.evidence.registry.recipes.find(
          (entry) => entry.id === RECIPE && entry.version === 1,
        );
        const quarantineMode = context.policy.effective.capabilityModes.find(
          (entry) => entry.capabilityId === "moderation.quarantine",
        )?.mode;
        if (
          context.run.siteId !== context.siteId ||
          principal.siteId !== context.siteId ||
          context.run.recipeId !== RECIPE ||
          context.run.recipeVersion !== 1 ||
          context.run.instructionTemplateId !== RECIPE ||
          context.run.instructionTemplateVersion !== 1 ||
          recipe?.instruction?.templateId !== RECIPE ||
          recipe.instruction.templateVersion !== 1 ||
          !recipe.capabilityIds.includes("moderation.quarantine") ||
          principal.authorityKind !== "user" ||
          !context.staffUser ||
          principal.authorityUserId !== context.staffUser.id ||
          !context.evidence.definition.scopes.includes("incident:read") ||
          !context.evidence.definition.scopes.includes("moderation:execute") ||
          !quarantineMode ||
          !npAgentAutonomyAllowsV1(quarantineMode, "request-approval")
        )
          unavailable();
        const settings = npRequireAgentModeratorSettingsV1(
          context.evidence.definition.settings.find((entry) => entry.recipeId === RECIPE),
        );
        const resources = context.policy.effective.resources;
        const result: NpAgentModeratorRecipeEvidenceV1 = {
          observedAt: canonicalBodyUtc(observedAt, "moderator.observedAt"),
          scanned: 0,
          truncated: false,
          candidates: [],
        };
        if (resources.incidentCategories !== null && !resources.incidentCategories.includes("spam"))
          return result;
        const user = await npResolveAgentModeratorStaffUserV1(
          context.db,
          context.siteId,
          context.staffUser.id,
        );
        const readContext: NpAgentIncidentReadContextV1 = {
          siteId: context.siteId,
          principal: {
            kind: "runtime",
            principalId: principal.id,
            siteId: context.siteId,
            authority: { kind: "user", userId: user.id },
            scopes: context.evidence.definition.scopes,
            runId: context.run.id,
          },
          requestedAt: context.now.toISOString(),
          staffUser: user,
          runtimeResources: resources,
          abortSignal: new AbortController().signal,
          transaction: context.db,
        };
        const page = await options.incidents.list(
          {
            statuses: ["open", "investigating"],
            categories: ["spam"],
            severities: [],
            updatedAfter: null,
            limit: MAXIMUM_INCIDENTS,
            cursor: null,
          },
          readContext,
        );
        result.truncated = page.nextCursor !== null || page.items.length > MAXIMUM_INCIDENTS;
        const eventIds = new Set<string>();
        const candidates = new Map<string, NpAgentModeratorRecipeCandidateV1>();
        async function inspect(incident: NpAgentIncidentV1) {
          if (
            incident.siteId !== context.siteId ||
            incident.category !== "spam" ||
            !["open", "investigating"].includes(incident.status) ||
            incident.primarySubject !== null ||
            !incident.signalIds.length
          )
            return [];
          if (incident.signalIds.length > MAXIMUM_SIGNALS) {
            result.truncated = true;
            return [];
          }
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
            serializeAgentCanonicalJson(signals.map((signal) => signal.id)) !==
            serializeAgentCanonicalJson(incident.signalIds)
          )
            return [];
          const found: NpAgentModeratorRecipeCandidateV1[] = [];
          for (const signal of signals) {
            const canonical = await npReadAgentIncidentSignalEvidenceV1(signal);
            if (
              canonical.detectorId !== RECIPE ||
              canonical.detectorVersion !== 1 ||
              canonical.category !== "spam" ||
              canonical.subject !== null ||
              Date.parse(canonical.window.endedAt) >= context.now.getTime() ||
              signal.incidentId !== incident.id ||
              signal.status !== "attached" ||
              signal.fingerprint !== incident.fingerprint ||
              !canonical.evidence.length ||
              canonical.evidence.some((ref) => ref.kind !== "event")
            )
              return [];
            const ids = canonical.evidence.flatMap((ref) =>
              ref.kind === "event" ? [ref.eventId] : [],
            );
            for (const id of ids) eventIds.add(id);
            if (eventIds.size > MAXIMUM_EVENTS) {
              result.truncated = true;
              return [];
            }
            const sources = await context.db
              .select()
              .from(npAgentEvents)
              .where(and(eq(npAgentEvents.siteId, context.siteId), inArray(npAgentEvents.id, ids)))
              .orderBy(asc(npAgentEvents.id));
            if (sources.length !== new Set(ids).size) return [];
            const facts: NpAgentModeratorFactV1[] = [];
            for (const source of sources) {
              const fact = await npReadAgentModeratorCommentFactV1(context.db, source, user);
              if (
                !fact ||
                fact.subject.kind !== "comment" ||
                !settings.collectionSlugs.includes(fact.subject.collection) ||
                (resources.collections !== null &&
                  !resources.collections.includes(fact.subject.collection)) ||
                canonical.evidence.some(
                  (ref) =>
                    ref.kind === "event" &&
                    ref.eventId === source.id &&
                    serializeAgentCanonicalJson(ref) !== serializeAgentCanonicalJson(fact.evidence),
                )
              )
                return [];
              facts.push(fact);
            }
            const detected = await npDetectAgentRepeatedLinkSpamV1({
              siteId: context.siteId,
              windowStartedAt: canonical.window.startedAt,
              settings,
              facts,
            });
            const match = detected.find(
              (candidate) =>
                candidate.fingerprint === signal.fingerprint &&
                candidate.evidenceDigest === signal.evidenceDigest,
            );
            if (!match) return [];
            for (const fact of match.facts) {
              if (fact.subject.kind !== "comment") return [];
              found.push({
                incidentId: incident.id,
                signalId: signal.id,
                sourceEventIds: [...new Set(ids)].sort(),
                detector: {
                  id: RECIPE,
                  version: 1,
                  advisory: true,
                  itemCount: match.facts.length,
                  independentAccountCount: new Set(match.facts.map((entry) => entry.memberId)).size,
                },
                proposal: npRequireAgentQuarantineProposalV1({
                  incidentId: incident.id,
                  target: {
                    kind: "comment",
                    collection: fact.subject.collection,
                    id: fact.subject.commentId,
                  },
                  expectedVersionDigest: fact.targetVersionDigest,
                  reasonCode: "REPEATED_LINK_SPAM",
                }),
              });
            }
          }
          const current = await options.incidents.get({ incidentId: incident.id }, readContext);
          return serializeAgentCanonicalJson(current.incident) ===
            serializeAgentCanonicalJson(incident)
            ? found
            : [];
        }
        for (const incident of page.items.slice(0, MAXIMUM_INCIDENTS)) {
          result.scanned++;
          let found: NpAgentModeratorRecipeCandidateV1[];
          try {
            found = await inspect(incident);
          } catch (error) {
            // Retained evidence is advisory. Missing, unauthorized or malformed sources never become proposals.
            if (
              error instanceof NpAgentContractError ||
              error instanceof NpAgentGatewayError ||
              error instanceof NpForbiddenError ||
              error instanceof NpNotFoundError ||
              error instanceof NpValidationError
            )
              continue;
            throw error;
          }
          for (const candidate of found) {
            const key = serializeAgentCanonicalJson(candidate.proposal.target);
            if (!candidates.has(key)) candidates.set(key, candidate);
          }
          if (eventIds.size > MAXIMUM_EVENTS) break;
        }
        const ordered = [...candidates].sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        );
        if (ordered.length > MAXIMUM_CANDIDATES) result.truncated = true;
        result.candidates = ordered.slice(0, MAXIMUM_CANDIDATES).map(([, candidate]) => candidate);
        await npResolveAgentModeratorStaffUserV1(context.db, context.siteId, user.id);
        return result;
      }),
  };
  issued.add(service);
  return Object.freeze(service);
}
