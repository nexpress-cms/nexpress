"use client";

import * as React from "react";
import {
  npRequireAgentIncidentTransitionInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  type NpAgentIncidentStudioDetailV1,
  type NpAgentIncidentTransitionInputV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeAccessLost, runtimeRequest } from "./agent-runtime-api.js";
import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { RuntimeSelect } from "./agent-runtime-fields.js";
import { Button } from "../ui/button.js";

const labels = {
  investigating: "Start investigation",
  resolved: "Resolve incident",
  dismissed: "Dismiss incident",
};
const reasons = {
  investigating: [],
  resolved: [
    { value: "REMEDIATED", label: "Remediated" },
    { value: "NO_FURTHER_ACTION", label: "No further action" },
  ],
  dismissed: [
    { value: "FALSE_POSITIVE", label: "False positive" },
    { value: "DUPLICATE", label: "Duplicate" },
    { value: "OUT_OF_SCOPE", label: "Out of scope" },
  ],
};

export function IncidentWorkflow({
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
  const workflow = detail.workflow;
  const [transition, setTransition] =
    React.useState<NpAgentIncidentTransitionInputV1["transition"]>("investigating");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [reviewed, setReviewed] = React.useState<string | null>(null);
  const [command, setCommand] = React.useState<NpAgentIncidentTransitionInputV1 | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  const blocked = useAgentRetryBlocked(failure);
  const noteId = React.useId();
  const selected = workflow?.availableTransitions.includes(transition)
    ? transition
    : workflow?.availableTransitions[0];
  const terminal = selected !== "investigating";
  const choices = selected ? reasons[selected] : [];
  const selectedReason =
    choices.find((item) => item.value === reason)?.value ?? choices[0]?.value ?? null;
  const reviewIdentity = workflow
    ? `${detail.incident.versionNumber}:${workflow.containment.reviewHash}:${selected}`
    : "";
  const locked = disabled || busy || command !== null;
  React.useEffect(() => () => request.current?.abort(), []);

  async function submit() {
    if (request.current || blocked || (disabled && !command) || !workflow || !selected) return;
    if (!command && (!note.trim() || (terminal && reviewed !== reviewIdentity))) return;
    const controller = new AbortController();
    request.current = controller;
    let sent = false;
    try {
      const next =
        command ??
        npRequireAgentIncidentTransitionInputV1({
          schemaVersion: "np.agent-incident-transition-input.v1",
          expectedVersion: detail.incident.versionNumber,
          transition: selected,
          resolutionCode: terminal ? selectedReason : null,
          note: note.trim(),
          containmentReviewHash: terminal ? workflow.containment.reviewHash : null,
          containmentDisposition: terminal
            ? workflow.containment.active > 0
              ? "retain"
              : "acknowledge"
            : null,
          idempotencyKey: crypto.randomUUID(),
        });
      setCommand(next);
      setBusy(true);
      onWriting(true);
      setFailure(null);
      setMessage(null);
      sent = true;
      await runtimeRequest(
        `/api/admin/agents/incidents/${encodeURIComponent(detail.incident.id)}/transitions`,
        npRequireAgentRuntimeStudioMutationResultV1,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        },
      );
      if (controller.signal.aborted) return;
      setCommand(null);
      onWriting(false);
      setNote("");
      setReviewed(null);
      setMessage("Incident decision recorded. No containment was restored.");
      onSuccess();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!sent) {
        setMessage("Enter a valid decision note using plain text (up to 2,000 characters).");
        return;
      }
      setFailure(error);
      if (runtimeAccessLost(error)) {
        onWriting(false);
        onAccessLost(error);
        return;
      }
      if (error instanceof AgentStudioApiError && error.status === 409) {
        setCommand(null);
        setReviewed(null);
        onWriting(false);
        onConflict();
        return;
      }
      if (
        error instanceof AgentStudioApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      ) {
        setCommand(null);
        onWriting(false);
        setMessage(error.message);
      } else
        setMessage(
          "The decision outcome is unconfirmed. Retry the unchanged request using the same identity.",
        );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="incident-workflow">
      <h3 id="incident-workflow" className="font-semibold">
        Incident handling
      </h3>
      <p className="text-sm">
        Closing an incident does not restore containment. Restoration requires its existing approval
        flow. Signal feedback and incident dismissal are separate decisions.
      </p>
      {workflow ? (
        <p className="text-sm">
          Containment: {workflow.containment.total} total · {workflow.containment.active} active ·{" "}
          {workflow.containment.restored} restored · {workflow.containment.unresolved} unresolved.{" "}
          {workflow.containment.pendingActions} pending moderation actions block closure. Pending,
          restoring, expired and failed containment records remain unresolved; expired does not mean
          restored.
        </p>
      ) : null}
      {workflow && workflow.containment.pendingActions > 0 ? (
        <p className="text-sm">
          Settle pending moderation through the existing approval flow before closing this incident.
        </p>
      ) : null}
      {!workflow || !selected ? (
        <p>No incident transitions are currently available.</p>
      ) : (
        <AgentRecoveryBoundary error={failure}>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset disabled={locked} className="space-y-3">
              <RuntimeSelect
                label="Incident decision"
                disabled={locked}
                value={selected}
                options={workflow.availableTransitions.map((value) => ({
                  value,
                  label: labels[value],
                }))}
                onChange={(value) => {
                  setTransition(value);
                  setReason("");
                  setReviewed(null);
                }}
              />
              {terminal ? (
                <RuntimeSelect
                  label="Resolution reason"
                  disabled={locked}
                  value={selectedReason ?? ""}
                  options={choices}
                  onChange={setReason}
                />
              ) : null}
              <div className="space-y-1">
                <label htmlFor={noteId}>Decision note</label>
                <textarea
                  id={noteId}
                  className="block min-h-24 w-full rounded-md border bg-transparent p-2"
                  maxLength={2000}
                  required
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              {terminal ? (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewed === reviewIdentity}
                    onChange={(event) => setReviewed(event.target.checked ? reviewIdentity : null)}
                  />
                  <span>
                    {workflow.containment.active > 0
                      ? "I reviewed the containment summary and acknowledge unresolved actions and explicitly retain the active containment."
                      : "I reviewed and acknowledge the containment summary, including unresolved actions."}
                  </span>
                </label>
              ) : null}
            </fieldset>
            <Button
              type="submit"
              disabled={
                busy ||
                blocked ||
                (disabled && !command) ||
                (!command && (!note.trim() || (terminal && reviewed !== reviewIdentity)))
              }
            >
              {busy
                ? "Recording decision…"
                : command
                  ? "Retry unchanged decision"
                  : "Record incident decision"}
            </Button>
          </form>
        </AgentRecoveryBoundary>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
