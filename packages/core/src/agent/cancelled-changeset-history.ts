import type { NpAgentSourceReleaseCanonicalV1 } from "../agent-contract/source-release-contract.js";
import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  type npAgentActions,
  npAgentChangesets,
  npAgentSourceReleases,
  npAgentSourceReleaseEdges,
} from "../db/schema/agent.js";
import {
  npRequireAgentSourceReleaseRecordV1,
  npResolveReleasedAgentActionPrincipalV1,
} from "./source-release-read.js";
import { npReadCancelledChangeSetLifecycleV1 } from "./cancelled-changeset-lifecycle.js";
type Db = ReturnType<typeof getDb>;
type Action = typeof npAgentActions.$inferSelect;
type Body = Extract<NpAgentSourceReleaseCanonicalV1, { kind: "runtime-run" }>;

async function history(
  db: Db,
  c: typeof npAgentChangesets.$inferSelect,
  releaseId: string,
): Promise<{ body: Body; actions: Action[] } | null> {
  try {
    const [release] = await db
      .select()
      .from(npAgentSourceReleases)
      .where(
        and(eq(npAgentSourceReleases.siteId, c.siteId), eq(npAgentSourceReleases.id, releaseId)),
      )
      .limit(1);
    if (!release) return null;
    const body = await npRequireAgentSourceReleaseRecordV1(release);
    if (body.kind !== "runtime-run") return null;
    const proof = await npReadCancelledChangeSetLifecycleV1({
      query: (statement) => db.execute(statement),
      changeSet: c,
      source: body,
      releasedAt: release.releasedAt,
    });
    if (
      !proof ||
      proof.actions.some((a) => a.runId !== null || a.runSourceReleaseId !== release.id) ||
      (proof.creator && (c.runId !== null || c.runSourceReleaseId !== release.id))
    )
      return null;
    for (const expected of proof.edges) {
      const edges = await db
        .select()
        .from(npAgentSourceReleaseEdges)
        .where(
          and(
            eq(npAgentSourceReleaseEdges.siteId, c.siteId),
            eq(npAgentSourceReleaseEdges.sourceReleaseId, release.id),
            eq(npAgentSourceReleaseEdges.ownerKind, expected.kind),
            eq(npAgentSourceReleaseEdges.ownerId, expected.id),
            eq(npAgentSourceReleaseEdges.edgeCode, expected.code),
          ),
        )
        .limit(2);
      if (
        edges.length !== 1 ||
        edges[0].ownerEvidenceDigest !== expected.digest ||
        edges[0].verifierVersion !== 1 ||
        edges[0].releasedAt.getTime() !== release.releasedAt.getTime()
      )
        return null;
    }
    return { body, actions: proof.actions };
  } catch {
    return null;
  }
}

/** Historical attribution is not current authority; callers retain their current ACL facade. */
export async function npReadCancelledChangeSetReleaseV1(input: {
  db: Db;
  changeSet: typeof npAgentChangesets.$inferSelect;
}): Promise<{ body: Body; action: Action } | null> {
  const c = input.changeSet;
  if (c.runId !== null || !c.runSourceReleaseId) return null;
  const result = await history(input.db, c, c.runSourceReleaseId);
  const action = result?.actions.find(
    (a) => a.invocationId === c.invocationId && a.capabilityId === "changeset.create",
  );
  return result && action ? { body: result.body, action } : null;
}

export async function npResolveReleasedActionPrincipalV1(input: { db: Db; action: Action }) {
  const a = input.action;
  if (
    ![
      "changeset.create",
      "changeset.validate",
      "changeset.preview",
      "changeset.apply",
      "changeset.schedule",
    ].includes(a.capabilityId)
  )
    return npResolveReleasedAgentActionPrincipalV1(input);
  const changeSetId = ["changeset.apply", "changeset.schedule"].includes(a.capabilityId)
    ? a.inputCanonical.changeSetId
    : a.outputRedacted?.changeSetId;
  if (!a.runSourceReleaseId || typeof changeSetId !== "string") return null;
  const [c] = await input.db
    .select()
    .from(npAgentChangesets)
    .where(and(eq(npAgentChangesets.siteId, a.siteId), eq(npAgentChangesets.id, changeSetId)))
    .limit(1);
  if (!c) return null;
  const result = await history(input.db, c, a.runSourceReleaseId);
  return result?.actions.some((row) => row.id === a.id) ? result.body.principalId : null;
}
