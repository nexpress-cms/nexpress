"use client";

import * as React from "react";
import Link from "next/link";
import {
  npRequireAgentMemberResponseV1,
  npRequireAgentMemberResponsePlanInputV1,
  npRequireAgentMemberResponseExecuteInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  type NpAgentMemberResponsePlanInputV1,
  type NpAgentMemberResponseExecuteInputV1,
  type NpAgentMemberResponseOperationV1,
} from "@nexpress/core/agent-contract";
import { runtimeAccessLost, runtimeRequest, useRuntimeResource } from "./agent-runtime-api.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

type Pending = {
  path: "plan" | "execute";
  body: NpAgentMemberResponsePlanInputV1 | NpAgentMemberResponseExecuteInputV1;
};
export function IncidentMemberResponse({
  incidentId,
  incidentVersion,
  refreshGeneration,
  memberId,
  disabled,
  onWriting,
  onSuccess,
  onAccessLost,
  onConflict,
}: {
  incidentId: string;
  incidentVersion: number;
  refreshGeneration: number;
  memberId: string;
  disabled: boolean;
  onWriting: (value: boolean) => void;
  onSuccess: () => void;
  onAccessLost: (error: unknown) => void;
  onConflict: () => void;
}) {
  const root = `/api/admin/agents/incidents/${encodeURIComponent(incidentId)}/member-response`;
  const parse = React.useCallback(
    (value: unknown) => {
      const result = npRequireAgentMemberResponseV1(value);
      if (
        result.incidentId !== incidentId ||
        result.incidentVersion !== incidentVersion ||
        result.memberId !== memberId
      )
        throw new AgentStudioApiError(
          "The Incident or Member changed.",
          409,
          "MEMBER_RESPONSE_CONFLICT",
        );
      return result;
    },
    [incidentId, incidentVersion, memberId],
  );
  const state = useRuntimeResource(root, parse);
  const reload = state.reload;
  // Refresh current facts without replacing a draft or an unresolved request identity.
  const observedGeneration = React.useRef(refreshGeneration);
  React.useEffect(() => {
    if (observedGeneration.current === refreshGeneration) return;
    observedGeneration.current = refreshGeneration;
    reload();
  }, [refreshGeneration, reload]);
  const response = state.value;
  const [duration, setDuration] = React.useState("");
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  const blocked = useAgentRetryBlocked(failure);
  const locked = disabled || state.loading || busy || pending !== null;
  React.useEffect(() => {
    if (runtimeAccessLost(state.failure)) onAccessLost(state.failure);
  }, [state.failure, onAccessLost]);
  React.useEffect(
    () => () => {
      request.current?.abort();
      onWriting(false);
    },
    [onWriting],
  );
  async function send(create: () => Pending) {
    if (request.current || blocked || (disabled && !pending)) return;
    const controller = new AbortController();
    request.current = controller;
    let dispatched = false;
    try {
      const command = pending ?? create();
      setPending(command);
      setBusy(true);
      onWriting(true);
      setFailure(null);
      setMessage(null);
      dispatched = true;
      await runtimeRequest(`${root}/${command.path}`, npRequireAgentRuntimeStudioMutationResultV1, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command.body),
      });
      if (controller.signal.aborted) return;
      setPending(null);
      onWriting(false);
      setMessage(
        command.path === "plan"
          ? "Plan prepared. A different authorized staff member must approve it before a separate execution request."
          : "Request completed. Refresh the current restriction and plan facts.",
      );
      state.reload();
      onSuccess();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!dispatched) {
        setMessage("Enter a whole duration within the current policy limit.");
        return;
      }
      setFailure(error);
      if (runtimeAccessLost(error)) {
        setPending(null);
        onWriting(false);
        onAccessLost(error);
        return;
      }
      if (error instanceof AgentStudioApiError && error.status === 409) {
        setPending(null);
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
        setPending(null);
        onWriting(false);
        setMessage(error.message);
      } else
        setMessage(
          "The request outcome is unknown. Retry the unchanged request with its retained identity.",
        );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function plan(operation: NpAgentMemberResponseOperationV1) {
    if (!response) return;
    void send(() => ({
      path: "plan",
      body: npRequireAgentMemberResponsePlanInputV1({
        schemaVersion: "np.agent-member-response-plan-input.v1",
        expectedVersion: response.incidentVersion,
        memberId: response.memberId,
        expectedMemberVersionDigest: response.memberVersionDigest,
        operation,
        idempotencyKey: crypto.randomUUID(),
      }),
    }));
  }
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border p-4"
      aria-labelledby="incident-member-response"
    >
      <h3 id="incident-member-response" className="font-semibold">
        Member site response
      </h3>
      <p className="text-sm">
        A temporary restriction blocks Community writes on this site. The global account and
        sessions remain unchanged. Every restriction and revocation requires a new plan, a different
        human’s approval and explicit execution.
      </p>
      <AgentRecoveryBoundary error={state.failure ?? failure}>
        {state.loading ? <p role="status">Loading current Member response facts…</p> : null}
        {state.error ? (
          <p role="alert">
            {state.failure instanceof AgentStudioApiError && state.failure.status === 503
              ? "Member response is disabled or its current policy is unavailable."
              : state.error}
          </p>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
        {response ? (
          <>
            <p className="break-all text-sm">Member: {response.memberId}</p>
            {response.truncated ? (
              <p>Only a bounded set of plans is shown. Other restrictions may remain effective.</p>
            ) : null}
            {response.canRestrict ? (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  plan({ kind: "restrict", durationSeconds: Number(duration) });
                }}
              >
                <label htmlFor="member-restriction-duration">Restriction duration in seconds</label>
                <Input
                  id="member-restriction-duration"
                  type="number"
                  min={1}
                  max={response.maximumDurationSeconds}
                  step={1}
                  required
                  value={duration}
                  disabled={locked}
                  onChange={(event) => setDuration(event.target.value)}
                />
                <p className="text-sm">
                  Current policy maximum: {response.maximumDurationSeconds} seconds. Expiry starts
                  only when the approved action executes.
                </p>
                <Button
                  className="h-auto max-w-full whitespace-normal"
                  disabled={locked || !duration}
                  type="submit"
                >
                  Prepare temporary site restriction
                </Button>
              </form>
            ) : (
              <p>
                A new restriction is currently unavailable. Review the Incident, Member, report and
                active site restrictions.
              </p>
            )}
            {response.revocable.length ? (
              <ul className="space-y-2" aria-label="Workflow restrictions available for revocation">
                {response.revocable.map((restriction) => (
                  <li key={restriction.banId} className="space-y-1 break-all text-sm">
                    <p>
                      Restriction {restriction.banId} expires{" "}
                      <time dateTime={restriction.expiresAt}>{restriction.expiresAt}</time>.
                    </p>
                    <Button
                      className="h-auto max-w-full whitespace-normal"
                      variant="outline"
                      disabled={locked}
                      onClick={() =>
                        plan({
                          kind: "revoke",
                          sourceActionId: restriction.sourceActionId,
                          banId: restriction.banId,
                        })
                      }
                    >
                      Prepare revocation of this restriction
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No current restriction created by this workflow is available for revocation.</p>
            )}
            <ul className="space-y-3" aria-label="Member response plans">
              {response.plans.map((entry) => (
                <li key={entry.actionId} className="min-w-0 space-y-2 rounded border p-3 text-sm">
                  <p>
                    {entry.operation.kind === "restrict"
                      ? `Temporary site restriction for ${entry.operation.durationSeconds} seconds`
                      : "Revoke the selected workflow restriction"}{" "}
                    · {entry.state}
                  </p>
                  <p className="break-all">Action: {entry.actionId}</p>
                  <p>
                    Approval expires{" "}
                    <time dateTime={entry.approvalExpiresAt}>{entry.approvalExpiresAt}</time>.
                  </p>
                  <Link
                    className="underline"
                    prefetch={false}
                    href={`/admin/agents/approvals/${encodeURIComponent(entry.approvalId)}`}
                  >
                    Review human approval
                  </Link>
                  {entry.canExecute ? (
                    <Button
                      className="h-auto max-w-full whitespace-normal"
                      disabled={locked}
                      onClick={() => {
                        void send(() => ({
                          path: "execute",
                          body: npRequireAgentMemberResponseExecuteInputV1({
                            schemaVersion: "np.agent-member-response-execute-input.v1",
                            expectedVersion: response.incidentVersion,
                            actionId: entry.actionId,
                            approvalId: entry.approvalId,
                            proposalHash: entry.proposalHash,
                            idempotencyKey: crypto.randomUUID(),
                          }),
                        }));
                      }}
                    >
                      Execute this approved Member response
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {pending ? (
          <Button
            className="h-auto max-w-full whitespace-normal"
            variant="outline"
            disabled={busy || blocked}
            onClick={() => {
              void send(() => pending);
            }}
          >
            Retry unchanged Member response request
          </Button>
        ) : null}
        <Button variant="outline" disabled={locked} onClick={state.reload}>
          Refresh Member response
        </Button>
      </AgentRecoveryBoundary>
    </section>
  );
}
