"use client";
import * as React from "react";
import Link from "next/link";
import {
  npRequireAgentChangeSetCancelInputV1,
  npRequireAgentChangeSetReviewV1,
  npRequireAgentApprovalDetailV1,
  npRequireAgentRollbackPlanCreateInputV1,
  npRequireAgentRollbackPlanRequestApprovalInputV1,
  npRequireAgentRollbackPlanExecuteInputV1,
  type NpAgentChangeSetReviewV1,
  type NpAgentRollbackDetailV1,
} from "@nexpress/core/agent-contract";
import { npFetch } from "../lib/api-client.js";
import { AgentStudioApiError, responseError } from "./agent-studio-api.js";
import { Button } from "../ui/button.js";

export function AgentRollbackReviewFacts({ detail }: { detail: NpAgentRollbackDetailV1 }) {
  return (
    <section className="space-y-3" aria-label="Rollback plan facts">
      <h3 className="font-semibold">Compensation plan · {detail.summary.state}</h3>
      <dl className="grid gap-1">
        <dt>Generation</dt>
        <dd>{detail.summary.generation}</dd>
        <dt>Plan hash</dt>
        <dd className="break-all">{detail.summary.planHash ?? "Not sealed"}</dd>
        <dt>Risk</dt>
        <dd>{detail.risk?.level ?? "Unavailable"}</dd>
        <dt>Expires</dt>
        <dd>{detail.summary.expiresAt}</dd>
        <dt>Terminal reason</dt>
        <dd>{detail.summary.terminalReason ?? "None"}</dd>
        <dt>Execution</dt>
        <dd>{detail.execution?.state ?? "Not started"}</dd>
        <dt>Verification</dt>
        <dd>{detail.verification?.state ?? "Not recorded"}</dd>
      </dl>
      <p>
        Required capabilities: {detail.requiredHumanCapabilities.join(", ") || "None"}. Scopes:{" "}
        {detail.requiredScopes.join(", ") || "None"}.
      </p>
      {detail.operations.map((op) => (
        <section key={op.review.ordinal} className="space-y-2">
          <h4 className="font-medium">
            Operation {op.review.ordinal} · original operation {op.originalOperationOrdinal} ·{" "}
            {op.rollbackClass}
          </h4>
          {op.residualCodes.length > 0 && <p>Residual effects: {op.residualCodes.join(", ")}</p>}
          <p>Evidence: {op.review.evidence}</p>
          {op.review.fields.map((field) => (
            <div key={field.path}>
              <strong>{field.path}</strong>
              <div className="grid gap-2 md:grid-cols-2">
                <pre className="overflow-auto whitespace-pre-wrap break-all">
                  Before:{" "}
                  {field.before.presence === "present"
                    ? JSON.stringify(field.before.value, null, 2)
                    : field.before.presence}
                </pre>
                <pre className="overflow-auto whitespace-pre-wrap break-all">
                  After:{" "}
                  {field.after.presence === "present"
                    ? JSON.stringify(field.after.value, null, 2)
                    : field.after.presence}
                </pre>
              </div>
            </div>
          ))}
        </section>
      ))}
      {detail.checks.length > 0 && (
        <ul>
          {detail.checks.map((check) => (
            <li key={check.checkId}>
              {check.checkId}: {check.status} · {check.required ? "required" : "advisory"} · next
              action {check.nextAction}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function AgentChangeSetRollback({
  review,
  onChanged,
  onLost,
}: {
  review: NpAgentChangeSetReviewV1;
  onChanged: () => void;
  onLost: (message: string) => void;
}) {
  const [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState<string | null>(null);
  const keys = React.useRef<Record<string, string>>({});
  const { changeSet, rollbackDetail: detail, rollbackActions: actions } = review;
  async function submit(action: "prepare" | "request_approval" | "execute" | "cancel") {
    if (busy || !actions.includes(action)) return;
    const binding = JSON.stringify([
      action,
      changeSet.id,
      changeSet.draftVersion,
      changeSet.planHash,
      detail?.summary.rollbackPlanId,
      detail?.version,
      detail?.summary.planHash,
      detail?.approval?.id,
      detail?.approval?.statementHash,
    ]);
    keys.current[binding] ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const root = `/api/admin/agents/changesets/${encodeURIComponent(changeSet.id)}/rollback-plans`;
      const body =
        action === "cancel"
          ? npRequireAgentChangeSetCancelInputV1({
              schemaVersion: "np.agent-changeset-cancel-input.v1",
              targetKind: "rollback_plan",
              rollbackPlanId: detail?.summary.rollbackPlanId,
              expectedRollbackVersion: detail?.version,
              expectedDraftVersion: changeSet.draftVersion,
              expectedState: detail?.summary.state,
              planHash: detail?.summary.planHash,
              reasonCode: "OPERATOR_CANCELLED",
              reason: null,
              idempotencyKey: keys.current[binding],
            })
          : action === "prepare"
            ? npRequireAgentRollbackPlanCreateInputV1({
                schemaVersion: "np.agent-rollback-plan-create-input.v1",
                expectedVersion: changeSet.draftVersion,
                planHash: changeSet.planHash,
                idempotencyKey: keys.current[binding],
              })
            : action === "request_approval"
              ? npRequireAgentRollbackPlanRequestApprovalInputV1({
                  schemaVersion: "np.agent-rollback-plan-request-approval-input.v1",
                  expectedVersion: detail?.version,
                  planHash: detail?.summary.planHash,
                  idempotencyKey: keys.current[binding],
                })
              : npRequireAgentRollbackPlanExecuteInputV1({
                  schemaVersion: "np.agent-rollback-plan-execute-input.v1",
                  expectedVersion: detail?.version,
                  planHash: detail?.summary.planHash,
                  approvalId: detail?.approval?.id,
                  statementHash: detail?.approval?.statementHash,
                  idempotencyKey: keys.current[binding],
                });
      const path =
        action === "cancel"
          ? `/api/admin/agents/changesets/${encodeURIComponent(changeSet.id)}/cancel`
          : action === "prepare"
            ? root
            : `${root}/${encodeURIComponent(detail!.summary.rollbackPlanId)}/${action === "request_approval" ? "request-approval" : "execute"}`;
      const response = await npFetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw await responseError(response);
      if (action === "request_approval") {
        const result = npRequireAgentApprovalDetailV1(await response.json());
        if (
          result.item.target.kind !== "changeset_rollback" ||
          result.item.target.changeSetId !== changeSet.id ||
          result.item.target.rollbackPlanId !== detail?.summary.rollbackPlanId ||
          result.item.target.planHash !== detail?.summary.planHash
        )
          throw new Error("Approval target mismatch");
      } else if (
        npRequireAgentChangeSetReviewV1(await response.json()).changeSet.id !== changeSet.id
      )
        throw new Error("ChangeSet mismatch");
      onChanged();
    } catch (caught) {
      const message =
        caught instanceof AgentStudioApiError && caught.code === "RECENT_REAUTHENTICATION_REQUIRED"
          ? "Recent staff-primary reauthentication is required. Reauthenticate and reload."
          : "Rollback request could not be confirmed. Refresh current evidence before continuing; an unknown response does not prove that no compensation committed.";
      setError(message);
      if (caught instanceof AgentStudioApiError && [401, 403, 404, 409].includes(caught.status))
        onLost(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-labelledby="changeset-rollback-heading">
      <h2 id="changeset-rollback-heading" className="text-lg font-semibold">
        Rollback compensation
      </h2>
      <p>
        Compensation creates new revisions and preserves audit history. Later resource changes block
        execution. Delivered external effects may remain.
      </p>
      {error && <p role="alert">{error}</p>}
      {actions.length === 0 && <p>No rollback actions are currently available.</p>}
      {actions.includes("prepare") && (
        <Button disabled={busy} onClick={() => void submit("prepare")}>
          Prepare rollback plan
        </Button>
      )}
      {actions.includes("request_approval") && (
        <Button disabled={busy} onClick={() => void submit("request_approval")}>
          Request rollback approval
        </Button>
      )}
      {actions.includes("execute") && (
        <Button disabled={busy} onClick={() => void submit("execute")}>
          Execute approved rollback
        </Button>
      )}
      {actions.includes("cancel") && (
        <Button disabled={busy} variant="outline" onClick={() => void submit("cancel")}>
          Cancel rollback plan
        </Button>
      )}
      {detail ? (
        <>
          <AgentRollbackReviewFacts detail={detail} />
          {detail.approval && (
            <Link className="underline" href={`/admin/agents/approvals/${detail.approval.id}`}>
              Review rollback approval · {detail.approval.state}
            </Link>
          )}
        </>
      ) : (
        <p>No rollback plan evidence is loaded.</p>
      )}
    </section>
  );
}
