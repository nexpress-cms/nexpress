"use client";

import * as React from "react";
import {
  npRequireAgentChangeSetReviewV1,
  npRequireAgentChangeSetApplyInputV1,
  npRequireAgentChangeSetScheduleInputV1,
  npRequireAgentChangeSetCancelInputV1,
  type NpAgentChangeSetReviewV1,
} from "@nexpress/core/agent-contract";
import { npFetch } from "../lib/api-client.js";
import { AgentStudioApiError, responseError } from "./agent-studio-api.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";

export function AgentChangeSetExecution({
  review,
  onChanged,
  onLost,
  idempotencyKeys,
}: {
  review: NpAgentChangeSetReviewV1;
  onChanged: () => void;
  onLost: (message: string) => void;
  idempotencyKeys?: React.RefObject<Record<string, string>>;
}) {
  const { changeSet, executionDetail: detail, executionActions: actions } = review;
  const [scheduledFor, setScheduledFor] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const localKeys = React.useRef<Record<string, string>>({});
  const keys = idempotencyKeys ?? localKeys;
  async function submit(operation: "apply" | "schedule" | "cancel") {
    if (!actions.includes(operation) || busy) return;
    setError(null);
    let time: string | undefined;
    if (operation === "schedule") {
      const parsed = new Date(scheduledFor);
      if (!Number.isFinite(parsed.getTime())) {
        setError("Choose the exact schedule time authorized by the approval.");
        return;
      }
      time = parsed.toISOString();
    }
    const binding = JSON.stringify([
      operation,
      changeSet.id,
      changeSet.draftVersion,
      changeSet.planHash,
      changeSet.approval?.statementHash,
      time,
      reason,
    ]);
    keys.current[binding] ??= crypto.randomUUID();
    setBusy(true);
    try {
      const common = {
        expectedDraftVersion: changeSet.draftVersion,
        planHash: changeSet.planHash,
        idempotencyKey: keys.current[binding],
      };
      const body =
        operation === "cancel"
          ? npRequireAgentChangeSetCancelInputV1({
              schemaVersion: "np.agent-changeset-cancel-input.v1",
              ...common,
              expectedState: changeSet.state,
              reasonCode: "OPERATOR_CANCELLED",
              reason: reason.trim() || null,
            })
          : operation === "schedule"
            ? npRequireAgentChangeSetScheduleInputV1({
                schemaVersion: "np.agent-changeset-schedule-input.v1",
                ...common,
                approvalId: changeSet.approval?.id,
                statementHash: changeSet.approval?.statementHash,
                scheduledFor: time,
              })
            : npRequireAgentChangeSetApplyInputV1({
                schemaVersion: "np.agent-changeset-apply-input.v1",
                ...common,
                approvalId: changeSet.approval?.id,
                statementHash: changeSet.approval?.statementHash,
              });
      const response = await npFetch(
        `/api/admin/agents/changesets/${encodeURIComponent(changeSet.id)}/${operation}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw await responseError(response);
      const result = npRequireAgentChangeSetReviewV1(await response.json());
      if (result.changeSet.id !== changeSet.id) throw new Error("Mismatched ChangeSet");
      onChanged();
    } catch (caught) {
      const message =
        caught instanceof AgentStudioApiError && caught.code === "RECENT_REAUTHENTICATION_REQUIRED"
          ? "Recent staff-primary reauthentication is required. Reauthenticate and reload."
          : "Execution request could not be confirmed. Refresh the current evidence before continuing; an unknown result must not be treated as a failed effect.";
      setError(message);
      if (caught instanceof AgentStudioApiError && [401, 403, 404, 409].includes(caught.status))
        onLost(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-labelledby="changeset-execution-heading">
      <h2 id="changeset-execution-heading" className="text-lg font-semibold">
        Execution and verification
      </h2>
      <p>
        Applying commits the approved plan. Scheduled execution rechecks authority and the approved
        time when dispatched by the host.
      </p>
      {error && <p role="alert">{error}</p>}
      {actions.length === 0 && <p>No execution actions are currently available.</p>}
      {actions.includes("apply") && (
        <Button disabled={busy} onClick={() => void submit("apply")}>
          Apply approved plan
        </Button>
      )}
      {actions.includes("schedule") && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit("schedule");
          }}
        >
          <Label htmlFor="execution-scheduled-for">Approved schedule time (local time)</Label>
          <Input
            id="execution-scheduled-for"
            type="datetime-local"
            required
            disabled={busy}
            value={scheduledFor}
            onChange={(event) => setScheduledFor(event.target.value)}
          />
          <p>The submitted UTC instant must match the signed approval exactly.</p>
          <Button disabled={busy} type="submit">
            Schedule approved plan
          </Button>
        </form>
      )}
      {actions.includes("cancel") && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit("cancel");
          }}
        >
          <Label htmlFor="execution-cancel-reason">Cancellation reason (optional)</Label>
          <Input
            id="execution-cancel-reason"
            maxLength={2000}
            disabled={busy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p>Cancellation does not undo committed content.</p>
          <Button disabled={busy} type="submit" variant="outline">
            Cancel ChangeSet
          </Button>
        </form>
      )}
      {!detail ? (
        <p>No execution evidence has been recorded.</p>
      ) : (
        <div className="space-y-3">
          <dl className="grid gap-1">
            <dt>Execution state</dt>
            <dd>{detail.execution.state}</dd>
            <dt>Started</dt>
            <dd>{detail.execution.startedAt}</dd>
            <dt>Scheduled</dt>
            <dd>{detail.scheduledFor ?? "Not scheduled"}</dd>
            <dt>Committed</dt>
            <dd>{detail.committedAt ?? "No commit recorded"}</dd>
            <dt>Finished</dt>
            <dd>{detail.execution.finishedAt ?? "Not finished"}</dd>
            <dt>Verification</dt>
            <dd>{detail.verification?.state ?? "No verification recorded"}</dd>
            <dt>Safe error code</dt>
            <dd>{detail.errorCode ?? "None"}</dd>
            <dt>Rollback eligibility window</dt>
            <dd>
              {detail.rollbackEligibleUntil ?? "Unavailable"} (eligibility is rechecked when
              preparing compensation)
            </dd>
          </dl>
          {detail.verification && (
            <p>
              Required passed: {detail.verification.requiredPassed}; required failed:{" "}
              {detail.verification.requiredFailed}; advisory warnings:{" "}
              {detail.verification.advisoryWarnings}.
            </p>
          )}
          {detail.checks.length === 0 ? (
            <p>No verification checks have been recorded.</p>
          ) : (
            <ul className="space-y-2">
              {detail.checks.map((check) => (
                <li key={check.checkId}>
                  <strong>{check.checkId}</strong>: {check.status} ·{" "}
                  {check.required ? "required" : "advisory"} · severity {check.severity} · next
                  action {check.nextAction}. Evidence references: {check.evidenceRefs.length}.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
