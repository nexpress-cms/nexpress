"use client";

import * as React from "react";
import Link from "next/link";
import {
  npRequireAgentGuardianSessionV1,
  npRequireAgentGuardianSessionPlanInputV1,
  npRequireAgentGuardianSessionExecuteInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  type NpAgentGuardianSessionPlanInputV1,
  type NpAgentGuardianSessionExecuteInputV1,
} from "@nexpress/core/agent-contract";
import { runtimeAccessLost, runtimeRequest, useRuntimeResource } from "./agent-runtime-api.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { Button } from "../ui/button.js";

type Pending = {
  path: "plan" | "execute";
  body: NpAgentGuardianSessionPlanInputV1 | NpAgentGuardianSessionExecuteInputV1;
};
export function IncidentGuardianSession({
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
  const root = `/api/admin/agents/incidents/${encodeURIComponent(incidentId)}/guardian-session`;
  const parse = React.useCallback(
    (value: unknown) => {
      const result = npRequireAgentGuardianSessionV1(value);
      if (result.incidentId !== incidentId || result.incidentVersion !== incidentVersion)
        throw new AgentStudioApiError(
          "The Guardian Incident changed.",
          409,
          "GUARDIAN_SESSION_CONFLICT",
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
          ? "Plan prepared. A different super administrator must approve it before a separate execution request."
          : "Request acknowledged. Review the retained session revocation result below.",
      );
      state.reload();
      onSuccess();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!dispatched) {
        setMessage("Reload and review the current session target before preparing a plan.");
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
  function plan() {
    if (!response) return;
    void send(() => ({
      path: "plan",
      body: npRequireAgentGuardianSessionPlanInputV1({
        schemaVersion: "np.agent-guardian-session-plan-input.v1",
        expectedVersion: response.incidentVersion,
        expectedTargetVersionDigest: response.targetVersionDigest,
        idempotencyKey: crypto.randomUUID(),
      }),
    }));
  }
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border p-4"
      aria-labelledby="incident-guardian-session"
    >
      <h3 id="incident-guardian-session" className="font-semibold">
        Guardian session revocation
      </h3>
      <p className="text-sm">
        Review the server-verified login session linked to this Incident. Repeated failures followed
        by a successful login require investigation; they do not prove an attack. Revocation ends
        access and refresh for this exact session family across the deployment. It cannot be undone.
        The user may sign in again. A different super administrator must approve, then the requester
        must explicitly execute the plan.
      </p>
      <AgentRecoveryBoundary error={state.failure ?? failure}>
        {state.loading ? <p role="status">Loading current session facts…</p> : null}
        {state.error ? (
          <p role="alert">
            {state.failure instanceof AgentStudioApiError && state.failure.status === 503
              ? "Session revocation is disabled or its current policy is unavailable."
              : state.error}
          </p>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
        {response ? (
          <>
            <dl className="grid gap-2 text-sm">
              <dt>Session audience</dt>
              <dd>{response.target.actorKind}</dd>
              <dt>Exact session family</dt>
              <dd className="break-all">{response.target.sessionFamilyId}</dd>
              <dt>Session created</dt>
              <dd>
                <time dateTime={response.target.createdAt}>{response.target.createdAt}</time>
              </dd>
              <dt>Impact</dt>
              <dd>Deployment · {response.target.affectedSiteCount} sites</dd>
              <dt>Required human authority</dt>
              <dd>Super administrator</dd>
            </dl>
            {response.truncated ? (
              <p>Only a bounded set of plans is shown. Reload before preparing another plan.</p>
            ) : null}
            {response.canPlan ? (
              <Button type="button" disabled={locked} onClick={plan}>
                Prepare session revocation plan
              </Button>
            ) : null}
            <ul className="space-y-3">
              {response.plans.map((entry) => (
                <li key={entry.actionId} className="min-w-0 space-y-2 rounded border p-3">
                  <p className="break-words">Revoke this exact session · {entry.state}</p>
                  <p className="break-all text-sm">Action {entry.actionId}</p>
                  <Link
                    href={`/admin/agents/approvals/${entry.approvalId}`}
                    className="text-sm underline"
                  >
                    Review human approval
                  </Link>
                  <p className="text-sm">Approval expires: {entry.approvalExpiresAt}</p>
                  {entry.state === "succeeded" ? (
                    <p role="status">
                      Session revoked. Its access and refresh tokens are invalid. A new sign-in
                      creates a new session.
                    </p>
                  ) : null}
                  {entry.canExecute ? (
                    <Button
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        void send(() => ({
                          path: "execute",
                          body: npRequireAgentGuardianSessionExecuteInputV1({
                            schemaVersion: "np.agent-guardian-session-execute-input.v1",
                            expectedVersion: response.incidentVersion,
                            actionId: entry.actionId,
                            approvalId: entry.approvalId,
                            proposalHash: entry.proposalHash,
                            idempotencyKey: crypto.randomUUID(),
                          }),
                        }))
                      }
                    >
                      Execute approved session revocation
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {pending && !busy ? (
          <Button type="button" disabled={blocked} onClick={() => void send(() => pending)}>
            Retry unchanged session revocation request
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={busy || state.loading || blocked}
          onClick={reload}
        >
          Refresh session facts
        </Button>
      </AgentRecoveryBoundary>
    </section>
  );
}
