"use client";

import * as React from "react";
import Link from "next/link";
import {
  npRequireAgentIncidentResponsePlanInputV1,
  npRequireAgentIncidentResponseExecuteInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  type NpAgentIncidentStudioDetailV1,
  type NpAgentIncidentResponsePlanInputV1,
  type NpAgentIncidentResponseExecuteInputV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeAccessLost, runtimeRequest } from "./agent-runtime-api.js";
import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { RuntimeSelect } from "./agent-runtime-fields.js";
import { Button } from "../ui/button.js";

type PendingResponse = {
  path: string;
  body: NpAgentIncidentResponsePlanInputV1 | NpAgentIncidentResponseExecuteInputV1;
  phase: "prepare" | "execute";
};

export function IncidentResponse({
  detail,
  choiceIndex,
  onChoiceChange,
  disabled,
  onWriting,
  onSuccess,
  onConflict,
  onAccessLost,
}: {
  detail: NpAgentIncidentStudioDetailV1;
  choiceIndex: string;
  onChoiceChange: (index: string) => void;
  disabled: boolean;
  onWriting: (value: boolean) => void;
  onSuccess: () => void;
  onConflict: () => void;
  onAccessLost: (error: unknown) => void;
}) {
  const response = detail.response;
  const [reason, setReason] = React.useState("HUMAN_REVIEW");
  const [command, setCommand] = React.useState<PendingResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  const blocked = useAgentRetryBlocked(failure);
  const choice = choiceIndex === "" ? undefined : response?.choices[Number(choiceIndex)];
  const root = `/api/admin/agents/incidents/${encodeURIComponent(detail.incident.id)}`;
  const locked = disabled || busy || command !== null;
  React.useEffect(() => () => request.current?.abort(), []);

  async function send(create: () => PendingResponse) {
    if (request.current || blocked || (disabled && !command)) return;
    const controller = new AbortController();
    request.current = controller;
    let sent = false;
    try {
      const next = command ?? create();
      setCommand(next);
      setBusy(true);
      onWriting(true);
      setFailure(null);
      setMessage(null);
      sent = true;
      await runtimeRequest(`${root}/${next.path}`, npRequireAgentRuntimeStudioMutationResultV1, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next.body),
      });
      if (controller.signal.aborted) return;
      setCommand(null);
      onWriting(false);
      setMessage(
        next.phase === "prepare"
          ? "Response plan prepared. Review its approval and refresh before explicitly executing."
          : "Response request completed. Review the refreshed plan and containment state for its result.",
      );
      onSuccess();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!sent) {
        setMessage("Review the selected target and enter a valid reason code.");
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
      } else {
        setMessage(
          "The response outcome is unconfirmed. Retry the unchanged request using the same identity.",
        );
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function prepare() {
    if (!choice) return;
    void send(() => ({
      path: "response-plan",
      phase: "prepare",
      body: npRequireAgentIncidentResponsePlanInputV1({
        schemaVersion: "np.agent-incident-response-plan-input.v1",
        expectedVersion: detail.incident.versionNumber,
        capabilityId: choice.capabilityId,
        proposal:
          choice.capabilityId === "moderation.quarantine"
            ? {
                incidentId: detail.incident.id,
                target: choice.target,
                expectedVersionDigest: choice.expectedVersionDigest,
                reasonCode: reason.trim(),
              }
            : {
                containmentKind: "content_quarantine",
                containmentId: choice.containmentId,
                expectedVersionDigest: choice.expectedVersionDigest,
              },
        idempotencyKey: crypto.randomUUID(),
      }),
    }));
  }

  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-response">
      <h3 id="incident-response" className="font-semibold">
        Response plans
      </h3>
      <p className="text-sm">
        Prepare a plan for an authorized evidence target, review its approval, then explicitly
        execute the approved action. Preparing a plan does not change content. Restoration requires
        a separate approval. Containment does not expire automatically.
      </p>
      {!response ? (
        <p>Response planning is unavailable for this incident or your current access.</p>
      ) : (
        <AgentRecoveryBoundary error={failure}>
          {response.truncated ? (
            <p>Only a bounded set of response targets and plans is shown.</p>
          ) : null}
          {response.choices.length > 0 ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                prepare();
              }}
            >
              <fieldset disabled={locked} className="min-w-0 space-y-3">
                <RuntimeSelect
                  label="Response target"
                  disabled={locked}
                  value={choiceIndex || "none"}
                  onChange={(value) => onChoiceChange(value === "none" ? "" : value)}
                  options={[
                    { value: "none", label: "Select a response target" },
                    ...response.choices.map((item, index) => ({
                      value: String(index),
                      label: `${item.capabilityId === "moderation.quarantine" ? "Quarantine" : "Restore"} ${item.target.kind} ${index + 1}`,
                    })),
                  ]}
                />
                {choice ? (
                  <div className="space-y-1 break-all text-sm">
                    <p>
                      Target: {choice.target.kind} · {choice.target.collection} · {choice.target.id}
                    </p>
                    <p>Current target version: {choice.expectedVersionDigest}</p>
                    {choice.containmentId ? <p>Containment: {choice.containmentId}</p> : null}
                  </div>
                ) : null}
                {choice?.capabilityId === "moderation.quarantine" ? (
                  <RuntimeSelect
                    label="Quarantine reason"
                    disabled={locked}
                    value={reason}
                    onChange={setReason}
                    options={[
                      { value: "HUMAN_REVIEW", label: "Human review" },
                      { value: "SPAM_CONFIRMED", label: "Spam confirmed" },
                      { value: "ABUSE_CONFIRMED", label: "Abuse confirmed" },
                    ]}
                  />
                ) : null}
              </fieldset>
              <Button
                type="submit"
                disabled={
                  locked ||
                  blocked ||
                  !choice ||
                  (choice.capabilityId === "moderation.quarantine" &&
                    !/^[A-Z][A-Z0-9_]{0,63}$/.test(reason.trim()))
                }
              >
                Prepare response plan
              </Button>
            </form>
          ) : (
            <p>No response targets are currently available.</p>
          )}
          {response.plans.length === 0 ? (
            <p>No visible response plans.</p>
          ) : (
            <ul className="space-y-3">
              {response.plans.map((plan) => (
                <li
                  key={plan.actionId}
                  className="space-y-2 break-all rounded-lg border p-3 text-sm"
                >
                  <h4 className="font-medium">
                    {plan.capabilityId === "moderation.quarantine"
                      ? "Quarantine plan"
                      : "Restore plan"}{" "}
                    · {plan.state}
                  </h4>
                  <p>Action: {plan.actionId}</p>
                  <p id={`response-target-${plan.actionId}`}>
                    Target: {plan.target.kind} · {plan.target.collection} · {plan.target.id}
                  </p>
                  <p>Plan target version: {plan.expectedVersionDigest}</p>
                  {plan.containmentId ? <p>Containment: {plan.containmentId}</p> : null}
                  <p>Proposal hash: {plan.proposalHash}</p>
                  <p>
                    Approval expires: <time dateTime={plan.expiresAt}>{plan.expiresAt}</time>
                  </p>
                  <p>Policy hashes: {plan.policyHashes.join(", ") || "None recorded"}</p>
                  <p>
                    Reversibility: {plan.reversibility}. Restoration is a separate approved action.
                  </p>
                  {plan.approvalResource ? (
                    <Link className="inline-block underline" href={plan.approvalResource}>
                      Review response approval
                    </Link>
                  ) : null}
                  <p>
                    {plan.canExecute
                      ? "Current server checks permit an explicit execution request."
                      : "Execution is unavailable. Review approval and refresh to check current eligibility."}
                  </p>
                  <Button
                    variant="outline"
                    aria-describedby={`response-target-${plan.actionId}`}
                    disabled={locked || blocked || !plan.canExecute}
                    onClick={() => {
                      if (!plan.canExecute) return;
                      void send(() => ({
                        path:
                          plan.capabilityId === "moderation.restore"
                            ? "restore"
                            : "response-plan/execute",
                        phase: "execute",
                        body: npRequireAgentIncidentResponseExecuteInputV1({
                          schemaVersion: "np.agent-incident-response-execute-input.v1",
                          expectedVersion: detail.incident.versionNumber,
                          actionId: plan.actionId,
                          approvalId: plan.approvalId,
                          proposalHash: plan.proposalHash,
                          idempotencyKey: crypto.randomUUID(),
                        }),
                      }));
                    }}
                  >
                    Execute approved{" "}
                    {plan.capabilityId === "moderation.quarantine" ? "quarantine" : "restore"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {command ? (
            <Button disabled={busy || blocked} onClick={() => void send(() => command)}>
              {busy ? "Submitting response…" : "Retry unchanged response"}
            </Button>
          ) : null}
        </AgentRecoveryBoundary>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
