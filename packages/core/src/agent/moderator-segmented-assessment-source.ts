import { and, asc, eq, inArray } from "drizzle-orm";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentModeratorAssessmentEvidenceV2,
  type NpAgentModeratorAssessmentEvidenceV2,
} from "../agent-contract/moderator-segmented-assessment-contract.js";
import { npRequireAgentModeratorSettingsV1 } from "../agent-contract/moderator-contract.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import { npSerializeCollectionDocument } from "../collection-contract/contract.js";
import type { NpTransaction } from "../collections/pipeline.js";
import { npGetPersistedCollectionDocumentById } from "../collections/pipeline.js";
import {
  npInspectCommunityCommentEvidenceBatchV1,
  npInspectCommunityDocumentEvidenceV1,
} from "../community/content-containment.js";
import { npAgentEvents, npAgentSignals, type npAgentProviderCalls } from "../db/schema/agent.js";
import {
  npReadAgentIncidentSignalEvidenceV1,
  type NpAgentIncidentServiceV1,
} from "./incident-service.js";
import { npAgentModeratorAssessmentIncidentContextV1 } from "./moderator-assessment-context.js";
import { npReadAgentModeratorContentEvidenceFactV1 } from "./moderator-content-evidence.js";
import {
  npResolveAgentModeratorStaffUserV1,
  npReadAgentModeratorCommentFactsBatchV1,
} from "./moderator-collector.js";
import {
  npDigestAgentModeratorSegmentedEvidenceV2 as digest,
  npModeratorSegmentedAssessmentUnavailableV2 as unavailable,
  npReadAgentModeratorSegmentProgressV2,
} from "./moderator-segmented-assessment-proof.js";
import type { NpAgentRuntimeDocumentEvidenceReaderV1 } from "./read-capability-executors.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";

type Binding = Omit<
  NpAgentModeratorAssessmentEvidenceV2["sources"][number],
  "id" | "excerptDigest"
>;
export async function npReadAgentModeratorSegmentedSourcesV2(
  options: {
    incidents: NpAgentIncidentServiceV1;
    documentEvidence: NpAgentRuntimeDocumentEvidenceReaderV1;
  },
  context: NpAgentRuntimeRunContextV1,
  incident: NpAgentIncidentV1,
  calls: (typeof npAgentProviderCalls.$inferSelect)[],
  observedAt: string,
  selectedIndex?: number,
) {
  const progress = await npReadAgentModeratorSegmentProgressV2(calls);
  observedAt = progress.anchor?.observedAt ?? observedAt;
  const segmentIndex =
    selectedIndex ??
    (progress.latest && progress.latest.state !== "succeeded"
      ? progress.latestEvidence!.segmentIndex
      : progress.nextIndex);
  const user = await npResolveAgentModeratorStaffUserV1(
    context.db,
    context.siteId,
    context.staffUser!.id,
  );
  const settings = npRequireAgentModeratorSettingsV1(
    context.evidence.definition.settings.find((entry) => entry.recipeId === context.run.recipeId),
  );
  if (incident.signalIds.length > 100) unavailable();
  const signals = incident.signalIds.length
    ? await context.db
        .select()
        .from(npAgentSignals)
        .where(
          and(
            eq(npAgentSignals.siteId, context.siteId),
            inArray(npAgentSignals.id, incident.signalIds),
          ),
        )
        .orderBy(asc(npAgentSignals.id))
    : [];
  if (signals.length !== incident.signalIds.length) unavailable();
  let incomplete = false;
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
        incomplete = true;
        continue;
      }
      const exact = serializeAgentCanonicalJson(ref);
      if (events.has(ref.eventId) && events.get(ref.eventId) !== exact) unavailable();
      events.set(ref.eventId, exact);
    }
  }
  if (events.size > 10000) unavailable();
  const targets = new Map<string, Binding>();
  const eventBindings: { id: string; digest: string; evidence: string }[] = [];
  // Bounded query chunks cover the entire canonical union; no first-page shortcut.
  const ids = [...events.keys()].sort();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const rows = await context.db
      .select()
      .from(npAgentEvents)
      .where(
        and(
          eq(npAgentEvents.siteId, context.siteId),
          inArray(npAgentEvents.id, ids.slice(offset, offset + 100)),
        ),
      )
      .orderBy(asc(npAgentEvents.id));
    if (rows.length !== Math.min(100, ids.length - offset)) incomplete = true;
    const observed = rows.filter((row) => row.kind !== "community.content.reported");
    const commentFacts = await npReadAgentModeratorCommentFactsBatchV1(context.db, {
      siteId: context.siteId,
      sources: observed,
      user,
    });
    const facts = new Map(observed.map((row, index) => [row.id, commentFacts[index]]));
    for (const row of rows) {
      eventBindings.push({ id: row.id, digest: row.eventHash, evidence: events.get(row.id)! });
      const fact =
        row.kind === "community.content.reported"
          ? await npReadAgentModeratorContentEvidenceFactV1(context.db, row, user)
          : facts.get(row.id);
      if (
        !fact ||
        !settings.collectionSlugs.includes(fact.subject.collection) ||
        (context.policy.effective.resources.collections !== null &&
          !context.policy.effective.resources.collections.includes(fact.subject.collection)) ||
        serializeAgentCanonicalJson(fact.evidence) !== events.get(row.id)
      ) {
        incomplete = true;
        continue;
      }
      const key = serializeAgentCanonicalJson(fact.subject);
      const binding: Binding = {
        eventId: row.id,
        eventDigest: row.eventHash,
        subject: { ...fact.subject },
        currentVersionDigest: fact.targetVersionDigest,
      };
      const prior = targets.get(key);
      if (prior && prior.currentVersionDigest !== binding.currentVersionDigest) incomplete = true;
      if (!prior) targets.set(key, binding);
    }
  }
  const ordered = [...targets.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, target]) => target);
  if (ordered.length > 1000) incomplete = true;
  const bounded = ordered.slice(0, 1000);
  const projected: {
    binding: Binding;
    excerptDigest: string | null;
    text: string | null;
    truncated: boolean;
  }[] = [];
  // A second fresh pass binds current excerpts independently of source validation.
  // Never reuse these facts across segments or provider calls.
  const comments = new Map<
    Binding,
    Awaited<ReturnType<typeof npInspectCommunityCommentEvidenceBatchV1>>[number]
  >();
  for (let offset = 0; offset < bounded.length; offset += 100) {
    const page = bounded.slice(offset, offset + 100).flatMap((binding) => {
      const subject = binding.subject;
      return subject.kind === "comment"
        ? [
            {
              binding,
              target: {
                kind: "comment" as const,
                collection: subject.collection,
                id: subject.commentId,
              },
            },
          ]
        : [];
    });
    try {
      const inspected = await npInspectCommunityCommentEvidenceBatchV1(
        context.db as unknown as NpTransaction,
        {
          siteId: context.siteId,
          user,
          targets: page.map((entry) => entry.target),
        },
      );
      for (const [index, entry] of page.entries())
        comments.set(entry.binding, inspected[index] ?? null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      for (const entry of page) comments.set(entry.binding, null);
    }
  }
  // Bind every current visible-field projection, including completed segments. Configuration/ACL
  // changes can alter a projection without changing the content's own version digest.
  for (const binding of bounded) {
    try {
      const target = {
        kind: binding.subject.kind,
        collection: binding.subject.collection,
        id:
          binding.subject.kind === "comment"
            ? binding.subject.commentId
            : binding.subject.documentId,
      };
      let fullText: string, versionDigest: string;
      if (target.kind === "comment") {
        const current = comments.get(binding);
        if (!current) throw new Error("Current source is unavailable");
        const parent = await npGetPersistedCollectionDocumentById(
          target.collection,
          current.comment.targetId,
          context.siteId,
          { tx: context.db as unknown as NpTransaction },
        );
        if (
          (!parent || parent.status !== "published" || current.comment.status !== "visible") &&
          !context.evidence.definition.scopes.includes("content:draft")
        )
          throw new Error("Current source is unavailable");
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
        )
          throw new Error("Current source is unavailable");
        fullText = options.documentEvidence.projectText(
          target.collection,
          npSerializeCollectionDocument(
            current.document,
            current.config,
          ) as unknown as NpAgentJsonObject,
        );
        versionDigest = current.versionDigest;
      }
      if (versionDigest !== binding.currentVersionDigest || !fullText.trim())
        throw new Error("Current source version is unavailable");
      const text = fullText.slice(0, 2000).replace(/[\uD800-\uDBFF]$/u, "");
      projected.push({
        binding,
        text,
        truncated: fullText.length > 2000,
        excerptDigest: digest("np.agent-moderator-assessment.v1\0excerpt", {
          subject: binding.subject,
          currentVersionDigest: versionDigest,
          text,
        }),
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      projected.push({ binding, text: null, excerptDigest: null, truncated: true });
    }
  }
  const safeProjection = projected.map(({ binding, excerptDigest, truncated }) => ({
    ...binding,
    subject: { ...binding.subject },
    excerptDigest,
    truncated,
  }));
  const segmentCount = Math.max(1, Math.ceil(bounded.length / 10));
  const segmentDigests = Array.from({ length: segmentCount }, (_, index) =>
    digest(
      "np.agent-moderator-segment-targets.v2",
      safeProjection.slice(index * 10, index * 10 + 10),
    ),
  );
  const manifest = {
    digest: digest("np.agent-moderator-segment-manifest.v2", {
      incident: {
        id: incident.id,
        versionNumber: incident.versionNumber,
        fingerprint: incident.fingerprint,
      },
      signals: signals.map((signal) => ({ id: signal.id, evidenceHash: signal.evidenceDigest })),
      events: eventBindings,
      targets: ordered,
      projection: safeProjection,
      incomplete,
    }),
    signalCount: signals.length,
    eventCount: events.size,
    targetCount: ordered.length,
    segmentCount,
    incomplete,
    segmentDigests,
  };
  if (segmentIndex >= segmentCount) unavailable();
  if (
    progress.anchor &&
    serializeAgentCanonicalJson(manifest) !== serializeAgentCanonicalJson(progress.anchor.manifest)
  )
    unavailable();
  const metadata: NpAgentModeratorAssessmentEvidenceV2 = {
    schemaVersion: "np.agent-moderator-assessment-evidence.v2",
    observedAt,
    incident: {
      id: incident.id,
      versionNumber: incident.versionNumber,
      fingerprint: incident.fingerprint,
    },
    truncated: false,
    sources: [],
    manifest,
    segmentIndex,
  };
  const excerpts: { id: string; digest: string; observedAt: string; text: string }[] = [];
  for (const entry of projected.slice(segmentIndex * 10, segmentIndex * 10 + 10)) {
    metadata.truncated ||= entry.truncated;
    if (entry.text === null || entry.excerptDigest === null) continue;
    const id = `moderator-assessment-${excerpts.length.toString().padStart(3, "0")}`;
    metadata.sources.push({ ...entry.binding, id, excerptDigest: entry.excerptDigest });
    excerpts.push({ id, digest: entry.excerptDigest, observedAt, text: entry.text });
  }
  const current = await options.incidents.get(
    { incidentId: incident.id },
    npAgentModeratorAssessmentIncidentContextV1(context),
  );
  if (serializeAgentCanonicalJson(current.incident) !== serializeAgentCanonicalJson(incident))
    unavailable();
  await npResolveAgentModeratorStaffUserV1(context.db, context.siteId, user.id);
  return { metadata: npRequireAgentModeratorAssessmentEvidenceV2(metadata), excerpts };
}
