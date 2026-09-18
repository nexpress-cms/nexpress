import type { NpAgentSourceReleaseCanonicalV1 } from "../agent-contract/source-release-contract.js";
import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentInvocations,
  npAgentChangesets,
  npAgentSourceReleases,
  npAgentSourceReleaseEdges,
} from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  npRequireAgentSourceReleaseRecordV1,
  npResolveReleasedAgentActionPrincipalV1,
} from "./source-release-read.js";
import {
  npVerifyCancelledChangeSetAttributionV1,
  npCancelledChangeSetDependenciesSafeV1,
} from "./cancelled-changeset-source-release.js";
type Db = ReturnType<typeof getDb>;

/** Historical attribution is not current authority; callers must still use their existing ACL facade. */
export async function npReadCancelledChangeSetReleaseV1(input: {
  db: Db;
  changeSet: typeof npAgentChangesets.$inferSelect;
}): Promise<{
  body: Extract<NpAgentSourceReleaseCanonicalV1, { kind: "runtime-run" }>;
  action: typeof npAgentActions.$inferSelect;
} | null> {
  const { db, changeSet: c } = input;
  try {
    if (c.runId !== null || !c.runSourceReleaseId || !c.invocationId) return null;
    const [release] = await db
      .select()
      .from(npAgentSourceReleases)
      .where(
        and(
          eq(npAgentSourceReleases.siteId, c.siteId),
          eq(npAgentSourceReleases.id, c.runSourceReleaseId),
        ),
      )
      .limit(1);
    if (!release) return null;
    const body = await npRequireAgentSourceReleaseRecordV1(release);
    if (body.kind !== "runtime-run") return null;
    const actions = await db
      .select()
      .from(npAgentActions)
      .where(
        and(eq(npAgentActions.siteId, c.siteId), eq(npAgentActions.invocationId, c.invocationId)),
      )
      .limit(2);
    if (actions.length !== 1) return null;
    const a = actions[0];
    if (a.runId !== null || a.runSourceReleaseId !== release.id) return null;
    const [i] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, c.siteId), eq(npAgentInvocations.id, c.invocationId)),
      )
      .limit(1);
    if (!i) return null;
    const [audit] = await db
      .select()
      .from(npAuditEvents)
      .where(and(eq(npAuditEvents.siteId, c.siteId), eq(npAuditEvents.id, i.auditEventId)))
      .limit(1);
    if (!audit) return null;
    const proof = await npVerifyCancelledChangeSetAttributionV1({
      action: a,
      invocation: i,
      changeSet: c,
      audit,
      runId: body.sourceId,
      runFingerprint: body.admissionFingerprint,
      principalId: body.principalId,
      agentVersionId: body.agentVersionId,
      agentId: body.agentId,
      deadlineAt: body.deadlineAt,
      releasedAt: release.releasedAt,
    });
    if (!proof) return null;
    const expected = [
      ["changeset-action", a.id, "action-run", proof.actionDigest],
      ["changeset-invocation", i.id, "invocation-authority-run", proof.invocationDigest],
      ["changeset-source", c.id, "changeset-run", proof.changeSetDigest],
      ["changeset-audit", audit.id, "audit-changeset", proof.auditDigest],
    ];
    for (const [kind, id, code, digest] of expected) {
      const edges = await db
        .select()
        .from(npAgentSourceReleaseEdges)
        .where(
          and(
            eq(npAgentSourceReleaseEdges.siteId, c.siteId),
            eq(npAgentSourceReleaseEdges.sourceReleaseId, release.id),
            eq(npAgentSourceReleaseEdges.ownerKind, kind),
            eq(npAgentSourceReleaseEdges.ownerId, id),
            eq(npAgentSourceReleaseEdges.edgeCode, code),
          ),
        )
        .limit(2);
      if (
        edges.length !== 1 ||
        edges[0].ownerEvidenceDigest !== digest ||
        edges[0].verifierVersion !== 1 ||
        edges[0].releasedAt.getTime() !== release.releasedAt.getTime()
      )
        return null;
    }
    if (!(await npCancelledChangeSetDependenciesSafeV1(db, c, async () => {}))) return null;
    return { body, action: a };
  } catch {
    return null;
  }
}

export async function npResolveReleasedActionPrincipalV1(input: {
  db: Db;
  action: typeof npAgentActions.$inferSelect;
}) {
  if (input.action.capabilityId !== "changeset.create")
    return npResolveReleasedAgentActionPrincipalV1(input);
  if (!input.action.invocationId) return null;
  const rows = await input.db
    .select()
    .from(npAgentChangesets)
    .where(
      and(
        eq(npAgentChangesets.siteId, input.action.siteId),
        eq(npAgentChangesets.invocationId, input.action.invocationId),
      ),
    )
    .limit(2);
  if (rows.length !== 1) return null;
  const proof = await npReadCancelledChangeSetReleaseV1({ db: input.db, changeSet: rows[0] });
  return proof?.action.id === input.action.id ? proof.body.principalId : null;
}
