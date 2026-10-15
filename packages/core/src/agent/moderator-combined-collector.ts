import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
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
import { npReadAgentModeratorContentEvidenceFactV1 } from "./moderator-content-evidence.js";
import {
  npAgentModeratorWindowStartedAtV1,
  npDetectAgentRepeatedLinkSpamV1,
} from "./moderator-detector.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npCollectAgentModeratorFloodPageV1 } from "./moderator-flood-collection.js";

export interface NpAgentModeratorCombinedCollectionResultV1 extends NpAgentModeratorCollectionResultV1 {
  /** False means a durable bounded page committed; admission must remain pending. */
  complete?: boolean;
}

export interface NpAgentModeratorCombinedCommentCollectorV1 {
  collect(input: {
    siteId: string;
    windowStartedAt: string;
    settings: NpAgentModeratorSettingsV1;
  }): Promise<NpAgentModeratorCombinedCollectionResultV1>;
}

export type NpAgentModeratorCombinedContentCollectorV1 = NpAgentModeratorCombinedCommentCollectorV1;

interface CollectorOptions {
  staffUserId: string;
  incidents: NpAgentIncidentWriteServiceV1;
  now?: () => Date;
}

/** Explicit host invocation; one closed window and bounded durable source pages. */
export function createAgentModeratorCombinedCommentCollectorV1(
  options: CollectorOptions,
): NpAgentModeratorCombinedCommentCollectorV1 {
  return createCombinedCollector(options, false);
}

/** Explicit host invocation; bounded durable pages across all three source owners. */
export function createAgentModeratorCombinedContentCollectorV1(
  options: CollectorOptions,
): NpAgentModeratorCombinedContentCollectorV1 {
  return createCombinedCollector(options, true);
}

function createCombinedCollector(
  options: CollectorOptions,
  includeDocuments: boolean,
): NpAgentModeratorCombinedContentCollectorV1 {
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
          const selectedSources = and(
            eq(npAgentEvents.siteId, siteId),
            eq(npAgentEvents.sourceKind, "community"),
            sql`${npAgentEvents.subject}->>'collection' in (${sql.join(
              settings.collectionSlugs.map((slug) => sql`${slug}`),
              sql`, `,
            )})`,
            includeDocuments
              ? sql`${npAgentEvents.subject}->>'kind' in ('comment', 'document')`
              : sql`${npAgentEvents.subject}->>'kind' = 'comment'`,
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
              includeDocuments
                ? and(
                    eq(npAgentEvents.sourceComponent, "community.document-reports"),
                    eq(npAgentEvents.kind, "community.content.reported"),
                  )
                : undefined,
            ),
            gte(npAgentEvents.occurredAt, start),
            lt(npAgentEvents.occurredAt, end),
          );
          const resumed = await npCollectAgentModeratorFloodPageV1({
            db,
            siteId,
            settings,
            windowStartedAt: input.windowStartedAt,
            staffUserId: options.staffUserId,
            includeDocuments,
            incidents: options.incidents,
            selectedSources,
            user,
            now: now(),
          });
          if (resumed) {
            await npResolveAgentModeratorStaffUserV1(db, siteId, options.staffUserId);
            return resumed;
          }
          const sources = await db
            .select()
            .from(npAgentEvents)
            .where(selectedSources)
            .orderBy(asc(npAgentEvents.occurredAt), asc(npAgentEvents.id))
            .limit(101);
          if (sources.length > 100) {
            const result = await npCollectAgentModeratorFloodPageV1({
              db,
              siteId,
              settings,
              windowStartedAt: input.windowStartedAt,
              staffUserId: options.staffUserId,
              includeDocuments,
              incidents: options.incidents,
              selectedSources,
              user,
              now: now(),
              initialize: true,
            });
            if (!result) throw new Error("Flood collection checkpoint was not initialized.");
            await npResolveAgentModeratorStaffUserV1(db, siteId, options.staffUserId);
            return result;
          }
          const facts: NpAgentModeratorFactV1[] = [];
          for (const source of sources) {
            if (
              (source.subject?.kind !== "comment" &&
                (!includeDocuments || source.subject?.kind !== "document")) ||
              !settings.collectionSlugs.includes(source.subject.collection)
            )
              continue;
            const fact = includeDocuments
              ? await npReadAgentModeratorContentEvidenceFactV1(db, source, user)
              : await npReadAgentModeratorCommentEvidenceFactV1(db, source, user);
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
