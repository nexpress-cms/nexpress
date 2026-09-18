import { sql, type SQL } from "drizzle-orm";
import type {
  npAgentActions,
  npAgentInvocations,
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentChangesetValidationAttempts,
  npAgentChangesetPreviews,
  npAgentPreviewArtifacts,
  npAgentPreviewArtifactUploads,
  npAgentPreviewViewerLaunches,
  npAgentPreviewRenderSessions,
} from "../db/schema/agent.js";
import type { npAuditEvents } from "../db/schema/community.js";
import type { NpAgentSourceReleaseCanonicalV1 } from "../agent-contract/source-release-contract.js";
import { npDigestAgentAuthorizationContextCanonical } from "../agent-contract/canonical-authorization-context.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npSourceReleaseOwnerDigestV1 } from "./source-release-read.js";
import { npVerifyCancelledChangeSetAttributionV1 } from "./cancelled-changeset-source-release.js";
import { npVerifyAgentChangeSetPlanEvidenceV1 } from "./changeset-plan-evidence.js";
import { npVerifyCancelledPreviewEvidenceV1 } from "./cancelled-preview-evidence.js";

type ChangeSet = typeof npAgentChangesets.$inferSelect;
type Action = typeof npAgentActions.$inferSelect;
type Invocation = typeof npAgentInvocations.$inferSelect;
type Validation = typeof npAgentChangesetValidationAttempts.$inferSelect;
type Preview = typeof npAgentChangesetPreviews.$inferSelect;
type Body = Extract<NpAgentSourceReleaseCanonicalV1, { kind: "runtime-run" }>;
export type NpCancelledReleaseQueryV1 = (
  statement: SQL,
) => Promise<{ rows: Record<string, unknown>[] }>;
export type NpCancelledReleaseEdgeV1 = { kind: string; id: string; code: string; digest: string };
export type NpCancelledReleaseProofV1 = {
  actions: Action[];
  edges: NpCancelledReleaseEdgeV1[];
  validationIds: string[];
  previewIds: string[];
  creator: boolean;
};
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const digest = (row: object) =>
  npSourceReleaseOwnerDigestV1(JSON.parse(JSON.stringify(row)) as Record<string, unknown>);
const idsWhere = (column: string, ids: string[]) =>
  sql`${sql.identifier(column)} in (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`,`,
  )})`;
function decode(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid retained row");
  return Object.fromEntries(
    Object.entries(value).map(([key, value]) => {
      const name = key.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());
      return [
        name,
        typeof value === "string" && (/At$|Until$/.test(name) || name === "scheduledFor")
          ? new Date(value)
          : value,
      ];
    }),
  );
}

/** Shared bounded relational proof for cleanup, historical reads and Doctor. No storage I/O. */
export async function npReadCancelledChangeSetLifecycleV1(input: {
  query: NpCancelledReleaseQueryV1;
  changeSet: ChangeSet;
  source: Body;
  releasedAt: Date;
  beforeStatement?: () => Promise<void>;
}): Promise<NpCancelledReleaseProofV1 | null> {
  const { changeSet: c, source: b, releasedAt } = input;
  const query: NpCancelledReleaseQueryV1 = async (statement) => {
    await input.beforeStatement?.();
    return input.query(statement);
  };
  const load = async <T>(table: string, condition: SQL, limit = 100): Promise<T[] | null> => {
    const from = sql`${sql.identifier(table)} r where ${condition}`;
    const bound = await query(
      sql`select count(*)<=${limit} and coalesce(sum(octet_length(to_jsonb(r)::text)),0)<=8388608 as safe from ${from}`,
    );
    if (bound.rows[0]?.safe !== true) return null;
    const rows = await query(sql`select to_jsonb(r) as body from ${from}`);
    return rows.rows.map((row) => decode(row.body)) as unknown as T[];
  };
  try {
    if (
      c.siteId !== b.siteId ||
      c.state !== "cancelled" ||
      !c.invocationId ||
      !["OPERATOR_CANCELLED", "CHANGESET_EXPIRED"].includes(c.cancellationCode ?? "")
    )
      return null;
    if (c.runId !== null) {
      const creator = await query(
        sql`select agent_id,agent_config_hash,agent_version_id,principal_id,admission_fingerprint from np_agent_runs where site_id=${c.siteId} and id=${c.runId}::uuid limit 1`,
      );
      const run = creator.rows[0];
      if (
        !run ||
        run.agent_id !== c.agentId ||
        run.agent_config_hash !== c.agentConfigHash ||
        run.agent_version_id !== c.agentVersionId ||
        run.principal_id !== c.principalId ||
        run.admission_fingerprint !== c.runFingerprint
      )
        return null;
    }
    const where = sql`site_id=${c.siteId} and changeset_id=${c.id}::uuid`;
    const blockers = await query(sql`select
      exists(select 1 from np_agent_approvals where site_id=${c.siteId} and (target_id=${c.id}::uuid or target_changeset_id=${c.id}::uuid)) or
      exists(select 1 from np_agent_changeset_executions where ${where}) or
      exists(select 1 from np_agent_changeset_rollback_plans where ${where}) or
      exists(select 1 from np_agent_changeset_rollback_operations where ${where}) as blocked`);
    if (blockers.rows[0]?.blocked !== false) return null;
    const operations = await load<typeof npAgentChangesetOperations.$inferSelect>(
      "np_agent_changeset_operations",
      where,
      500,
    );
    const validations = await load<Validation>("np_agent_changeset_validation_attempts", where);
    const previews = await load<Preview>("np_agent_changeset_previews", where);
    if (!operations || !validations || !previews) return null;
    operations.sort((a, b) => a.ordinal - b.ordinal);
    // Earlier ready generations have no guaranteed retained sealed plan. Do not infer their evidence.
    if (
      c.validationGeneration === 0
        ? validations.length !== 0 || previews.length !== 0
        : validations.length !== 1 || validations[0].generation !== c.validationGeneration
    )
      return null;
    const attempt = validations[0];
    if (
      operations.some(
        (o, n) => o.ordinal !== n + 1 || o.siteId !== c.siteId || o.changesetId !== c.id,
      )
    )
      return null;
    if (
      !attempt &&
      operations.some(
        (o) =>
          o.state !== "draft" ||
          o.issues.length !== 0 ||
          o.beforeHash !== null ||
          o.beforeSnapshot !== null ||
          o.snapshotHash !== null ||
          o.afterHash !== null ||
          o.resultDigest !== null,
      )
    )
      return null;

    if (
      attempt &&
      (attempt.draftHash !== c.draftHash ||
        attempt.draftVersion !== c.draftVersion ||
        !["ready", "invalid", "failed"].includes(attempt.state) ||
        !attempt.finishedAt ||
        attempt.finishedAt > releasedAt ||
        attempt.finishedAt < attempt.createdAt ||
        (attempt.state !== "failed" &&
          (!attempt.startedAt ||
            attempt.startedAt > attempt.finishedAt ||
            attempt.errorCode !== null)) ||
        (attempt.state === "failed" && (!attempt.errorCode || attempt.resultDigest !== null)))
    )
      return null;
    if (!(await npVerifyAgentChangeSetPlanEvidenceV1({ changeSet: c, operations, attempt })))
      return null;
    const allIds = [c.id, ...validations.map((v) => v.id), ...previews.map((p) => p.id)];
    for (const preview of previews) {
      if (!attempt || attempt.state !== "ready" || preview.planHash !== c.planHash) return null;
      const child = sql`site_id=${c.siteId} and preview_id=${preview.id}::uuid`;
      const artifacts = await load<typeof npAgentPreviewArtifacts.$inferSelect>(
        "np_agent_preview_artifacts",
        child,
        24,
      );
      const uploads = await load<typeof npAgentPreviewArtifactUploads.$inferSelect>(
        "np_agent_preview_artifact_uploads",
        child,
        24,
      );
      const viewerLaunches = await load<typeof npAgentPreviewViewerLaunches.$inferSelect>(
        "np_agent_preview_viewer_launches",
        child,
      );
      const renderSessions = await load<typeof npAgentPreviewRenderSessions.$inferSelect>(
        "np_agent_preview_render_sessions",
        child,
      );
      if (
        !artifacts ||
        !uploads ||
        !viewerLaunches ||
        !renderSessions ||
        !(await npVerifyCancelledPreviewEvidenceV1({
          changeSet: c,
          preview,
          artifacts,
          uploads,
          viewerLaunches,
          renderSessions,
          releasedAt,
        }))
      )
        return null;
      allIds.push(
        ...[...artifacts, ...uploads, ...viewerLaunches, ...renderSessions].map((row) => row.id),
      );
    }
    const invocationIds = [
      c.invocationId,
      ...validations.map((v) => v.admittingInvocationId),
      ...previews.map((p) => p.admittingInvocationId),
    ];
    if (new Set(invocationIds).size !== invocationIds.length || invocationIds.length > 100)
      return null;
    const invocations = await load<Invocation>(
      "np_agent_invocations",
      sql`site_id=${c.siteId} and ${idsWhere("id", invocationIds)}`,
    );
    const actions = await load<Action>(
      "np_agent_actions",
      sql`site_id=${c.siteId} and ${idsWhere("invocation_id", invocationIds)}`,
    );
    if (
      !invocations ||
      !actions ||
      invocations.length !== invocationIds.length ||
      actions.length !== invocationIds.length
    )
      return null;
    const audits = await load<typeof npAuditEvents.$inferSelect>(
      "np_audit_events",
      sql`site_id=${c.siteId} and ${idsWhere(
        "id",
        invocations.map((i) => i.auditEventId),
      )}`,
    );
    if (!audits || audits.length !== invocations.length) return null;
    const edges: NpCancelledReleaseEdgeV1[] = [];
    const selected: Action[] = [];
    const validationIds: string[] = [];
    const previewIds: string[] = [];
    let creator = false;
    for (const invocation of invocations) {
      const linked = actions.filter((a) => a.invocationId === invocation.id);
      const audit = audits.find((a) => a.id === invocation.auditEventId);
      if (linked.length !== 1 || !audit) return null;
      const action = linked[0],
        ref = invocation.authorityRef;
      if (
        ref.kind !== "runtime-run" ||
        !action.runFingerprint ||
        typeof ref.runId !== "string" ||
        typeof ref.principalId !== "string" ||
        typeof ref.agentVersionId !== "string" ||
        typeof ref.deadlineAt !== "string"
      )
        return null;
      const validation = validations.find((v) => v.admittingInvocationId === invocation.id);
      const preview = previews.find((p) => p.admittingInvocationId === invocation.id);
      if (invocation.id !== c.invocationId && !validation && !preview) return null;
      if (
        (validation && action.capabilityId !== "changeset.validate") ||
        (preview && action.capabilityId !== "changeset.preview") ||
        (invocation.id === c.invocationId && action.capabilityId !== "changeset.create")
      )
        return null;
      const current = ref.runId === b.sourceId;
      const proof = await npVerifyCancelledChangeSetAttributionV1({
        action,
        invocation,
        changeSet: c,
        audit,
        runId: ref.runId,
        runFingerprint: current ? b.admissionFingerprint : action.runFingerprint,
        principalId: current ? b.principalId : ref.principalId,
        agentVersionId: current ? b.agentVersionId : ref.agentVersionId,
        deadlineAt: current ? b.deadlineAt : ref.deadlineAt,
        releasedAt,
        planEvidence: { operations, attempt },
        validation,
        preview,
        ...(current && action.capabilityId === "changeset.create" ? { agentId: b.agentId } : {}),
      });
      if (!proof) return null;
      if (!current) continue;
      selected.push(action);
      const add = (kind: string, id: string, code: string, value: string) =>
        edges.push({ kind, id, code, digest: value });
      add("changeset-action", action.id, "action-run", proof.actionDigest);
      add(
        "changeset-invocation",
        invocation.id,
        "invocation-authority-run",
        proof.invocationDigest,
      );
      add("changeset-audit", audit.id, "audit-changeset", proof.auditDigest);
      if (action.capabilityId === "changeset.create") {
        creator = true;
        add("changeset-source", c.id, "changeset-run", proof.changeSetDigest);
      }
      for (const [row, kind, code] of [
        [validation, "changeset-validation", "validation-authority-run"],
        [preview, "changeset-preview", "preview-authority-run"],
      ] as const) {
        if (!row) continue;
        if (
          (await npDigestAgentAuthorizationContextCanonical(row.authorizationContextBody)) !==
            row.authorizationContextFingerprint ||
          !same(row.authorizationContextBody, invocation.authorizationContextBody)
        )
          return null;
        add(kind, row.id, code, digest(row));
        if (kind === "changeset-validation") validationIds.push(row.id);
        else previewIds.push(row.id);
      }
    }
    if (!selected.length) return null;
    const jobs = await query(sql`select to_regclass('pgboss.job') is not null as present`);
    if (jobs.rows[0]?.present === true) {
      const pending = await query(
        sql`select 1 from pgboss.job where state::text in ('created','retry','active') and (data->>'siteId'=${c.siteId} or data->>'siteId' is null) and (${sql.join(
          allIds.map((id) => sql`position(${id} in data::text)>0`),
          sql` or `,
        )}) limit 1`,
      );
      if (pending.rows.length) return null;
    }
    return { actions: selected, edges, validationIds, previewIds, creator };
  } catch {
    return null;
  }
}
