"use client";

import * as React from "react";
import {
  npRequireAgentIncidentSeverityInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  type NpAgentIncidentStudioDetailV1,
  type NpAgentIncidentSeverityInputV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeAccessLost, runtimeRequest } from "./agent-runtime-api.js";
import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { RuntimeSelect } from "./agent-runtime-fields.js";
import { Button } from "../ui/button.js";

export function IncidentSeverity({
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
  const [severity, setSeverity] = React.useState<NpAgentIncidentSeverityInputV1["severity"]>("low");
  const [note, setNote] = React.useState("");
  const [command, setCommand] = React.useState<NpAgentIncidentSeverityInputV1 | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  const blocked = useAgentRetryBlocked(failure);
  const noteId = React.useId();
  const choices = workflow?.availableSeverities ?? [];
  const selected = choices.includes(severity) ? severity : choices[0];
  const locked = disabled || busy || command !== null;
  React.useEffect(() => () => request.current?.abort(), []);

  async function submit() {
    if (request.current || blocked || (disabled && !command) || !workflow || !selected) return;
    if (!command && !note.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    let sent = false;
    try {
      const next =
        command ??
        npRequireAgentIncidentSeverityInputV1({
          schemaVersion: "np.agent-incident-severity-input.v1",
          expectedVersion: detail.incident.versionNumber,
          severity: selected,
          note: note.trim(),
          idempotencyKey: crypto.randomUUID(),
        });
      setCommand(next);
      setBusy(true);
      onWriting(true);
      setFailure(null);
      setMessage(null);
      sent = true;
      await runtimeRequest(
        `/api/admin/agents/incidents/${encodeURIComponent(detail.incident.id)}/severity`,
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
      setMessage("Incident severity change recorded.");
      onSuccess();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!sent) {
        setMessage("Enter a valid severity note using plain text (up to 2,000 characters).");
        return;
      }
      setFailure(error);
      if (runtimeAccessLost(error)) {
        setCommand(null);
        onWriting(false);
        onAccessLost(error);
        return;
      }
      if (error instanceof AgentStudioApiError && error.status === 409) {
        setCommand(null);
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
          "The severity change outcome is unconfirmed. Retry the unchanged request using the same identity.",
        );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="incident-severity">
      <h3 id="incident-severity" className="font-semibold">
        Incident severity
      </h3>
      <p className="text-sm">
        Raise severity after reviewing the evidence. This records a human decision and does not
        execute containment.
      </p>
      {!selected ? (
        <p>No severity increases are currently available.</p>
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
                label="New severity"
                disabled={locked}
                value={selected}
                options={choices.map((value) => ({ value, label: value }))}
                onChange={setSeverity}
              />
              <div className="space-y-1">
                <label htmlFor={noteId}>Severity change note</label>
                <textarea
                  id={noteId}
                  className="block min-h-24 w-full rounded-md border bg-transparent p-2"
                  maxLength={2000}
                  required
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            </fieldset>
            <Button
              type="submit"
              disabled={busy || blocked || (disabled && !command) || (!command && !note.trim())}
            >
              {busy
                ? "Recording severity…"
                : command
                  ? "Retry unchanged severity change"
                  : "Raise incident severity"}
            </Button>
          </form>
        </AgentRecoveryBoundary>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
