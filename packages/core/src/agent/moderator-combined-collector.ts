import { and, asc, eq, gte, inArray, lt, or } from "drizzle-orm";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  npRequireAgentModeratorSettingsV1,
  type NpAgentModeratorFactV1,
  type NpAgentModeratorSettingsV1,
} from "../agent-contract/moderator-contract.js";
import { npAgentEvents } from "../db/schema/agent.js";
import { withCurrentSite } from "../sites/context.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type { NpAgentIncidentWriteServiceV1 } from "./incident-write-service.js";
import {
  npResolveAgentModeratorStaffUserV1,
  type NpAgentModeratorCollectionResultV1,
} from "./moderator-collector.js";
import { npReadAgentModeratorCommentEvidenceFactV1 } from "./moderator-comment-evidence.js";
import {
  npAgentModeratorWindowStartedAtV1,
  npDetectAgentRepeatedLinkSpamV1,
} from "./moderator-detector.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";

export interface NpAgentModeratorCombinedCommentCollectorV1 {
  collect(input: {
    siteId: string;
    windowStartedAt: string;
    settings: NpAgentModeratorSettingsV1;
  }): Promise<NpAgentModeratorCollectionResultV1>;
}

/** Explicit host invocation; one closed window and one 100-event bound across both source owners. */
export function createAgentModeratorCombinedCommentCollectorV1(options: {
  staffUserId: string;
  incidents: NpAgentIncidentWriteServiceV1;
  now?: () => Date;
}): NpAgentModeratorCombinedCommentCollectorV1 {
  canonicalBodyUuid(options.staffUserId, "moderator.staffUserId");
  if (typeof options.incidents?.observe !== "function")
    throw new Error("Moderator Incident write owner is required.");
  const now = options.now ?? (() => new Date());
  return {
    async collect(input) {
      npAssertAgentPreviewEffectsAllowed();
      const siteId = canonicalBodySiteId(input.siteId, "moderator.siteId");
      const start = new Date(input.windowStartedAt);
      const end = new Date(start.getTime() + 600_000);
      if (
        npAgentModeratorWindowStartedAtV1(input.windowStartedAt) !== input.windowStartedAt ||
        end > now()
      )
        throw new NpAgentGatewayError(
          "MODERATOR_SOURCE_UNAVAILABLE",
          409,
          "Moderator evidence is unavailable.",
        );
      const settings = npRequireAgentModeratorSettingsV1(input.settings);
      return withCurrentSite(siteId, () =>
        npWithAgentRuntimeControlTransactionV1(siteId, async ({ db }) => {
          const user = await npResolveAgentModeratorStaffUserV1(db, siteId, options.staffUserId);
          const sources = await db
            .select()
            .from(npAgentEvents)
            .where(
              and(
                eq(npAgentEvents.siteId, siteId),
                eq(npAgentEvents.sourceKind, "community"),
                or(
                  and(
                    eq(npAgentEvents.sourceComponent, "community.comments"),
                    inArray(npAgentEvents.kind, [
                      "community.content.created",
                      "community.content.moderated",
                    ]),
                  ),
                  and(
                    eq(npAgentEvents.sourceComponent, "community.comment-reports"),
                    eq(npAgentEvents.kind, "community.content.reported"),
                  ),
                ),
                gte(npAgentEvents.occurredAt, start),
                lt(npAgentEvents.occurredAt, end),
              ),
            )
            .orderBy(asc(npAgentEvents.occurredAt), asc(npAgentEvents.id))
            .limit(101);
          if (sources.length > 100)
            throw new NpAgentGatewayError(
              "MODERATOR_COLLECTION_LIMIT",
              409,
              "The selected moderation window exceeds the bounded collector capacity.",
            );
          const facts: NpAgentModeratorFactV1[] = [];
          for (const source of sources) {
            if (
              source.subject?.kind !== "comment" ||
              !settings.collectionSlugs.includes(source.subject.collection)
            )
              continue;
            const fact = await npReadAgentModeratorCommentEvidenceFactV1(db, source, user);
            if (fact) facts.push(fact);
          }
          const candidates = await npDetectAgentRepeatedLinkSpamV1({
            siteId,
            windowStartedAt: input.windowStartedAt,
            settings,
            facts,
          });
          const observations: NpAgentModeratorCollectionResultV1["observations"] = [];
          for (const candidate of candidates)
            observations.push(await options.incidents.observe(candidate, { transaction: db }));
          await npResolveAgentModeratorStaffUserV1(db, siteId, options.staffUserId);
          return { inspectedEvents: sources.length, acceptedFacts: facts.length, observations };
        }),
      );
    },
  };
}
