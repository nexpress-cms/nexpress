"use client";

import * as React from "react";
import {
  npRequireAgentIncidentAssignmentV1,
  npRequireAgentIncidentAssignmentInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  type NpAgentIncidentAssignmentInputV1,
  type NpAgentIncidentStudioDetailV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeAccessLost, runtimeRequest, useRuntimeResource } from "./agent-runtime-api.js";
import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { RuntimeSelect } from "./agent-runtime-fields.js";
import { Button } from "../ui/button.js";

export function IncidentAssignment({
  detail,
  disabled,
  onWriting,
  onSuccess,
  onConflict,
  onAccessLost,
}: {
  detail: NpAgentIncidentStudioDetailV1;
  disabled: boolean;
  onWriting: (value: boolean) => void;
  onSuccess: () => void;
  onConflict: () => void;
  onAccessLost: (error: unknown) => void;
}) {
  const path = `/api/admin/agents/incidents/${encodeURIComponent(detail.incident.id)}/assignment`;
  const state = useRuntimeResource(path, npRequireAgentIncidentAssignmentV1);
  const assignment = state.loading ? null : state.value;
  const [selection, setSelection] = React.useState("none");
  const [command, setCommand] = React.useState<NpAgentIncidentAssignmentInputV1 | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  const blocked = useAgentRetryBlocked(failure);
  const mismatch = Boolean(
    assignment &&
    (assignment.incidentId !== detail.incident.id ||
      assignment.incidentVersion !== detail.incident.versionNumber ||
      assignment.assignedAgentId !== detail.incident.assignedAgentId),
  );
  const selectedAgent = assignment?.candidates.find((candidate) => candidate.id === selection);
  const unchanged = selection === assignment?.assignedAgentId;
  const locked = disabled || busy || command !== null || state.loading || mismatch;
  React.useEffect(() => () => request.current?.abort(), []);
  React.useEffect(() => {
    if (disabled && !command) return;
    if (runtimeAccessLost(state.failure)) onAccessLost(state.failure);
    else if (
      mismatch ||
      (state.failure instanceof AgentStudioApiError && state.failure.status === 409)
    )
      onConflict();
  }, [state.failure, mismatch, disabled, command, onAccessLost, onConflict]);

  async function submit(agentId: string | null) {
    if (request.current || blocked || (disabled && !command)) return;
    if (
      !command &&
      (!assignment?.canAssign ||
        mismatch ||
        state.loading ||
        agentId === assignment.assignedAgentId ||
        (agentId !== null && !assignment.candidates.some((candidate) => candidate.id === agentId)))
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    try {
      const next =
        command ??
        npRequireAgentIncidentAssignmentInputV1({
          schemaVersion: "np.agent-incident-assignment-input.v1",
          expectedVersion: detail.incident.versionNumber,
          agentId,
          idempotencyKey: crypto.randomUUID(),
        });
      setCommand(next);
      setBusy(true);
      onWriting(true);
      setFailure(null);
      setMessage(null);
      const result = await runtimeRequest(path, npRequireAgentRuntimeStudioMutationResultV1, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (controller.signal.aborted) return;
      if (result.resourceId !== detail.incident.id) {
        throw new AgentStudioApiError(
          "The assignment response could not be validated.",
          502,
          "INCIDENT_ASSIGNMENT_CONTRACT_ERROR",
        );
      }
      setCommand(null);
      onWriting(false);
      onSuccess();
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailure(error);
      if (runtimeAccessLost(error)) {
        setCommand(null);
        onWriting(false);
        onAccessLost(error);
      } else if (error instanceof AgentStudioApiError && error.status === 409) {
        setCommand(null);
        onWriting(false);
        onConflict();
      } else if (
        error instanceof AgentStudioApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      ) {
        setCommand(null);
        onWriting(false);
        setMessage(error.message);
      } else {
        setMessage(
          "The assignment outcome is unconfirmed. Retry the unchanged request using the same identity.",
        );
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-assignment">
      <h3 id="incident-assignment" className="font-semibold">
        Assigned Agent
      </h3>
      <p className="text-sm">
        Assign a configured Agent for this incident’s category. Assignment does not grant
        capabilities or start a run.
      </p>
      <AgentRecoveryBoundary error={failure ?? state.failure}>
        {state.loading ? <p role="status">Loading Agent assignment…</p> : null}
        {state.error ? <p role="alert">Agent assignment is unavailable. {state.error}</p> : null}
        {assignment && !mismatch ? (
          <>
            <p className="break-words text-sm">
              Current assignment:{" "}
              {assignment.current
                ? `${assignment.current.name} · ${assignment.current.status}`
                : assignment.assignedAgentId
                  ? "Assigned Agent configuration is unavailable."
                  : "Unassigned"}
            </p>
            {assignment.current && !assignment.current.eligible ? (
              <p className="text-sm">
                The assigned Agent is no longer eligible for this incident. Review its configuration
                or change the assignment.
              </p>
            ) : null}
            {assignment.canAssign ? (
              <div className="space-y-3">
                <RuntimeSelect
                  label="Assignment candidate"
                  value={selection}
                  disabled={locked}
                  onChange={setSelection}
                  options={[
                    { value: "none", label: "Select an Agent" },
                    ...assignment.candidates.map((candidate) => ({
                      value: candidate.id,
                      label: `${candidate.name} · ${candidate.status} · ${candidate.id}`,
                    })),
                  ]}
                />
                {selectedAgent ? (
                  <p className="break-all text-sm">Selected Agent: {selectedAgent.id}</p>
                ) : null}
                {assignment.candidates.length === 0 ? (
                  <p>No eligible Agents are available for this category.</p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  {command ? (
                    <Button disabled={busy || blocked} onClick={() => void submit(command.agentId)}>
                      {busy ? "Recording assignment…" : "Retry unchanged assignment"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        disabled={locked || blocked || !selectedAgent || unchanged}
                        onClick={() => void submit(selection)}
                      >
                        Assign selected Agent
                      </Button>
                      <Button
                        variant="outline"
                        disabled={locked || blocked || !assignment.assignedAgentId}
                        onClick={() => void submit(null)}
                      >
                        Unassign Agent
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p>Assignment changes are unavailable for this incident or your current access.</p>
            )}
          </>
        ) : null}
        <Button
          variant="outline"
          disabled={locked}
          onClick={() => {
            setSelection("none");
            setFailure(null);
            setMessage(null);
            state.reload();
          }}
        >
          Refresh Agent candidates
        </Button>
      </AgentRecoveryBoundary>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
