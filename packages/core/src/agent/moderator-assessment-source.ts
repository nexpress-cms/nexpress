import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  npRequireAgentModeratorAssessmentEvidenceV1,
  type NpAgentModeratorAssessmentEvidenceV1,
} from "../agent-contract/moderator-assessment-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { canonicalBodyUtc } from "../agent-contract/canonical-body-validation.js";
import { npRequireAgentModeratorSettingsV1 } from "../agent-contract/moderator-contract.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
import { npSerializeCollectionDocument } from "../collection-contract/contract.js";
import type { NpTransaction } from "../collections/pipeline.js";
import { npGetPersistedCollectionDocumentById } from "../collections/pipeline.js";
import {
  npInspectCommunityCommentEvidenceV1,
  npInspectCommunityDocumentEvidenceV1,
} from "../community/content-containment.js";
import {
  npAgentEvents,
  npAgentSignals,
  npAgentProviderCalls,
  npAgentIncidentSignals,
} from "../db/schema/agent.js";
import { withCurrentSite } from "../sites/context.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import {
  npReadAgentIncidentSignalEvidenceV1,
  type NpAgentIncidentServiceV1,
} from "./incident-service.js";
import { npReadAgentModeratorContentEvidenceFactV1 } from "./moderator-content-evidence.js";
import { npResolveAgentModeratorStaffUserV1 } from "./moderator-collector.js";
import {
  npIsAgentRuntimeDocumentEvidenceReaderV1,
  type NpAgentRuntimeDocumentEvidenceReaderV1,
} from "./read-capability-executors.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";

import {
  npAssertAgentModeratorAssessmentContextV1,
  npAgentModeratorAssessmentIncidentContextV1,
} from "./moderator-assessment-context.js";
export {
  npAssertAgentModeratorAssessmentContextV1,
  npAgentModeratorAssessmentIncidentContextV1,
} from "./moderator-assessment-context.js";
import { npReadAgentModeratorAssessmentEligibilityV1 } from "./moderator-assessment-budget.js";

const issued = new WeakSet<object>();
export interface NpAgentModeratorAssessmentSourceResultV1 {
  metadata: NpAgentModeratorAssessmentEvidenceV1;
  excerpts: { id: string; digest: string; observedAt: string; text: string }[];
}
export interface NpAgentModeratorAssessmentSourceV1 {
  read(
    context: NpAgentRuntimeRunContextV1,
    observedAt?: string,
  ): Promise<NpAgentModeratorAssessmentSourceResultV1>;
}
export function npIsAgentModeratorAssessmentSourceV1(
  value: unknown,
): value is NpAgentModeratorAssessmentSourceV1 {
  return typeof value === "object" && value !== null && issued.has(value);
}
export function npDigestAgentModeratorAssessmentSourcesV1(
  value: NpAgentModeratorAssessmentEvidenceV1,
): string {
  return digest("source", npRequireAgentModeratorAssessmentEvidenceV1(value));
}
export function npDigestAgentModeratorAssessmentExcerptV1(input: {
  subject: NpAgentModeratorAssessmentEvidenceV1["sources"][number]["subject"];
  currentVersionDigest: string;
  text: string;
}): string {
  return digest("excerpt", input);
}
/** Retained manifest binds safe metadata and excerpt hashes after diagnostic prose is pruned. */
export function npRequireAgentModeratorAssessmentSourceProofV1(
  call: { classificationManifest: NpAgentJsonObject; classificationManifestDigest: string },
  value: NpAgentModeratorAssessmentEvidenceV1,
): NpAgentModeratorAssessmentEvidenceV1 {
  const metadata = npRequireAgentModeratorAssessmentEvidenceV1(value);
  const hash = (purpose: string, entry: unknown) =>
    `cj1:sha256:${createHash("sha256").update(`${purpose}\0`).update(serializeAgentCanonicalJson(entry)).digest("base64url")}`;
  const manifest = call.classificationManifest;
  if (
    Object.keys(manifest).length !== 1 ||
    !Array.isArray(manifest.components) ||
    manifest.components.length > 100 ||
    hash("np.agent-runtime-classification-manifest.v1", manifest) !==
      call.classificationManifestDigest
  )
    unavailable();
  const components = manifest.components.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.kind !== "string"
    )
      return unavailable();
    return { ...entry, id: entry.id, kind: entry.kind };
  });
  if (new Set(components.map((entry) => `${entry.kind}:${entry.id}`)).size !== components.length)
    unavailable();
  const facts = components.filter((entry) => entry.id === "moderator-assessment");
  const valid = (entry: NpAgentJsonObject, kind: string, sourceDigest: string) =>
    entry.kind === kind &&
    entry.sourceDigest === sourceDigest &&
    entry.dataClass === "sensitive-approved" &&
    entry.classifierId === "framework.runtime-context" &&
    entry.classifierVersion === 1;
  if (
    facts.length !== 1 ||
    !valid(facts[0], "server-fact", hash("np.agent-runtime-moderator-assessment.v1", metadata))
  )
    unavailable();
  const excerpts = components.filter((entry) => entry.id.startsWith("moderator-assessment-"));
  if (
    excerpts.length !== metadata.sources.length ||
    metadata.sources.some((source) => {
      const matches = excerpts.filter((entry) => entry.id === source.id);
      return matches.length !== 1 || !valid(matches[0], "content", source.excerptDigest);
    })
  )
    unavailable();
  return metadata;
}
function digest(purpose: string, value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(`np.agent-moderator-assessment.v1\0${purpose}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}
function unavailable(): never {
  throw new NpAgentGatewayError(
    "MODERATOR_ASSESSMENT_UNAVAILABLE",
    409,
    "Moderator assessment evidence is unavailable.",
  );
}
/** Code-owned current evidence only; issuing this facet installs no model or Runtime. */
export function createAgentModeratorAssessmentSourceV1(options: {
  incidents: NpAgentIncidentServiceV1;
  documentEvidence: NpAgentRuntimeDocumentEvidenceReaderV1;
}): NpAgentModeratorAssessmentSourceV1 {
  if (!npIsAgentRuntimeDocumentEvidenceReaderV1(options.documentEvidence))
    throw new Error("Framework document evidence owner is required.");
  const service: NpAgentModeratorAssessmentSourceV1 = {
    read: (context, observedAt = context.now.toISOString()) =>
      withCurrentSite(context.siteId, async () => {
        npAssertAgentModeratorAssessmentContextV1(context);
        const user = await npResolveAgentModeratorStaffUserV1(
          context.db,
          context.siteId,
          context.staffUser!.id,
        );
        const settings = npRequireAgentModeratorSettingsV1(
          context.evidence.definition.settings.find(
            (entry) => entry.recipeId === context.run.recipeId,
          ),
        );
        const readContext = npAgentModeratorAssessmentIncidentContextV1(context);
        const metadata: NpAgentModeratorAssessmentEvidenceV1 = {
          schemaVersion: "np.agent-moderator-assessment-evidence.v1",
          observedAt: canonicalBodyUtc(observedAt, "moderator.assessment.observedAt"),
          incident: null,
          truncated: false,
          sources: [],
        };
        const excerpts: NpAgentModeratorAssessmentSourceResultV1["excerpts"] = [];
        // A retained provider attempt fixes this Run's target. Revalidation,
        // retries and recovery cannot select another Incident after a list reorder.
        const priorCalls = await context.db
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
        if (priorCalls.length > 1000) unavailable();
        let pinned: NpAgentModeratorAssessmentEvidenceV1["incident"] | undefined;
        for (const call of priorCalls) {
          const diagnostic = call.requestRedacted;
          if (
            call.recipeFingerprint !== context.run.recipeFingerprint ||
            call.instructionDigest !== context.run.instructionDigest ||
            !diagnostic ||
            diagnostic.schemaVersion !== "np.agent-moderator-assessment-diagnostic.v1" ||
            diagnostic.requestDigest !== call.requestDigest ||
            Object.keys(diagnostic).length !== 3
          )
            unavailable();
          const retained = npRequireAgentModeratorAssessmentSourceProofV1(
            call,
            npRequireAgentModeratorAssessmentEvidenceV1(diagnostic.assessmentEvidence),
          );
          if (
            pinned !== undefined &&
            serializeAgentCanonicalJson(pinned) !== serializeAgentCanonicalJson(retained.incident)
          )
            unavailable();
          pinned = retained.incident;
        }
        let incident: Awaited<ReturnType<typeof options.incidents.get>>["incident"] | undefined;
        if (pinned !== undefined) {
          if (pinned === null) return { metadata, excerpts };
          incident = (await options.incidents.get({ incidentId: pinned.id }, readContext)).incident;
          if (
            incident.versionNumber !== pinned.versionNumber ||
            incident.fingerprint !== pinned.fingerprint
          )
            unavailable();
        } else {
          const eligible = await npReadAgentModeratorAssessmentEligibilityV1(context);
          let blocked = false;
          const eventId = context.run.eventRef?.eventId;
          if (typeof eventId === "string") {
            // Event-triggered work is bound to that actual Event's attached
            // canonical Signals, never an unrelated old Incident at list head.
            const linked = await context.db
              .selectDistinct({ id: npAgentIncidentSignals.incidentId })
              .from(npAgentIncidentSignals)
              .innerJoin(
                npAgentSignals,
                and(
                  eq(npAgentSignals.siteId, npAgentIncidentSignals.siteId),
                  eq(npAgentSignals.id, npAgentIncidentSignals.signalId),
                ),
              )
              .where(
                and(
                  eq(npAgentIncidentSignals.siteId, context.siteId),
                  sql`${npAgentSignals.evidence} @> ${JSON.stringify([{ kind: "event", eventId }])}::jsonb`,
                ),
              )
              .orderBy(asc(npAgentIncidentSignals.incidentId))
              .limit(26);
            metadata.truncated = linked.length > 25;
            for (const target of linked.slice(0, 25)) {
              let candidate;
              try {
                candidate = (await options.incidents.get({ incidentId: target.id }, readContext))
                  .incident;
              } catch (error) {
                if (error instanceof NpAgentGatewayError && [403, 404].includes(error.status))
                  continue;
                throw error;
              }
              if (
                !["open", "investigating"].includes(candidate.status) ||
                !["spam", "abuse"].includes(candidate.category)
              )
                continue;
              if (!eligible(candidate.fingerprint)) {
                blocked = true;
                continue;
              }
              incident = candidate;
              break;
            }
          } else {
            let cursor: string | null = null;
            // A bounded raw page may have no visible items. Follow its actual
            // continuation and skip already charged fingerprints within 25 rows.
            for (let scanned = 0; scanned < 25; scanned++) {
              const page = await options.incidents.list(
                {
                  statuses: ["open", "investigating"],
                  categories: ["spam", "abuse"],
                  severities: [],
                  updatedAfter: null,
                  limit: 1,
                  cursor,
                },
                readContext,
              );
              const candidate = page.items[0];
              if (candidate && eligible(candidate.fingerprint)) {
                incident = candidate;
                break;
              }
              if (candidate) blocked = true;
              cursor = page.nextCursor;
              if (cursor === null) break;
              if (scanned === 24) metadata.truncated = true;
            }
          }
          if (!incident && blocked)
            throw new NpAgentGatewayError(
              "RUNTIME_BUDGET_BLOCKED",
              409,
              "Moderator analysis budget is exhausted.",
            );
        }
        if (!incident) return { metadata, excerpts };
        if (
          incident.siteId !== context.siteId ||
          !["open", "investigating"].includes(incident.status) ||
          !["spam", "abuse"].includes(incident.category)
        )
          unavailable();
        metadata.incident = {
          id: incident.id,
          versionNumber: incident.versionNumber,
          fingerprint: incident.fingerprint,
        };
        metadata.truncated = incident.signalIds.length > 10;
        const signals =
          incident.signalIds.length === 0
            ? []
            : await context.db
                .select()
                .from(npAgentSignals)
                .where(
                  and(
                    eq(npAgentSignals.siteId, context.siteId),
                    inArray(npAgentSignals.id, incident.signalIds.slice(0, 10)),
                  ),
                )
                .orderBy(asc(npAgentSignals.id));
        if (signals.length !== Math.min(incident.signalIds.length, 10)) metadata.truncated = true;
        const events = new Map<string, string>();
        for (const signal of signals) {
          const canonical = await npReadAgentIncidentSignalEvidenceV1(signal);
          if (
            signal.incidentId !== incident.id ||
            signal.status !== "attached" ||
            signal.fingerprint !== incident.fingerprint
          )
            unavailable();
          for (const ref of canonical.evidence) {
            if (ref.kind !== "event") {
              metadata.truncated = true;
              continue;
            }
            if (events.size >= 100 && !events.has(ref.eventId)) {
              metadata.truncated = true;
              break;
            }
            const retained = events.get(ref.eventId);
            const exact = serializeAgentCanonicalJson(ref);
            if (retained !== undefined && retained !== exact) unavailable();
            events.set(ref.eventId, exact);
          }
        }
        const rows =
          events.size === 0
            ? []
            : await context.db
                .select()
                .from(npAgentEvents)
                .where(
                  and(
                    eq(npAgentEvents.siteId, context.siteId),
                    inArray(npAgentEvents.id, [...events.keys()]),
                  ),
                )
                .orderBy(asc(npAgentEvents.id));
        if (rows.length !== events.size) metadata.truncated = true;
        const targets = new Set<string>();
        for (const row of rows) {
          const fact = await npReadAgentModeratorContentEvidenceFactV1(context.db, row, user);
          if (
            !fact ||
            !settings.collectionSlugs.includes(fact.subject.collection) ||
            (context.policy.effective.resources.collections !== null &&
              !context.policy.effective.resources.collections.includes(fact.subject.collection)) ||
            serializeAgentCanonicalJson(fact.evidence) !== events.get(row.id)
          ) {
            metadata.truncated = true;
            continue;
          }
          const key = serializeAgentCanonicalJson(fact.subject);
          if (targets.has(key)) continue;
          if (targets.size === 10) {
            metadata.truncated = true;
            break;
          }
          try {
            const target = {
              kind: fact.subject.kind,
              collection: fact.subject.collection,
              id:
                fact.subject.kind === "comment" ? fact.subject.commentId : fact.subject.documentId,
            };
            let fullText: string, versionDigest: string;
            if (target.kind === "comment") {
              const current = await npInspectCommunityCommentEvidenceV1(
                context.db as unknown as NpTransaction,
                { siteId: context.siteId, target, user },
              );
              const parent = await npGetPersistedCollectionDocumentById(
                target.collection,
                current.comment.targetId,
                context.siteId,
                { tx: context.db as unknown as NpTransaction },
              );
              if (
                (!parent ||
                  parent.status !== "published" ||
                  current.comment.status !== "visible") &&
                !context.evidence.definition.scopes.includes("content:draft")
              ) {
                metadata.truncated = true;
                continue;
              }
              fullText = current.comment.bodyMd;
              versionDigest = current.versionDigest;
            } else {
              const current = await npInspectCommunityDocumentEvidenceV1(
                context.db as unknown as NpTransaction,
                { siteId: context.siteId, target, user },
              );
              if (
                current.document.status !== "published" &&
                !context.evidence.definition.scopes.includes("content:draft")
              ) {
                metadata.truncated = true;
                continue;
              }
              fullText = options.documentEvidence.projectText(
                target.collection,
                npSerializeCollectionDocument(
                  current.document,
                  current.config,
                ) as unknown as NpAgentJsonObject,
              );
              versionDigest = current.versionDigest;
            }
            if (versionDigest !== fact.targetVersionDigest || fullText.trim().length === 0) {
              metadata.truncated = true;
              continue;
            }
            if (fullText.length > 2000) metadata.truncated = true;
            const text = fullText.slice(0, 2000).replace(/[\uD800-\uDBFF]$/u, ""),
              id = `moderator-assessment-${excerpts.length.toString().padStart(3, "0")}`;
            const excerptDigest = npDigestAgentModeratorAssessmentExcerptV1({
              subject: fact.subject,
              currentVersionDigest: versionDigest,
              text,
            });
            targets.add(key);
            metadata.sources.push({
              id,
              eventId: row.id,
              eventDigest: row.eventHash,
              subject: { ...fact.subject },
              currentVersionDigest: versionDigest,
              excerptDigest,
            });
            excerpts.push({ id, digest: excerptDigest, observedAt: fact.observedAt, text });
          } catch (error) {
            if (error instanceof Error) metadata.truncated = true;
            else throw error;
          }
        }
        const current = await options.incidents.get({ incidentId: incident.id }, readContext);
        if (serializeAgentCanonicalJson(current.incident) !== serializeAgentCanonicalJson(incident))
          unavailable();
        await npResolveAgentModeratorStaffUserV1(context.db, context.siteId, user.id);
        return { metadata: npRequireAgentModeratorAssessmentEvidenceV1(metadata), excerpts };
      }),
  };
  issued.add(service);
  return Object.freeze(service);
}
