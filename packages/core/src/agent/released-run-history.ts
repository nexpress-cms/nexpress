import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentSourceReleaseEdges,
  npAgentSourceReleases,
} from "../db/schema/agent.js";
import {
  npRequireAgentActivityRunResourceV1,
  type NpAgentActivityExpiredRunV1,
} from "../agent-contract/activity-contract.js";
import {
  npRequireAgentSourceReleaseRecordV1,
  npResolveReleasedAgentActionPrincipalV1,
} from "./source-release-read.js";

/** Retained receipts prove identity; current action visibility still controls disclosure. */
export async function npReadReleasedRunHistoryV1(input: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  runId: string;
  actionVisible: (action: typeof npAgentActions.$inferSelect) => Promise<boolean>;
}): Promise<NpAgentActivityExpiredRunV1 | null> {
  try {
    const [release] = await input.db
      .select()
      .from(npAgentSourceReleases)
      .where(
        and(
          eq(npAgentSourceReleases.siteId, input.siteId),
          eq(npAgentSourceReleases.sourceKind, "runtime-run"),
          eq(npAgentSourceReleases.sourceId, input.runId),
        ),
      )
      .limit(1);
    if (!release) return null;
    const body = await npRequireAgentSourceReleaseRecordV1(release);
    if (body.kind !== "runtime-run") return null;
    // Cleanup admits at most 100 references per owner table. Bound historical reads too.
    const edges = await input.db
      .select()
      .from(npAgentSourceReleaseEdges)
      .where(
        and(
          eq(npAgentSourceReleaseEdges.siteId, input.siteId),
          eq(npAgentSourceReleaseEdges.sourceReleaseId, release.id),
          eq(npAgentSourceReleaseEdges.ownerKind, "read-action"),
        ),
      )
      .limit(101);
    const actions = await input.db
      .select()
      .from(npAgentActions)
      .where(
        and(
          eq(npAgentActions.siteId, input.siteId),
          eq(npAgentActions.runSourceReleaseId, release.id),
        ),
      )
      .limit(101);
    if (edges.length > 100 || actions.length !== edges.length) return null;
    for (const action of actions) {
      if (
        edges.filter((edge) => edge.ownerId === action.id && edge.edgeCode === "action-run")
          .length !== 1 ||
        (await npResolveReleasedAgentActionPrincipalV1({ db: input.db, action })) !==
          body.principalId ||
        !(await input.actionVisible(action))
      )
        return null;
    }
    const projected = npRequireAgentActivityRunResourceV1({
      schemaVersion: "np.agent-activity-run-expired.v1",
      runId: body.sourceId,
      siteId: body.siteId,
      principalId: body.principalId,
      agent: { id: body.agentId, versionId: body.agentVersionId },
      state: body.state,
      finishedAt: body.finishedAt,
      releasedAt: body.releasedAt,
      evidence: "expired",
    });
    return projected.schemaVersion === "np.agent-activity-run-expired.v1" ? projected : null;
  } catch {
    return null;
  }
}
