import { npReadReleasedRunHistoryV1 } from "./released-run-history.js";
import { createAgentCursorCodecV1 } from "./cursor.js";
import {
  and,
  asc,
  eq,
  desc,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  gte,
  or,
  type SQL,
} from "drizzle-orm";
import { npUsers } from "../db/schema/system.js";
import { npResolveLiveAgentStaffAuthorizationV1 } from "./admin-admission.js";
import { npRequireAgentRunLimitsCanonical } from "../agent-contract/canonical-bodies.js";
import { withCurrentSite } from "../sites/context.js";
import { npRequireAgentContractResult } from "../agent-contract/contract.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentPrincipals,
  npAgentRuns,
  npAgentActions,
  npAgentInvocations,
  npAgentChangesetExecutions,
  npAgentProviderCalls,
  npAgentTriggers,
  npAgentApprovals,
  npAgentContainments,
  npAgentIncidentTimeline,
  npAgents,
} from "../db/schema/agent.js";
import {
  npRequireAgentChangeSetApplyCapabilityInputV1,
  npRequireAgentChangeSetScheduleCapabilityInputV1,
  npRequireAgentChangeSetRollbackCapabilityInputV1,
  npRequireAgentChangeSetExecutionOutputV1,
} from "../agent-contract/installed-capability-contract.js";
import { npDigestAgentActionCanonical } from "../agent-contract/canonical-action.js";
import { npDigestAgentInvocationRequestCanonical } from "../agent-contract/canonical-idempotency-request.js";
import {
  npDigestAgentAuthorizationContextCanonical,
  npRequireAgentAuthorizationContextCanonical,
} from "../agent-contract/canonical-authorization-context.js";
import { npDigestAgentRunAdmissionCanonical } from "../agent-contract/canonical-run-admission.js";
import {
  npDigestAgentVerificationResultV1,
  npRequireAgentVerificationChecksV1,
} from "../agent-contract/changeset-execution-contract.js";
import { npRuntimeRunAdmissionBodyV1 } from "./runtime-admission.js";
import {
  npDigestChangeSetExecutionProjectionV1,
  npDigestRuntimeChangeSetCapabilityOutputV1,
} from "./changeset-execution-projection.js";
import { npResolveReleasedActionPrincipalV1 } from "./cancelled-changeset-history.js";
import { npAgentChangeSetActionTargetsV1 } from "./changeset-resources.js";
import type { NpAgentChangeSetActorV1, NpAgentChangeSetServiceV1 } from "./changeset-service.js";
import type { NpAgentApprovalServiceV1 } from "./approval-service.js";
import type { NpAgentIncidentStaffReadServiceV1 } from "./incident-service.js";
import { npRequireIncidentTimelineAssessmentV1 } from "./incident-timeline-assessment.js";
import { npRequireIncidentContainmentFailure } from "./incident-containment-failure.js";
import type { NpAgentApprovalListItemV1 } from "../agent-contract/approval-contract.js";
import { getCollectionConfig, findDocuments } from "../collections/index.js";
import {
  npAgentScopeStaffCapability,
  type NpAgentCapabilityId,
  type NpAgentScope,
} from "../agent-contract/types.js";
import {
  npAnalyzeAgentActivityPrincipalsPageV1,
  npAnalyzeAgentActivityRunsPageV1,
  npAnalyzeAgentActivityActionsPageV1,
  npRequireAgentActivityQueryV1,
  npRequireAgentActivityRunDetailV1,
  npRequireAgentActivityActionDetailV1,
  npAgentActivityProviderCallLimitV1,
  npAgentActivityRunLinkLimitV1,
  type NpAgentActivityKindV1,
  type NpAgentActivityRunDetailV1,
  type NpAgentActivityRunResourceV1,
  type NpAgentActivityRunLinksV1,
  type NpAgentActivityActionDetailV1,
} from "../agent-contract/activity-contract.js";
import { parseActivityRuntimeDiagnosticsV1 } from "../agent-contract/activity-runtime-diagnostics.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npResolveAgentStaffSessionAuthorizationV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
} from "./admin-admission.js";
import { npProjectAgentPrincipalV1 } from "./gateway-service.js";
import type {
  NpAgentCapabilityAdmissionServiceV1,
  NpAgentCapabilityAuthenticationV1,
} from "./capability-admission.js";
import type { NpAuthUser } from "../config/types.js";
import type { NpCapability } from "../auth/capabilities.js";
import type { NpAgentOperatorServiceV1 } from "./operator-service.js";

type Action = typeof npAgentActions.$inferSelect;
type Run = typeof npAgentRuns.$inferSelect;
type IncidentTimeline = typeof npAgentIncidentTimeline.$inferSelect;
type Execution = typeof npAgentChangesetExecutions.$inferSelect;
type ActionEvidence = Pick<NpAgentActivityActionDetailV1, "changeSetId" | "verificationResult"> & {
  approvalId?: string;
  includeDetail?: true;
  includeRelated?: true;
  relatedApprovalId?: string;
};
type Db = ReturnType<typeof getDb>;
type Invocation = Pick<
  typeof npAgentInvocations.$inferSelect,
  "id" | "principalId" | "expiresAt" | "auditEventId" | "operationId" | "authorizationContextBody"
>;
interface Staff {
  siteId: string;
  actor: NpAgentAdminActorV1;
}
type IncidentReader = { readIncident?: NpAgentIncidentStaffReadServiceV1["get"] };
type RunsQuery = Staff &
  IncidentReader & {
    query?: unknown;
  };

const incidentActionJoin = and(
  eq(npAgentActions.siteId, npAgentIncidentTimeline.siteId),
  eq(npAgentActions.id, npAgentIncidentTimeline.actionId),
);

function incidentRunLinks(
  runId: string | typeof npAgentRuns.id,
  fingerprint: string | typeof npAgentRuns.admissionFingerprint,
  incidentId?: string,
) {
  return and(
    incidentId ? eq(npAgentIncidentTimeline.incidentId, incidentId) : undefined,
    or(
      and(
        eq(npAgentIncidentTimeline.kind, "agent_assessment"),
        eq(npAgentIncidentTimeline.runId, runId),
      ),
      and(
        eq(npAgentIncidentTimeline.kind, "action"),
        eq(npAgentIncidentTimeline.sourceKind, "system"),
        or(isNull(npAgentIncidentTimeline.runId), eq(npAgentIncidentTimeline.runId, runId)),
        eq(npAgentActions.runId, runId),
        eq(npAgentActions.runFingerprint, fingerprint),
        eq(npAgentIncidentTimeline.sourceFingerprint, npAgentActions.inputHash),
      ),
    ),
  );
}
interface Visibility {
  user: NpAuthUser;
  capabilities: readonly NpCapability[];
  actor: NpAgentChangeSetActorV1;
}
export interface NpAgentActivityServiceOptionsV1 {
  cursorHmacKey: Uint8Array;
  admission?: NpAgentCapabilityAdmissionServiceV1;
  /** Explicit current-viewer/target-authorized Operator review owner. */
  operator?: Pick<NpAgentOperatorServiceV1, "projectActivity"> &
    Partial<Pick<NpAgentOperatorServiceV1, "projectRunActivity" | "projectRunRetrySource">>;
  /** Explicit current-item authorization through the existing ChangeSet service. */
  changesets?: Pick<NpAgentChangeSetServiceV1, "get"> &
    Partial<Pick<NpAgentChangeSetServiceV1, "approvals" | "refreshGatewayInvocation">>;
  /** Current approval reader when the host installs approvals separately. */
  approvals?: Pick<NpAgentApprovalServiceV1, "get">;
  now?: () => Date;
}
const missing = () =>
  new NpAgentGatewayError("ACTIVITY_NOT_FOUND", 404, "Activity is unavailable.");
const invalidCursor = () =>
  new NpAgentGatewayError("ACTIVITY_CURSOR_INVALID", 400, "Activity cursor is invalid.");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const iso = (v: Date | null) => v?.toISOString() ?? null;

/** Explicit host installation; no runtime, transport or scheduler is created here. */
export function createAgentActivityServiceV1(options: NpAgentActivityServiceOptionsV1) {
  if (!(options.cursorHmacKey instanceof Uint8Array) || options.cursorHmacKey.byteLength < 32)
    throw new Error("Activity cursor key requires at least 32 bytes.");
  const cursorCodec = createAgentCursorCodecV1(options.cursorHmacKey, "np.agent-activity.cursor");
  const now = options.now ?? (() => new Date());
  const mac = cursorCodec.mac;
  async function staff(input: Staff) {
    const auth = await npResolveAgentStaffSessionAuthorizationV1(
      getDb(),
      input.siteId,
      input.actor,
      now(),
    );
    if (!auth.authority.capabilities.includes("admin.manage"))
      throw new NpAgentGatewayError("ACTIVITY_FORBIDDEN", 403, "Activity permission is required.");
    return {
      auth,
      visibility: {
        actor: { kind: "staff", siteId: input.siteId, actor: input.actor },
        user: {
          ...input.actor.user,
          role:
            auth.authority.kind === "super-admin"
              ? "admin"
              : (auth.authority.role as NpAuthUser["role"]),
        },
        capabilities: auth.authority.capabilities,
      } satisfies Visibility,
    };
  }
  async function assertSameStaff(
    input: Staff,
    previous: Awaited<ReturnType<typeof staff>>["auth"],
  ) {
    const current = await staff(input);
    if (serializeAgentCanonicalJson(current.auth) !== serializeAgentCanonicalJson(previous))
      throw new NpAgentGatewayError("ACTIVITY_FORBIDDEN", 403, "Activity permission is required.");
  }
  async function invocation(siteId: string, id: string | null, db: Pick<Db, "select"> = getDb()) {
    if (!id) return null;
    const [row] = await db
      .select({
        id: npAgentInvocations.id,
        principalId: npAgentInvocations.principalId,
        expiresAt: npAgentInvocations.expiresAt,
        auditEventId: npAgentInvocations.auditEventId,
        operationId: npAgentInvocations.operationId,
        authorizationContextBody: npAgentInvocations.authorizationContextBody,
      })
      .from(npAgentInvocations)
      .where(and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, id)))
      .limit(1);
    return row ?? null;
  }
  async function collectionVisible(collection: string, visibility: Visibility) {
    try {
      const config = getCollectionConfig(collection);
      return !config.access?.read || Boolean(await config.access.read({ user: visibility.user }));
    } catch {
      return false;
    }
  }
  async function actionVisible(row: Action, visibility: Visibility, evidence?: ActionEvidence) {
    if (
      !row.requiredScopes.every((scope) =>
        visibility.capabilities.includes(npAgentScopeStaffCapability[scope]),
      )
    )
      return false;
    if (
      options.operator &&
      row.outputHash &&
      ["ops.status", "audit.run", "ops.plan", "ops.execute"].includes(row.capabilityId)
    ) {
      if (visibility.actor.kind !== "staff") return false;
      try {
        await options.operator.projectActivity({
          siteId: row.siteId,
          actor: visibility.actor.actor,
          actionId: row.id,
        });
        return true;
      } catch {
        return false;
      }
    }
    if (
      [
        "changeset.create",
        "changeset.validate",
        "changeset.preview",
        "changeset.apply",
        "changeset.schedule",
      ].includes(row.capabilityId) &&
      row.runSourceReleaseId !== null
    ) {
      const changeSetId = ["changeset.apply", "changeset.schedule"].includes(row.capabilityId)
        ? row.inputCanonical.changeSetId
        : row.outputRedacted?.changeSetId;
      if (!options.changesets || typeof changeSetId !== "string") return false;
      try {
        const detail = await options.changesets.get({
          actor: visibility.actor,
          id: changeSetId,
        });
        return detail.siteId === row.siteId && detail.id === changeSetId;
      } catch {
        return false;
      }
    }
    if (["changeset.apply", "changeset.schedule", "changeset.rollback"].includes(row.capabilityId))
      return changeSetActionVisible(row, visibility, evidence);
    // Read capabilities historically have no targetRefs. Their exact selector still gates visibility.
    if (
      row.capabilityId === "content.query" ||
      (row.capabilityId === "schema.get" && row.inputCanonical.selector === "collection")
    ) {
      const collection =
        row.capabilityId === "schema.get" ? row.inputCanonical.slug : row.inputCanonical.collection;
      if (typeof collection !== "string" || !(await collectionVisible(collection, visibility)))
        return false;
    }
    for (const target of row.targetRefs) {
      if (target.kind !== "document") return false; // Future target families require their existing domain visibility facade.
      if (!(await collectionVisible(target.collection, visibility))) return false;
      try {
        const result = await withCurrentSite(row.siteId, () =>
          findDocuments(
            target.collection,
            { limit: 1, where: { id: target.documentId, siteId: row.siteId } },
            visibility.user,
          ),
        );
        if (!result.docs.length) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  function digestAction(row: Action) {
    return npDigestAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId: row.siteId,
      actionId: row.id,
      invocationFingerprint: row.invocationFingerprint,
      runFingerprint: row.runFingerprint,
      sequence: row.sequence,
      capabilityId: row.capabilityId,
      capabilityContractVersion: row.capabilityContractVersion,
      capabilityFingerprint: row.capabilityFingerprint,
      effectProfile: { id: row.effectProfileId, contractVersion: row.effectContractVersion },
      risk: row.risk,
      requiredScopes: row.requiredScopes,
      targetRefs: row.targetRefs,
      targetVersionFacts: row.targetVersionFacts,
      input: row.inputCanonical,
    });
  }
  async function boundChangeSetInvocation(row: Action) {
    if (!row.invocationId || !row.runId) return;
    const [inv] = await getDb()
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, row.siteId), eq(npAgentInvocations.id, row.invocationId)),
      )
      .limit(1);
    const [run] = await getDb()
      .select()
      .from(npAgentRuns)
      .where(and(eq(npAgentRuns.siteId, row.siteId), eq(npAgentRuns.id, row.runId)))
      .limit(1);
    if (
      !inv ||
      !run ||
      inv.operationKind !== "capability" ||
      inv.operationId !== row.capabilityId ||
      inv.runId !== run.id ||
      run.principalId !== inv.principalId ||
      row.invocationFingerprint !== inv.requestHash ||
      row.runFingerprint !== run.admissionFingerprint
    )
      return;
    if (run.origin === "gateway") {
      if (run.invocationId !== inv.id) return;
    } else {
      const context = npRequireAgentAuthorizationContextCanonical(inv.authorizationContextBody);
      if (
        inv.transport !== "runtime" ||
        context.transport !== "runtime" ||
        context.siteId !== row.siteId ||
        context.actor.kind !== "principal" ||
        context.actor.principalId !== run.principalId ||
        context.authorityRef.kind !== "runtime-run" ||
        context.authorityRef.principalId !== run.principalId ||
        context.authorityRef.runId !== run.id ||
        context.authorityRef.agentVersionId !== run.agentVersionId ||
        context.authorityRef.deadlineAt !== run.deadlineAt.toISOString() ||
        (await npDigestAgentAuthorizationContextCanonical(context)) !==
          inv.authorizationContextFingerprint
      )
        return;
    }
    const hash = await digestAction(row);
    if (
      hash !== row.inputHash ||
      (await npDigestAgentInvocationRequestCanonical(inv.requestBody)) !== inv.requestHash ||
      serializeAgentCanonicalJson(inv.requestBody.input) !==
        serializeAgentCanonicalJson(row.inputCanonical) ||
      serializeAgentCanonicalJson(inv.capabilityDefinitionBody) !==
        serializeAgentCanonicalJson(row.capabilityDefinitionBody)
    )
      return;
    return { inv, run };
  }
  async function changeSetActionVisible(
    row: Action,
    visibility: Visibility,
    evidence?: ActionEvidence,
  ): Promise<boolean> {
    if (!options.changesets || !row.invocationId || !row.runId) return false;
    try {
      const input =
        row.capabilityId === "changeset.apply"
          ? npRequireAgentChangeSetApplyCapabilityInputV1(row.inputCanonical)
          : row.capabilityId === "changeset.schedule"
            ? npRequireAgentChangeSetScheduleCapabilityInputV1(row.inputCanonical)
            : npRequireAgentChangeSetRollbackCapabilityInputV1(row.inputCanonical);
      const bound = await boundChangeSetInvocation(row);
      if (!bound || bound.inv.resultId !== input.changeSetId) return false;
      const { inv, run } = bound;
      const executions = await getDb()
        .select()
        .from(npAgentChangesetExecutions)
        .where(
          and(
            eq(npAgentChangesetExecutions.siteId, row.siteId),
            eq(npAgentChangesetExecutions.invocationId, inv.id),
          ),
        )
        .limit(2);
      if (
        executions.length > 1 ||
        executions.some(
          (execution) =>
            execution.changesetId !== input.changeSetId ||
            execution.invocationFingerprint !== inv.requestHash ||
            execution.purpose !==
              (row.capabilityId === "changeset.rollback" ? "rollback" : "apply") ||
            ("planHash" in input && execution.planHash !== input.planHash) ||
            ("approvalId" in input && execution.approvalId !== input.approvalId) ||
            ("rollbackPlanId" in input && execution.rollbackPlanId !== input.rollbackPlanId),
        )
      )
        return false;
      const changeSet = await options.changesets.get({
        actor: visibility.actor,
        id: input.changeSetId,
      });
      const visible =
        changeSet.id === input.changeSetId &&
        changeSet.siteId === row.siteId &&
        serializeAgentCanonicalJson(
          npAgentChangeSetActionTargetsV1(
            changeSet.operations.map((operation) => operation.canonicalResourceKey),
          ),
        ) === serializeAgentCanonicalJson(row.targetRefs);
      if (
        visible &&
        !row.approvalId &&
        (row.state === "approval_pending" ||
          (evidence?.includeRelated && row.outputRedacted?.state === "approval_required"))
      ) {
        if (
          !row.outputRedacted ||
          row.outputHash !== npDigestChangeSetExecutionProjectionV1(row.outputRedacted)
        )
          return false;
        const output = npRequireAgentChangeSetExecutionOutputV1(row.outputRedacted);
        if (
          output.state !== "approval_required" ||
          output.actionId !== row.id ||
          output.runId !== run.id ||
          output.changeSet.id !== changeSet.id ||
          output.changeSet.siteId !== row.siteId ||
          !("planHash" in input) ||
          output.proposalHash !== input.planHash ||
          inv.outputRedacted?.approvalId !== output.approvalId
        )
          return false;
        const [approval] = await getDb()
          .select({ id: npAgentApprovals.id })
          .from(npAgentApprovals)
          .where(
            and(
              eq(npAgentApprovals.siteId, row.siteId),
              eq(npAgentApprovals.id, output.approvalId),
              eq(npAgentApprovals.requestedByPrincipalId, run.principalId),
              eq(npAgentApprovals.targetChangesetId, changeSet.id),
              eq(npAgentApprovals.planHash, input.planHash),
              eq(npAgentApprovals.capabilityId, row.capabilityId),
              eq(npAgentApprovals.capabilityFingerprint, row.capabilityFingerprint),
              "rollbackPlanId" in input
                ? eq(npAgentApprovals.targetRollbackPlanId, input.rollbackPlanId)
                : undefined,
            ),
          )
          .limit(1);
        if (!approval) return false;
        if (evidence) {
          if (row.state === "approval_pending") evidence.approvalId = approval.id;
          evidence.relatedApprovalId = approval.id;
        }
      }
      if (visible && evidence?.includeRelated) {
        evidence.changeSetId = changeSet.id;
        if (executions[0]?.approvalId && executions[0].approvalId === row.approvalId)
          evidence.relatedApprovalId = row.approvalId;
      }
      if (visible && evidence?.includeDetail) {
        evidence.changeSetId = changeSet.id;
        if (executions[0]) {
          const verification = await changeSetVerification(executions[0]);
          if (verification) evidence.verificationResult = verification;
        }
      }
      return visible;
    } catch {
      return false;
    }
  }
  async function runtimeActionMatchesChangeSet(row: Action, visibility: Visibility, id: string) {
    const capability = row.capabilityId;
    if (
      !options.changesets ||
      (capability !== "changeset.create" &&
        capability !== "changeset.validate" &&
        capability !== "changeset.preview") ||
      row.outputRedacted?.changeSetId !== id ||
      row.state !== "succeeded"
    )
      return false;
    try {
      if (row.outputHash !== npDigestRuntimeChangeSetCapabilityOutputV1(row.outputRedacted))
        return false;
      const binding = await boundChangeSetInvocation(row);
      if (binding?.run.origin !== "runtime" || binding.inv.resultId !== id) return false;
      const current = await options.changesets.get({ actor: visibility.actor, id });
      return current.id === id && current.siteId === row.siteId;
    } catch {
      return false;
    }
  }
  async function changeSetVerification(
    execution: Execution,
  ): Promise<ActionEvidence["verificationResult"]> {
    const state = execution.verificationState;
    if (state === "queued" || state === "running") {
      return { state, completedAt: null, digest: null };
    }
    if (
      (state !== "passed" && state !== "failed") ||
      !execution.verificationCompletedAt ||
      !execution.verificationDigest
    )
      return;
    try {
      const checks = npRequireAgentVerificationChecksV1(execution.verificationBody);
      const digest = await npDigestAgentVerificationResultV1({
        ...(execution.purpose === "rollback"
          ? { purpose: "rollback", rollbackPlanId: execution.rollbackPlanId }
          : {}),
        siteId: execution.siteId,
        changeSetId: execution.changesetId,
        executionId: execution.id,
        verificationContractFingerprint: execution.verificationContractFingerprint,
        checks,
      });
      if (
        digest === execution.verificationDigest &&
        (state === "passed") ===
          checks.every((check) => !check.required || check.status === "passed")
      ) {
        return { state, completedAt: execution.verificationCompletedAt.toISOString(), digest };
      }
    } catch {
      return;
    }
  }
  async function actionOwner(row: Action, inv: Invocation | null) {
    if (row.runSourceReleaseId !== null) {
      if (row.runId !== null || !row.runFingerprint || !inv) return null;
      try {
        const principalId = await npResolveReleasedActionPrincipalV1({
          db: getDb(),
          action: row,
        });
        return principalId === inv.principalId ? principalId : null;
      } catch {
        return null;
      }
    }
    if (!row.runId) return row.runFingerprint === null ? (inv?.principalId ?? null) : null;
    if (!row.runFingerprint) return null;
    const [run] = await getDb()
      .select({ principalId: npAgentRuns.principalId })
      .from(npAgentRuns)
      .where(and(eq(npAgentRuns.siteId, row.siteId), eq(npAgentRuns.id, row.runId)))
      .limit(1);
    if (!run || (inv?.principalId && inv.principalId !== run.principalId)) return null;
    return run.principalId;
  }
  function actionDetail(
    row: Action,
    inv: Invocation | null,
    principalId: string,
    approvalId = row.approvalId,
  ): NpAgentActivityActionDetailV1 {
    return npRequireAgentActivityActionDetailV1({
      schemaVersion: "np.agent-activity-action.v1",
      principalId,
      invocationId: row.invocationId,
      evidence:
        row.runSourceReleaseId !== null || (inv && inv.expiresAt <= now()) ? "expired" : "redacted",
      inputHash: row.inputHash,
      outputHash: row.outputHash,
      auditEventId: row.auditEventId,
      action: {
        schemaVersion: "np.agent-action-projection.v1",
        id: row.id,
        siteId: row.siteId,
        runId: row.runId,
        sequence: row.sequence,
        capabilityId: row.capabilityId,
        capabilityContractVersion: row.capabilityContractVersion,
        capabilityFingerprint: row.capabilityFingerprint,
        effectProfile: { id: row.effectProfileId, contractVersion: row.effectContractVersion },
        risk: row.risk,
        state: row.state,
        inputRedacted: {},
        outputRedacted: ["succeeded", "compensated"].includes(row.state) ? {} : null,
        requiredScopes: row.requiredScopes,
        targetRefs: row.targetRefs,
        proposalHash: row.inputHash,
        approvalId,
        verificationState: row.verificationState,
        errorCode: row.errorCode === null ? null : "ACTION_FAILED",
        createdAt: iso(row.createdAt),
        startedAt: row.state === "approval_pending" ? null : iso(row.startedAt),
        finishedAt: iso(row.finishedAt),
      },
    });
  }
  async function* runActions(row: Run) {
    let after: string | null = null;
    const maximum = npRequireAgentRunLimitsCanonical(row.runLimits).maxCapabilityCalls;
    let scanned = 0;
    for (;;) {
      const rows = await getDb()
        .select()
        .from(npAgentActions)
        .where(
          and(
            eq(npAgentActions.siteId, row.siteId),
            or(
              eq(npAgentActions.runId, row.id),
              row.invocationId ? eq(npAgentActions.invocationId, row.invocationId) : undefined,
            ),
            after ? gt(npAgentActions.id, after) : undefined,
          ),
        )
        .orderBy(npAgentActions.id)
        .limit(100);
      for (const action of rows) {
        if (++scanned > maximum) throw missing();
        yield action;
      }
      if (rows.length < 100) return;
      after = rows[rows.length - 1].id;
    }
  }
  function approvalMatchesRunAction(
    approval: NpAgentApprovalListItemV1,
    action: Action,
    evidence: ActionEvidence | undefined,
  ) {
    if (
      approval.capabilityId !== action.capabilityId ||
      approval.capabilityContractVersion !== action.capabilityContractVersion ||
      approval.capabilityFingerprint !== action.capabilityFingerprint
    )
      return false;
    const target = approval.target;
    return target.kind === "action"
      ? target.runId === action.runId &&
          target.actionId === action.id &&
          target.proposalHash === action.inputHash
      : evidence?.relatedApprovalId === approval.approval.id &&
          evidence.changeSetId === target.changeSetId;
  }
  async function runVisible(
    row: Run,
    visibility: Visibility,
    requirements: {
      allowedScopes?: readonly NpAgentScope[];
      capabilityId?: NpAgentCapabilityId;
      approval?: NpAgentApprovalListItemV1;
      changeSetId?: string;
      actions?: Action[];
    } = {},
  ) {
    const { allowedScopes, capabilityId, approval, changeSetId, actions } = requirements;
    const approvalTarget = approval?.target;
    let matchesCapability = !capabilityId;
    let matchesApproval = !approval;
    let matchesChangeSet = !changeSetId;
    for await (const action of runActions(row)) {
      if (allowedScopes && action.requiredScopes.some((scope) => !allowedScopes.includes(scope)))
        return false;
      const bound = action.runId === row.id && action.runFingerprint === row.admissionFingerprint;
      const evidence: ActionEvidence | undefined =
        bound && (!matchesChangeSet || (!matchesApproval && approvalTarget?.kind !== "action"))
          ? { includeRelated: true }
          : undefined;
      if (!(await actionVisible(action, visibility, evidence))) return false;
      if (!bound) continue;
      actions?.push(action);
      if (action.capabilityId === capabilityId) matchesCapability = true;
      if (!matchesChangeSet && changeSetId)
        matchesChangeSet =
          evidence?.changeSetId === changeSetId ||
          (row.origin === "runtime" &&
            (await runtimeActionMatchesChangeSet(action, visibility, changeSetId)));
      if (!matchesApproval && approval)
        matchesApproval = approvalMatchesRunAction(approval, action, evidence);
    }
    return matchesCapability && matchesApproval && matchesChangeSet;
  }

  async function verifiedIncidentLink(entry: IncidentTimeline, action: Action | null) {
    try {
      if (entry.kind === "agent_assessment") {
        await npRequireIncidentTimelineAssessmentV1(getDb(), entry);
        return true;
      }
      return !!action && (await incidentActionMatches(entry, action));
    } catch {
      return false;
    }
  }

  async function incidentActionMatches(entry: IncidentTimeline, action: Action) {
    if (!entry.auditEventId || !action.runId || (await digestAction(action)) !== action.inputHash)
      return false;
    const db = getDb();
    if (entry.details.schemaVersion === "np.agent-incident-containment-failure-entry.v1") {
      const proof = await npRequireIncidentContainmentFailure({
        db,
        siteId: entry.siteId,
        incidentId: entry.incidentId,
        actionId: action.id,
        auditEventId: entry.auditEventId,
      });
      return (
        entry.details.executionInvocationId === proof.execution.id &&
        entry.details.phase === "failed" &&
        entry.details.outcome === "rolled_back"
      );
    }
    if (
      entry.details.schemaVersion !== "np.agent-incident-containment-entry.v1" ||
      !action.containmentId ||
      entry.details.containmentId !== action.containmentId ||
      !action.executionInvocationId ||
      !action.executionInvocationFingerprint ||
      !action.targetVersionDigest ||
      entry.details.targetVersionDigest !== action.targetVersionDigest ||
      action.verificationState !== "passed"
    )
      return false;
    const phase = entry.details.phase;
    const link =
      phase === "quarantined" &&
      action.capabilityId === "moderation.quarantine" &&
      (action.state === "succeeded" || action.state === "compensated")
        ? npAgentContainments.sourceActionId
        : phase === "restored" &&
            action.capabilityId === "moderation.restore" &&
            action.state === "compensated"
          ? npAgentContainments.restoreActionId
          : null;
    if (!link) return false;
    const [proof] = await db
      .select({ request: npAgentInvocations.requestBody, hash: npAgentInvocations.requestHash })
      .from(npAgentContainments)
      .innerJoin(
        npAgentInvocations,
        and(
          eq(npAgentInvocations.siteId, npAgentContainments.siteId),
          eq(npAgentInvocations.id, action.executionInvocationId),
          eq(npAgentInvocations.runId, action.runId),
          eq(npAgentInvocations.resultId, action.id),
          eq(npAgentInvocations.state, "completed"),
          eq(npAgentInvocations.requestHash, action.executionInvocationFingerprint),
          eq(npAgentInvocations.auditEventId, entry.auditEventId),
        ),
      )
      .where(
        and(
          eq(npAgentContainments.siteId, entry.siteId),
          eq(npAgentContainments.incidentId, entry.incidentId),
          eq(npAgentContainments.id, action.containmentId),
          eq(link, action.id),
        ),
      )
      .limit(1);
    return (
      !!proof &&
      proof.request.input?.actionId === action.id &&
      (await npDigestAgentInvocationRequestCanonical(proof.request)) === proof.hash
    );
  }

  async function incidentRunMatches(run: Run, incidentId: string) {
    const db = getDb();
    let after = 0;
    for (;;) {
      const sources = await db
        .select({ entry: npAgentIncidentTimeline, action: npAgentActions })
        .from(npAgentIncidentTimeline)
        .leftJoin(npAgentActions, incidentActionJoin)
        .where(
          and(
            eq(npAgentIncidentTimeline.siteId, run.siteId),
            incidentRunLinks(run.id, run.admissionFingerprint, incidentId),
            gt(npAgentIncidentTimeline.sequence, after),
          ),
        )
        .orderBy(asc(npAgentIncidentTimeline.sequence))
        .limit(50);
      for (const { entry, action } of sources)
        if (await verifiedIncidentLink(entry, action)) return true;
      if (sources.length < 50) return false;
      after = sources[sources.length - 1].entry.sequence;
    }
  }

  async function canReadIncident(input: Staff & IncidentReader, id: string) {
    try {
      const result = await input.readIncident?.(
        { incidentId: id },
        { siteId: input.siteId, actor: input.actor },
      );
      return result?.incident.id === id && result.incident.siteId === input.siteId;
    } catch (error) {
      if (error instanceof NpAgentGatewayError && [403, 404].includes(error.status)) return false;
      throw error;
    }
  }

  async function relatedIncidentIds(input: Staff & IncidentReader, run: Run, actions: Action[]) {
    if (!input.readIncident) return [];
    const db = getDb();
    const incidentIds = new Set<string>();
    const restores = new Set<string>();
    for (const action of actions) {
      const incidentId = action.inputCanonical.incidentId;
      if (
        action.capabilityId === "moderation.quarantine" &&
        typeof incidentId === "string" &&
        uuid.test(incidentId)
      )
        incidentIds.add(incidentId);
      if (action.capabilityId === "moderation.restore" && action.containmentId)
        restores.add(action.containmentId);
    }
    if (restores.size) {
      const rows = await db
        .select({ incidentId: npAgentContainments.incidentId })
        .from(npAgentContainments)
        .where(
          and(
            eq(npAgentContainments.siteId, run.siteId),
            inArray(npAgentContainments.id, [...restores]),
          ),
        );
      for (const row of rows) if (row.incidentId) incidentIds.add(row.incidentId);
    }
    if (!run.agentId && !incidentIds.size) return [];

    // Narrow the reverse lookup by the existing site/source and site/incident indexes.
    // These are candidate selectors. The stored relationship and viewer still need proof.
    const sources = await db
      .select({ entry: npAgentIncidentTimeline, action: npAgentActions })
      .from(npAgentIncidentTimeline)
      .leftJoin(npAgentActions, incidentActionJoin)
      .where(
        and(
          eq(npAgentIncidentTimeline.siteId, run.siteId),
          incidentRunLinks(run.id, run.admissionFingerprint),
          or(
            run.agentId
              ? and(
                  eq(npAgentIncidentTimeline.kind, "agent_assessment"),
                  eq(npAgentIncidentTimeline.sourceId, run.agentId),
                )
              : undefined,
            incidentIds.size
              ? and(
                  eq(npAgentIncidentTimeline.kind, "action"),
                  inArray(npAgentIncidentTimeline.incidentId, [...incidentIds]),
                )
              : undefined,
          ),
        ),
      )
      .orderBy(desc(npAgentIncidentTimeline.createdAt), desc(npAgentIncidentTimeline.id))
      .limit(50);
    const checked = new Set<string>();
    const visible: string[] = [];
    for (const { entry, action } of sources) {
      const id = entry.incidentId;
      if (checked.has(id) || !(await verifiedIncidentLink(entry, action))) continue;
      checked.add(id);
      if (await canReadIncident(input, id).catch(() => false)) visible.push(id);
      if (visible.length === npAgentActivityRunLinkLimitV1) break;
    }
    return visible;
  }

  async function relatedRunRecords(
    input: Staff & IncidentReader,
    run: Run,
    visibility: Visibility,
    actions: Action[],
  ): Promise<NpAgentActivityRunLinksV1 | undefined> {
    const limit = npAgentActivityRunLinkLimitV1;
    const candidates = actions.slice(0, 50);
    const incidentIds = await relatedIncidentIds(input, run, candidates);
    const approvalIds = new Set<string>();
    const changeSetIds = new Set<string>();
    const approvals = options.approvals ?? options.changesets?.approvals;
    if (approvals || options.changesets) {
      for (const action of candidates) {
        const evidence: ActionEvidence = { includeRelated: true };
        if (
          action.capabilityId.startsWith("changeset.") &&
          !(await actionVisible(action, visibility, evidence))
        )
          continue;
        let changeSetId = evidence.changeSetId;
        const outputId = action.outputRedacted?.changeSetId;
        if (
          !changeSetId &&
          changeSetIds.size < limit &&
          run.origin === "runtime" &&
          typeof outputId === "string" &&
          uuid.test(outputId) &&
          (await runtimeActionMatchesChangeSet(action, visibility, outputId))
        )
          changeSetId = outputId;
        if (changeSetId && changeSetIds.size < limit) changeSetIds.add(changeSetId);

        const approvalId = evidence.relatedApprovalId ?? action.approvalId;
        if (approvals && approvalId && !approvalIds.has(approvalId) && approvalIds.size < limit) {
          try {
            const { item } = await approvals.get({
              siteId: input.siteId,
              actor: input.actor,
              id: approvalId,
            });
            if (
              item.approval.id === approvalId &&
              approvalMatchesRunAction(item, action, evidence) &&
              (item.target.kind !== "action" || (await digestAction(action)) === action.inputHash)
            )
              approvalIds.add(approvalId);
          } catch {
            // A related record may no longer be available to the current viewer.
          }
        }
        if (approvalIds.size === limit && changeSetIds.size === limit) break;
      }
    }
    if (incidentIds.length || approvalIds.size || changeSetIds.size)
      return { incidentIds, approvalIds: [...approvalIds], changeSetIds: [...changeSetIds] };
  }
  async function refreshRun(row: Run): Promise<Run> {
    if (
      row.origin !== "gateway" ||
      !["queued", "running", "waiting_approval", "waiting_retry", "verifying"].includes(
        row.state,
      ) ||
      !row.invocationId ||
      !options.changesets?.refreshGatewayInvocation
    )
      return row;
    const inv = await invocation(row.siteId, row.invocationId);
    if (
      !inv ||
      !["changeset.apply", "changeset.schedule", "changeset.rollback"].includes(inv.operationId)
    )
      return row;
    try {
      await options.changesets.refreshGatewayInvocation({
        siteId: row.siteId,
        invocationId: inv.id,
      });
    } catch {
      throw missing();
    }
    const [current] = await getDb()
      .select()
      .from(npAgentRuns)
      .where(and(eq(npAgentRuns.siteId, row.siteId), eq(npAgentRuns.id, row.id)))
      .limit(1);
    if (
      !current ||
      current.invocationId !== row.invocationId ||
      current.principalId !== row.principalId
    )
      throw missing();
    return current;
  }
  function runDetail(row: Run, inv: Invocation | null): NpAgentActivityRunDetailV1 {
    try {
      return npRequireAgentActivityRunDetailV1({
        schemaVersion: "np.agent-activity-run.v1",
        invocationId: row.invocationId,
        evidence: inv && inv.expiresAt <= now() ? "expired" : "redacted",
        auditEventIds: inv ? [inv.auditEventId] : [],
        run: {
          schemaVersion: "np.agent-run.v1",
          id: row.id,
          siteId: row.siteId,
          origin: row.origin,
          agent:
            row.agentId && row.agentVersionId
              ? { id: row.agentId, versionId: row.agentVersionId }
              : null,
          principalId: row.principalId,
          rootRunId: row.rootRunId,
          parentRunId: row.parentRunId,
          causalDepth: row.causalDepth,
          state: row.state,
          goal: "[redacted]",
          runLimits: row.runLimits,
          usage:
            row.origin === "gateway"
              ? {
                  inputTokens: 0,
                  cachedInputTokens: 0,
                  outputTokens: 0,
                  costMicros: 0,
                  ...row.usage,
                }
              : Object.keys(row.usage).length === 0
                ? null
                : row.usage,
          attempt: row.attempt,
          errorCode: row.errorCode === null ? null : "RUN_FAILED",
          errorMessage: row.errorCode === null ? null : "Run did not complete successfully.",
          queuedAt: iso(row.queuedAt),
          deadlineAt: iso(row.deadlineAt),
          startedAt: iso(row.startedAt),
          finishedAt: iso(row.finishedAt),
        },
      });
    } catch {
      // Malformed evidence remains unavailable; an exact empty Runtime usage
      // marker projects as unknown rather than hiding the entire Run.
      throw missing();
    }
  }
  async function runtimeDiagnostics(
    db: Pick<Db, "select">,
    row: Run,
    run: NpAgentActivityRunDetailV1["run"],
  ) {
    const calls = await db
      .select({
        sequence: npAgentProviderCalls.sequence,
        provider: npAgentProviderCalls.provider,
        model: npAgentProviderCalls.model,
        state: npAgentProviderCalls.state,
        dispatchState: npAgentProviderCalls.dispatchState,
        errorClass: npAgentProviderCalls.errorClass,
        latencyMs: npAgentProviderCalls.latencyMs,
        inputTokens: npAgentProviderCalls.inputTokens,
        cachedInputTokens: npAgentProviderCalls.cachedInputTokens,
        outputTokens: npAgentProviderCalls.outputTokens,
        tokenSource: npAgentProviderCalls.usageSource,
        costMicros: npAgentProviderCalls.costMicros,
        costSource: npAgentProviderCalls.costSource,
        startedAt: npAgentProviderCalls.startedAt,
        finishedAt: npAgentProviderCalls.finishedAt,
      })
      .from(npAgentProviderCalls)
      .where(
        and(eq(npAgentProviderCalls.siteId, row.siteId), eq(npAgentProviderCalls.runId, row.id)),
      )
      .orderBy(desc(npAgentProviderCalls.sequence))
      .limit(npAgentActivityProviderCallLimitV1 + 1);
    const [trigger] =
      row.triggerId && row.agentId && row.agentVersionId
        ? await db
            .select({
              id: npAgentTriggers.id,
              kind: npAgentTriggers.kind,
              eventKind: npAgentTriggers.eventType,
            })
            .from(npAgentTriggers)
            .where(
              and(
                eq(npAgentTriggers.siteId, row.siteId),
                eq(npAgentTriggers.id, row.triggerId),
                eq(npAgentTriggers.agentId, row.agentId),
                eq(npAgentTriggers.agentVersionId, row.agentVersionId),
              ),
            )
            .limit(1)
        : [];
    if (row.triggerId && !trigger) return null;
    let policyRefs = null;
    try {
      const admission = npRuntimeRunAdmissionBodyV1(row);
      if ((await npDigestAgentRunAdmissionCanonical(admission)) === row.admissionFingerprint)
        policyRefs = admission.policyRefs;
    } catch {
      // A malformed historical admission cannot establish which policies were bound.
    }
    try {
      return parseActivityRuntimeDiagnosticsV1(
        {
          trigger: trigger
            ? { ...trigger, scheduledFor: row.eventRef?.scheduledFor ?? null }
            : null,
          retryAt: iso(row.runtimeRetryAt),
          policyRefs,
          providerCalls: calls
            .slice(0, npAgentActivityProviderCallLimitV1)
            .map(
              ({
                inputTokens,
                cachedInputTokens,
                outputTokens,
                tokenSource,
                costMicros,
                costSource,
                startedAt,
                finishedAt,
                ...call
              }) => ({
                ...call,
                usage:
                  inputTokens === null
                    ? null
                    : {
                        inputTokens,
                        cachedInputTokens,
                        outputTokens,
                        tokenSource,
                        costMicros,
                        costSource,
                      },
                startedAt: iso(startedAt),
                finishedAt: iso(finishedAt),
              }),
            ),
          moreProviderCalls: calls.length > npAgentActivityProviderCallLimitV1,
        },
        run,
      );
    } catch {
      return null;
    }
  }
  async function getPrincipal(input: Staff & { id: string }) {
    const { auth } = await staff(input);
    if (!uuid.test(input.id)) throw missing();
    const [row] = await getDb()
      .select()
      .from(npAgentPrincipals)
      .where(and(eq(npAgentPrincipals.siteId, input.siteId), eq(npAgentPrincipals.id, input.id)))
      .limit(1);
    if (!row) throw missing();
    await assertSameStaff(input, auth);
    try {
      return npProjectAgentPrincipalV1(row);
    } catch {
      throw missing();
    }
  }
  async function getAction(input: Staff & { id: string }) {
    const { auth, visibility } = await staff(input);
    if (!uuid.test(input.id)) throw missing();
    const [row] = await getDb()
      .select()
      .from(npAgentActions)
      .where(and(eq(npAgentActions.siteId, input.siteId), eq(npAgentActions.id, input.id)))
      .limit(1);
    const evidence: ActionEvidence = { includeDetail: true };
    if (!row || !(await actionVisible(row, visibility, evidence))) throw missing();
    const inv = await invocation(input.siteId, row.invocationId);
    const principalId = await actionOwner(row, inv);
    if (!principalId) throw missing();
    let detail = actionDetail(row, inv, principalId, evidence.approvalId);
    if (
      options.operator &&
      row.outputHash &&
      ["ops.status", "audit.run", "ops.plan", "ops.execute"].includes(row.capabilityId)
    ) {
      detail = npRequireAgentActivityActionDetailV1({
        ...detail,
        operatorReview: await options.operator.projectActivity({
          siteId: input.siteId,
          actor: input.actor,
          actionId: row.id,
        }),
      });
    }
    if (evidence.changeSetId) {
      detail = npRequireAgentActivityActionDetailV1({
        ...detail,
        changeSetId: evidence.changeSetId,
        ...(evidence.verificationResult ? { verificationResult: evidence.verificationResult } : {}),
      });
    } else if (
      (row.verificationState === "passed" || row.verificationState === "failed") &&
      row.verifiedAt &&
      row.verificationResultDigest
    ) {
      try {
        detail = npRequireAgentActivityActionDetailV1({
          ...detail,
          verificationResult: {
            state: row.verificationState,
            completedAt: row.verifiedAt.toISOString(),
            digest: row.verificationResultDigest,
          },
        });
      } catch {
        // Preserve the already validated Action when optional details are unavailable.
      }
    }
    await assertSameStaff(input, auth);
    return detail;
  }
  async function visibleRetryRun(run: Run, id: string, visibility: Visibility) {
    if (id === run.id) return false;
    const [other] = await getDb()
      .select()
      .from(npAgentRuns)
      .where(
        and(
          eq(npAgentRuns.siteId, run.siteId),
          eq(npAgentRuns.id, id),
          eq(npAgentRuns.origin, "runtime"),
          eq(npAgentRuns.principalId, run.principalId),
        ),
      )
      .limit(1);
    return (
      other &&
      other.agentId === run.agentId &&
      other.agentVersionId === run.agentVersionId &&
      (await runVisible(other, visibility).catch(() => false))
    );
  }
  async function runtimeOperationActivity(input: Staff, run: Run, visibility: Visibility) {
    const records = await options.operator
      ?.projectRunActivity?.({
        siteId: run.siteId,
        actor: input.actor,
        runId: run.id,
        state: run.state,
        finished: run.finishedAt !== null,
      })
      .catch(() => []);
    if (!records?.length) return;
    const visible = [];
    for (const record of records) {
      if (
        record.state === "succeeded" &&
        record.operation === "agent.run.retry" &&
        !(await visibleRetryRun(run, record.resultRunId, visibility))
      )
        continue;
      visible.push(record);
    }
    return visible.length ? visible : undefined;
  }
  async function runtimeRetrySource(input: Staff, run: Run, visibility: Visibility) {
    const id = await options.operator
      ?.projectRunRetrySource?.({ siteId: run.siteId, actor: input.actor, runId: run.id })
      .catch(() => undefined);
    if (id && (await visibleRetryRun(run, id, visibility))) return id;
  }
  async function getRun(
    input: Staff & IncidentReader & { id: string },
  ): Promise<NpAgentActivityRunResourceV1> {
    const { auth, visibility } = await staff(input);
    if (!uuid.test(input.id)) throw missing();
    const db = getDb();
    const where = and(eq(npAgentRuns.siteId, input.siteId), eq(npAgentRuns.id, input.id));
    const [row] = await db.select().from(npAgentRuns).where(where).limit(1);
    if (!row) {
      const detail = await npReadReleasedRunHistoryV1({
        db: getDb(),
        siteId: input.siteId,
        runId: input.id,
        actionVisible: (action) => actionVisible(action, visibility),
      });
      if (!detail) throw missing();
      await assertSameStaff(input, auth);
      return detail;
    }
    if (!(await runVisible(row, visibility))) throw missing();
    if (row.origin === "runtime") {
      const snapshot = await db.transaction(
        async (tx) => {
          const [current] = await tx.select().from(npAgentRuns).where(where).limit(1);
          if (
            !current ||
            current.origin !== "runtime" ||
            current.admissionFingerprint !== row.admissionFingerprint
          )
            throw missing();
          const detail = runDetail(
            current,
            await invocation(input.siteId, current.invocationId, tx),
          );
          return {
            current,
            detail: {
              ...detail,
              runtimeDiagnostics: await runtimeDiagnostics(tx, current, detail.run),
            },
          };
        },
        { accessMode: "read only", isolationLevel: "repeatable read" },
      );
      const actions: Action[] = [];
      if (!(await runVisible(snapshot.current, visibility, { actions }))) throw missing();
      const related =
        snapshot.detail.evidence === "redacted"
          ? await relatedRunRecords(input, snapshot.current, visibility, actions)
          : undefined;
      const [runtimeOperations, runtimeRetrySourceRunId] =
        snapshot.detail.evidence === "redacted"
          ? await Promise.all([
              runtimeOperationActivity(input, snapshot.current, visibility),
              runtimeRetrySource(input, snapshot.current, visibility),
            ])
          : [];
      await assertSameStaff(input, auth);
      return {
        ...snapshot.detail,
        ...(related ? { related } : {}),
        ...(runtimeOperations ? { runtimeOperations } : {}),
        ...(runtimeRetrySourceRunId ? { runtimeRetrySourceRunId } : {}),
      };
    }
    const current = await refreshRun(row);
    const actions: Action[] = [];
    if (!(await runVisible(current, visibility, { actions }))) throw missing();
    const detail = runDetail(current, await invocation(input.siteId, current.invocationId));
    const related =
      detail.evidence === "redacted"
        ? await relatedRunRecords(input, current, visibility, actions)
        : undefined;
    await assertSameStaff(input, auth);
    return { ...detail, ...(related ? { related } : {}) };
  }
  type Position = { id: string; time: string };
  async function list(kind: NpAgentActivityKindV1, input: RunsQuery) {
    const { auth, visibility } = await staff(input);
    const query = npRequireAgentActivityQueryV1(kind, input.query ?? {});
    const empty = () => ({
      schemaVersion: `np.agent-activity-${kind}.v1`,
      items: [],
      nextCursor: null,
    });
    const { cursor, ...filters } = query;
    const binding = mac(
      serializeAgentCanonicalJson({
        siteId: input.siteId,
        sessionId: input.actor.sessionId,
        auth,
        kind,
        filters,
      }),
    );
    let position: Position | null = null;
    if (cursor) {
      try {
        const data = cursorCodec.open(cursor) as {
          binding: string;
          expires: number;
          position: Position;
        };
        if (
          data.binding !== binding ||
          !Number.isFinite(data.expires) ||
          data.expires <= now().getTime() ||
          !uuid.test(data.position.id) ||
          new Date(data.position.time).toISOString() !== data.position.time
        )
          throw invalidCursor();
        position = data.position;
      } catch {
        throw invalidCursor();
      }
    }
    const incidentId = query.incidentId;
    if (incidentId && !(await canReadIncident(input, incidentId))) {
      await assertSameStaff(input, auth);
      return empty();
    }
    let approval: NpAgentApprovalListItemV1 | undefined;
    if (query.approvalId) {
      const approvals = options.approvals ?? options.changesets?.approvals;
      try {
        approval = (
          await approvals?.get({ siteId: input.siteId, actor: input.actor, id: query.approvalId })
        )?.item;
      } catch (error) {
        if (!(error instanceof NpAgentGatewayError) || error.status !== 404) throw error;
      }
      if (approval?.approval.id !== query.approvalId) {
        await assertSameStaff(input, auth);
        return empty();
      }
    }
    const limit = query.limit ?? 50;
    const items: unknown[] = [];
    let more = false;
    const table =
      kind === "principals" ? npAgentPrincipals : kind === "runs" ? npAgentRuns : npAgentActions;
    const time =
      kind === "runs"
        ? npAgentRuns.queuedAt
        : kind === "principals"
          ? npAgentPrincipals.createdAt
          : npAgentActions.createdAt;
    // At most 500 candidate rows per request. Cursor advances across invisible rows, preventing starvation.
    for (let scanned = 0; scanned < 500;) {
      const where: SQL[] = [eq(table.siteId, input.siteId)];
      if (position)
        where.push(
          or(
            lt(time, new Date(position.time)),
            and(eq(time, new Date(position.time)), lt(table.id, position.id)),
          )!,
        );
      if (query.from) where.push(gte(time, new Date(query.from)));
      if (query.to) where.push(lte(time, new Date(query.to)));
      if (query.state)
        where.push(
          eq(
            kind === "principals"
              ? npAgentPrincipals.status
              : kind === "runs"
                ? npAgentRuns.state
                : npAgentActions.state,
            query.state,
          ),
        );
      if (kind === "principals" && query.kind) where.push(eq(npAgentPrincipals.kind, query.kind));
      if (kind === "runs") {
        if (incidentId) {
          where.push(
            exists(
              getDb()
                .select({ id: npAgentIncidentTimeline.id })
                .from(npAgentIncidentTimeline)
                .leftJoin(npAgentActions, incidentActionJoin)
                .where(
                  and(
                    eq(npAgentIncidentTimeline.siteId, npAgentRuns.siteId),
                    incidentRunLinks(npAgentRuns.id, npAgentRuns.admissionFingerprint, incidentId),
                  ),
                ),
            ),
          );
        }
        if (query.origin) where.push(eq(npAgentRuns.origin, query.origin));
        if (query.principalId) where.push(eq(npAgentRuns.principalId, query.principalId));
        if (query.agentId || query.triggerKind || query.template)
          where.push(eq(npAgentRuns.origin, "runtime"));
        if (query.agentId) where.push(eq(npAgentRuns.agentId, query.agentId));
        if (query.template)
          where.push(
            exists(
              getDb()
                .select({ id: npAgents.id })
                .from(npAgents)
                .where(
                  and(
                    eq(npAgents.siteId, npAgentRuns.siteId),
                    eq(npAgents.id, npAgentRuns.agentId),
                    eq(npAgents.principalId, npAgentRuns.principalId),
                    eq(npAgents.template, query.template),
                  ),
                ),
            ),
          );
        if (query.q) {
          const term = query.q;
          const id = term.toLowerCase();
          where.push(
            or(
              ...(uuid.test(id)
                ? [
                    npAgentRuns.id,
                    npAgentRuns.agentId,
                    npAgentRuns.agentVersionId,
                    npAgentRuns.principalId,
                    npAgentRuns.invocationId,
                    npAgentRuns.triggerId,
                  ].map((column) => eq(column, id))
                : []),
              eq(npAgentRuns.recipeId, term),
              exists(
                getDb()
                  .select({ id: npAgentInvocations.id })
                  .from(npAgentInvocations)
                  .where(
                    and(
                      eq(npAgentInvocations.siteId, npAgentRuns.siteId),
                      eq(npAgentInvocations.id, npAgentRuns.invocationId),
                      eq(npAgentInvocations.operationId, term),
                    ),
                  ),
              ),
            )!,
          );
        }
        if (query.triggerKind)
          where.push(
            exists(
              getDb()
                .select({ id: npAgentTriggers.id })
                .from(npAgentTriggers)
                .where(
                  and(
                    eq(npAgentTriggers.siteId, npAgentRuns.siteId),
                    eq(npAgentTriggers.id, npAgentRuns.triggerId),
                    eq(npAgentTriggers.agentId, npAgentRuns.agentId),
                    eq(npAgentTriggers.agentVersionId, npAgentRuns.agentVersionId),
                    eq(npAgentTriggers.kind, query.triggerKind),
                  ),
                ),
            ),
          );
      }
      if (kind === "actions") {
        if (query.runId) where.push(eq(npAgentActions.runId, query.runId));
        if (query.capabilityId) where.push(eq(npAgentActions.capabilityId, query.capabilityId));
      }
      const rows = await getDb()
        .select()
        .from(table)
        .where(and(...where))
        .orderBy(desc(time), desc(table.id))
        .limit(100);
      more = rows.length === 100;
      for (const raw of rows) {
        scanned++;
        position = {
          id: raw.id,
          time: (kind === "runs" ? (raw as Run).queuedAt : (raw as Action).createdAt).toISOString(),
        };
        if (kind === "principals") {
          try {
            items.push(npProjectAgentPrincipalV1(raw as typeof npAgentPrincipals.$inferSelect));
          } catch {
            continue;
          }
        } else if (kind === "runs") {
          const row = raw as Run;
          const inv = await invocation(row.siteId, row.invocationId);
          if (
            row.origin === "gateway" &&
            query.capabilityId &&
            inv?.operationId !== query.capabilityId
          )
            continue;
          const capabilityId = row.origin === "runtime" ? query.capabilityId : undefined;
          if (
            !(await runVisible(row, visibility, {
              capabilityId,
              approval,
              changeSetId: query.changeSetId,
            }))
          )
            continue;
          if (incidentId && !(await incidentRunMatches(row, incidentId))) continue;
          try {
            items.push(runDetail(row, inv));
          } catch {
            continue;
          }
        } else {
          const row = raw as Action;
          const inv = await invocation(row.siteId, row.invocationId);
          const principalId = await actionOwner(row, inv);
          const evidence: ActionEvidence = {};
          if (
            !principalId ||
            (query.principalId && principalId !== query.principalId) ||
            !(await actionVisible(row, visibility, evidence))
          )
            continue;
          items.push(actionDetail(row, inv, principalId, evidence.approvalId));
        }
        if (items.length === limit) {
          more = true;
          break;
        }
      }
      if (items.length === limit || !more) break;
    }
    const incidentReadable = !incidentId || (await canReadIncident(input, incidentId));
    await assertSameStaff(input, auth);
    if (!incidentReadable) return empty();
    const nextCursor = more
      ? cursorCodec.seal({ binding, expires: now().getTime() + 900_000, position })
      : null;
    return {
      schemaVersion: `np.agent-activity-${kind}.v1`,
      items,
      nextCursor,
    };
  }
  return {
    getPrincipal,
    getRun,
    getAction,
    listPrincipals: async (input: Staff & { query?: unknown }) =>
      npRequireAgentContractResult(
        npAnalyzeAgentActivityPrincipalsPageV1(await list("principals", input)),
      ),
    listRuns: async (input: RunsQuery) =>
      npRequireAgentContractResult(npAnalyzeAgentActivityRunsPageV1(await list("runs", input))),
    listActions: async (input: Staff & { query?: unknown }) =>
      npRequireAgentContractResult(
        npAnalyzeAgentActivityActionsPageV1(await list("actions", input)),
      ),
    async getMachineRun(input: {
      authentication: NpAgentCapabilityAuthenticationV1;
      runId: string;
    }) {
      try {
        if (!options.admission || !uuid.test(input.runId)) throw missing();
        const { authentication } = input;
        const projection = await options.admission.project({ authentication });
        const transport = authentication.authorizationContext.transport;
        if (!["agent-api", "stdio", "mcp-service", "mcp-oauth"].includes(transport))
          throw missing();
        let [row] = await getDb()
          .select()
          .from(npAgentRuns)
          .where(
            and(
              eq(npAgentRuns.siteId, authentication.principal.siteId),
              eq(npAgentRuns.principalId, authentication.principal.id),
              eq(npAgentRuns.id, input.runId),
            ),
          )
          .limit(1);
        if (!row) throw missing();
        const inv = await invocation(row.siteId, row.invocationId);
        if (
          !inv ||
          inv.principalId !== row.principalId ||
          inv.authorizationContextBody.transport !==
            authentication.authorizationContext.transport ||
          !["service-family", "oauth-grant"].includes(
            inv.authorizationContextBody.authorityRef.kind,
          ) ||
          !["service-family", "oauth-grant"].includes(
            authentication.authorizationContext.authorityRef.kind,
          ) ||
          !("audience" in inv.authorizationContextBody.authorityRef) ||
          !("audience" in authentication.authorizationContext.authorityRef) ||
          inv.authorizationContextBody.authorityRef.audience !==
            authentication.authorizationContext.authorityRef.audience
        )
          throw missing();
        if (!projection.entries.some((entry) => entry.definition.descriptor.id === inv.operationId))
          throw missing();
        if (
          authentication.principal.authority.kind !== "user" ||
          !authentication.principal.authority.userId
        )
          throw missing();
        const userId = authentication.principal.authority.userId;
        const live = await npResolveLiveAgentStaffAuthorizationV1(getDb(), row.siteId, userId);
        const [user] = await getDb().select().from(npUsers).where(eq(npUsers.id, userId)).limit(1);
        if (!user) throw missing();
        const visibility: Visibility = {
          actor: { kind: "principal", authentication },
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            tokenVersion: user.tokenVersion,
            role:
              live.authority.kind === "super-admin"
                ? "admin"
                : (live.authority.role as NpAuthUser["role"]),
          },
          capabilities: live.authority.capabilities,
        };
        if (!(await runVisible(row, visibility, { allowedScopes: authentication.scopes })))
          throw missing();
        row = await refreshRun(row);
        if (!(await runVisible(row, visibility, { allowedScopes: authentication.scopes })))
          throw missing();
        await options.admission.project({ authentication });
        return runDetail(row, inv);
      } catch {
        throw missing();
      }
    },
  };
}
export type NpAgentActivityServiceV1 = ReturnType<typeof createAgentActivityServiceV1>;
