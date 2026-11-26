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
import {
  npReadAgentModeratorCommentFactV1,
  npResolveAgentModeratorStaffUserV1,
} from "./moderator-collector.js";
import { npReadAgentModeratorCommentReportFactV1 } from "./moderator-report-source.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;

/** Dispatch only to existing exact source owners; reports never acquire adapter verdicts. */
export function npReadAgentModeratorCommentEvidenceFactV1(
  db: Db,
  source: EventRow,
  user: NpAuthUser,
): Promise<NpAgentModeratorFactV1 | null> {
  return source.kind === "community.content.reported"
    ? npReadAgentModeratorCommentReportFactV1(db, source, user)
    : npReadAgentModeratorCommentFactV1(db, source, user);
}

/** Host-injected Incident evidence owner for observed, reported or mixed comment candidates. */
export async function npResolveAgentModeratorCombinedCommentEvidenceV1(input: {
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
      const actual = await npReadAgentModeratorCommentEvidenceFactV1(input.db, source, user);
      if (!actual || serializeAgentCanonicalJson(actual) !== serializeAgentCanonicalJson(expected))
        return false;
    }
    await npResolveAgentModeratorStaffUserV1(input.db, siteId, input.staffUserId);
    return true;
  });
}
