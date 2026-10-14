import { and, eq } from "drizzle-orm";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentModeratorSignalCandidateV1,
  type NpAgentModeratorFactV1,
  type NpAgentModeratorSignalCandidateV1,
} from "../agent-contract/moderator-contract.js";
import type { NpAuthUser } from "../config/types.js";
import type { getDb } from "../db/runtime.js";
import { npAgentEvents } from "../db/schema/agent.js";
import { withCurrentSite } from "../sites/context.js";
import { npResolveAgentModeratorStaffUserV1 } from "./moderator-collector.js";
import { npReadAgentModeratorCommentEvidenceFactV1 } from "./moderator-comment-evidence.js";
import { npReadAgentModeratorDocumentReportFactV1 } from "./moderator-document-report-source.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;

/** Reuse exact source owners; filing claims never gain classifier verdicts or authority. */
export function npReadAgentModeratorContentEvidenceFactV1(
  db: Db,
  source: EventRow,
  user: NpAuthUser,
): Promise<NpAgentModeratorFactV1 | null> {
  return source.kind === "community.content.reported" &&
    source.sourceComponent === "community.document-reports"
    ? npReadAgentModeratorDocumentReportFactV1(db, source, user)
    : npReadAgentModeratorCommentEvidenceFactV1(db, source, user);
}

/** Host-injected whole-candidate resolution for observed/reported comments and reported documents. */
export async function npResolveAgentModeratorCombinedContentEvidenceV1(input: {
  db: Db;
  candidate: NpAgentModeratorSignalCandidateV1;
  staffUserId: string;
}): Promise<boolean> {
  const candidate = npRequireAgentModeratorSignalCandidateV1(input.candidate);
  canonicalBodyUuid(input.staffUserId, "moderator.staffUserId");
  const siteId = candidate.canonicalEvidence.siteId;
  return withCurrentSite(siteId, async () => {
    const user = await npResolveAgentModeratorStaffUserV1(input.db, siteId, input.staffUserId);
    for (const expected of candidate.facts) {
      if (expected.evidence.kind !== "event") return false;
      const [source] = await input.db
        .select()
        .from(npAgentEvents)
        .where(
          and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, expected.evidence.eventId)),
        )
        .limit(1);
      if (!source) return false;
      const actual = await npReadAgentModeratorContentEvidenceFactV1(input.db, source, user);
      if (!actual || serializeAgentCanonicalJson(actual) !== serializeAgentCanonicalJson(expected))
        return false;
    }
    await npResolveAgentModeratorStaffUserV1(input.db, siteId, input.staffUserId);
    return true;
  });
}
