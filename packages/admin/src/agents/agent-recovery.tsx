"use client";

import * as React from "react";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { Button } from "../ui/button.js";

/** A deadline only enables an explicit retry; it never replays a request. */
export function useAgentRetryBlocked(error: unknown): boolean {
  const retryAt = error instanceof AgentStudioApiError ? error.retryAt : undefined;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (retryAt === undefined || retryAt <= now) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(retryAt - Date.now(), 60_000)),
    );
    return () => clearTimeout(timer);
  }, [retryAt, now]);
  return retryAt !== undefined && retryAt > now;
}

/** Fixed guidance is declared by the server, never inferred from an exception message. */
export function AgentErrorDiagnostics({ error }: { error: AgentStudioApiError }) {
  const diagnostics = error.diagnostics;
  const guidance = diagnostics
    ? {
        "retry-read":
          "You can explicitly retry loading this information. No change will be replayed.",
        reauthenticate:
          "Sign in or complete staff reauthentication, then reload current information.",
        reconcile: "Reload current facts and reconcile your changes before submitting again.",
        "check-outcome":
          "The change outcome may be unknown. Check current activity before trying again; preserve the original request identity for an unchanged retry.",
        none: "No retry is declared for this error.",
      }[diagnostics.recovery]
    : "Recovery guidance is unavailable for this response.";
  return (
    <div className="space-y-1 text-sm" role="status">
      <p>
        Error code: <code>{error.code}</code>
      </p>
      <p>
        Support reference:{" "}
        {diagnostics ? (
          <code className="break-all">{diagnostics.supportReference}</code>
        ) : (
          "Unavailable"
        )}
      </p>
      <p>{guidance}</p>
    </div>
  );
}

/** Preserve mounted drafts during throttling, but discard sensitive UI on authentication loss. */
export function AgentRecoveryBoundary({
  error,
  retry,
  children,
}: {
  error?: unknown;
  retry?: () => void;
  children: React.ReactNode;
}) {
  const waiting = useAgentRetryBlocked(error);
  const failure = error instanceof AgentStudioApiError ? error : null;
  const loginNotice = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (failure?.status === 401) loginNotice.current?.focus();
  }, [failure?.status]);
  if (failure?.status === 401)
    return (
      <div ref={loginNotice} tabIndex={-1} role="alert" className="space-y-2 rounded-lg border p-4">
        <p>Your session is no longer available. Sign in again to load current information.</p>
        <AgentErrorDiagnostics error={failure} />
        <Button asChild variant="outline">
          <a href="/admin/login">Sign in</a>
        </Button>
      </div>
    );
  return (
    <div className="min-w-0 space-y-3">
      {failure ? <AgentErrorDiagnostics error={failure} /> : null}
      {failure?.status === 429 ? (
        <div role="status" className="space-y-2 rounded-lg border p-4">
          <p>{failure.message}</p>
          {failure.retryAt !== undefined ? (
            <p>
              {waiting ? "Server wait ends: " : "Server wait ended: "}
              <time dateTime={new Date(failure.retryAt).toISOString()}>
                {new Date(failure.retryAt).toISOString()}
              </time>
            </p>
          ) : (
            <p>No retry time was provided.</p>
          )}
          {retry && failure.diagnostics?.recovery === "retry-read" ? (
            <Button variant="outline" disabled={waiting} onClick={retry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={waiting} className="min-w-0 space-y-3">
        {children}
      </fieldset>
    </div>
  );
}
