"use client";

import * as React from "react";
import Link from "next/link";
import {
  npRequireAgentGuardianResponseV1,
  npRequireAgentGuardianResponsePlanInputV1,
  npRequireAgentGuardianResponseExecuteInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  type NpAgentGuardianResponsePlanInputV1,
  type NpAgentGuardianResponseExecuteInputV1,
  type NpAgentGuardianResponseOperationV1,
} from "@nexpress/core/agent-contract";
import { runtimeAccessLost, runtimeRequest, useRuntimeResource } from "./agent-runtime-api.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

type Pending = {
  path: "plan" | "execute";
  body: NpAgentGuardianResponsePlanInputV1 | NpAgentGuardianResponseExecuteInputV1;
};
export function IncidentGuardianResponse({
  incidentId,
  incidentVersion,
  refreshGeneration,
  disabled,
  onWriting,
  onSuccess,
  onAccessLost,
  onConflict,
}: {
  incidentId: string;
  incidentVersion: number;
  refreshGeneration: number;
  disabled: boolean;
  onWriting: (value: boolean) => void;
  onSuccess: () => void;
  onAccessLost: (error: unknown) => void;
  onConflict: () => void;
}) {
  const root = `/api/admin/agents/incidents/${encodeURIComponent(incidentId)}/guardian-response`;
  const parse = React.useCallback(
    (value: unknown) => {
      const result = npRequireAgentGuardianResponseV1(value);
      if (result.incidentId !== incidentId || result.incidentVersion !== incidentVersion)
        throw new AgentStudioApiError(
          "The Guardian Incident changed.",
          409,
          "GUARDIAN_RESPONSE_CONFLICT",
        );
      return result;
    },
    [incidentId, incidentVersion],
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
  const [selectedScopes, setSelectedScopes] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  const blocked = useAgentRetryBlocked(failure);
  const locked = disabled || state.loading || busy || pending !== null;
  React.useEffect(() => {
    if (runtimeAccessLost(state.failure)) onAccessLost(state.failure);
    else if (state.failure instanceof AgentStudioApiError && state.failure.status === 409)
      onConflict();
  }, [state.failure, onAccessLost, onConflict]);
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
          : "Request acknowledged. Review the retained execution and restriction state below.",
      );
      state.reload();
      onSuccess();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!dispatched) {
        setMessage(
          "Select at least one installed scope and enter a whole duration within the current policy limit.",
        );
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
  function plan(operation: NpAgentGuardianResponseOperationV1) {
    if (!response) return;
    void send(() => ({
      path: "plan",
      body: npRequireAgentGuardianResponsePlanInputV1({
        schemaVersion: "np.agent-guardian-response-plan-input.v1",
        expectedVersion: response.incidentVersion,
        expectedTargetVersionDigest: response.targetVersionDigest,
        operation,
        idempotencyKey: crypto.randomUUID(),
      }),
    }));
  }
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border p-4"
      aria-labelledby="incident-guardian-response"
    >
      <h3 id="incident-guardian-response" className="font-semibold">
        Guardian temporary request limits
      </h3>
      <p className="text-sm">
        Limit only the observed network target on this site for 1–60 minutes and explicitly selected
        scopes. Shared networks may include innocent users. Every limit and early removal requires a
        new plan, a different human’s approval and explicit execution. This limit stops denying
        requests at the exact expiry; cleanup may still need verification. Scope coverage is limited
        to supported request routes in the installed proxy.
      </p>
      <AgentRecoveryBoundary error={state.failure ?? failure}>
        {state.loading ? <p role="status">Loading current Guardian response facts…</p> : null}
        {state.error ? (
          <p role="alert">
            {state.failure instanceof AgentStudioApiError && state.failure.status === 503
              ? "Guardian response is disabled or its current policy is unavailable."
              : state.error}
          </p>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
        {response ? (
          <>
            <p className="text-sm">
              Target: the verified network observation attached to this Incident.
            </p>
            {response.truncated ? (
              <p>Only a bounded set of plans is shown. Other restrictions may remain effective.</p>
            ) : null}
            {response.canLimit ? (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  plan({
                    kind: "limit",
                    durationSeconds: Number(duration),
                    actionScopes: response.allowedScopes.filter((scope) =>
                      selectedScopes.includes(scope),
                    ),
                  });
                }}
              >
                <label htmlFor="guardian-restriction-duration">
                  Restriction duration in seconds
                </label>
                <Input
                  id="guardian-restriction-duration"
                  type="number"
                  min={60}
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
                <fieldset className="space-y-2" disabled={locked}>
                  <legend>Request scopes to limit</legend>
                  {response.allowedScopes.map((scope) => (
                    <label key={scope} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope)}
                        onChange={(event) =>
                          setSelectedScopes((prior) =>
                            event.target.checked
                              ? [...prior, scope]
                              : prior.filter((item) => item !== scope),
                          )
                        }
                      />
                      <span>{scope}</span>
                    </label>
                  ))}
                </fieldset>
                <Button
                  className="h-auto max-w-full whitespace-normal"
                  disabled={
                    locked ||
                    !duration ||
                    !response.allowedScopes.some((scope) => selectedScopes.includes(scope))
                  }
                  type="submit"
                >
                  Prepare temporary request limit
                </Button>
              </form>
            ) : (
              <p>
                A new restriction is currently unavailable. Review the Incident, installed
                enforcement and active site restrictions.
              </p>
            )}
            {response.restrictions.length ? (
              <ul className="space-y-2" aria-label="Guardian request restrictions">
                {response.restrictions.map((restriction) => (
                  <li key={restriction.restrictionId} className="space-y-1 break-words text-sm">
                    <p className="break-all">
                      Restriction {restriction.restrictionId} · {restriction.state}
                    </p>
                    <p>
                      Expiry: <time dateTime={restriction.expiresAt}>{restriction.expiresAt}</time>
                    </p>
                    {restriction.lastErrorCode ? (
                      <p role="status">
                        Verification or cleanup needs attention: {restriction.lastErrorCode}. An
                        elapsed expiry does not prove cleanup completed.
                      </p>
                    ) : null}
                    {restriction.canRemove ? (
                      <Button
                        className="h-auto max-w-full whitespace-normal"
                        variant="outline"
                        disabled={locked}
                        onClick={() =>
                          plan({
                            kind: "remove",
                            sourceActionId: restriction.sourceActionId,
                            restrictionId: restriction.restrictionId,
                          })
                        }
                      >
                        Prepare early removal of this limit
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No retained request limits for this Incident.</p>
            )}
            <ul className="space-y-3" aria-label="Guardian response plans">
              {response.plans.map((entry) => (
                <li key={entry.actionId} className="min-w-0 space-y-2 rounded border p-3 text-sm">
                  <p>
                    {entry.operation.kind === "limit"
                      ? `Temporary request limit for ${entry.operation.durationSeconds} seconds (${entry.operation.actionScopes.join(", ")})`
                      : "Remove the selected request limit"}{" "}
                    · {entry.state === "executing" ? "Awaiting verification" : entry.state}
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
                          body: npRequireAgentGuardianResponseExecuteInputV1({
                            schemaVersion: "np.agent-guardian-response-execute-input.v1",
                            expectedVersion: response.incidentVersion,
                            actionId: entry.actionId,
                            approvalId: entry.approvalId,
                            proposalHash: entry.proposalHash,
                            idempotencyKey: crypto.randomUUID(),
                          }),
                        }));
                      }}
                    >
                      {entry.state === "executing"
                        ? "Check result"
                        : "Execute this approved Guardian response"}
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
            Retry unchanged Guardian response request
          </Button>
        ) : null}
        <Button variant="outline" disabled={locked} onClick={state.reload}>
          Refresh Guardian response
        </Button>
      </AgentRecoveryBoundary>
    </section>
  );
}
