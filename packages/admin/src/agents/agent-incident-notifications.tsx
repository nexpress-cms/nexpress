"use client";

import * as React from "react";
import Link from "next/link";
import { npRequireAgentIncidentNotificationsV1 } from "@nexpress/core/agent-contract";
import { runtimeAccessLost, useRuntimeResource } from "./agent-runtime-api.js";
import { AgentRecoveryBoundary } from "./agent-recovery.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { Button } from "../ui/button.js";

export function IncidentNotifications({
  onAccessLost,
}: {
  onAccessLost: (error: unknown) => void;
}) {
  const [cursor, setCursor] = React.useState<string | null>(null);
  const path = `/api/admin/agents/incidents/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const state = useRuntimeResource(path, npRequireAgentIncidentNotificationsV1);
  const notifications = state.loading ? null : state.value;
  React.useEffect(() => {
    if (runtimeAccessLost(state.failure)) onAccessLost(state.failure);
  }, [state.failure, onAccessLost]);
  const stale =
    state.failure instanceof AgentStudioApiError &&
    (state.failure.status === 409 ||
      state.failure.code === "INCIDENT_NOTIFICATIONS_CURSOR_INVALID");
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border p-4"
      aria-labelledby="incident-notifications"
    >
      <h3 id="incident-notifications" className="font-semibold">
        Incident notifications
      </h3>
      <p className="text-sm text-neutral-500">
        Recorded incident updates, independent of the list filters below. Status and severity
        describe the notification when it was recorded. Open the incident to review its current
        state.
      </p>
      <AgentRecoveryBoundary error={state.failure}>
        {state.loading ? <p role="status">Loading incident notifications…</p> : null}
        {state.error ? (
          <p role="alert">
            Incident notifications are unavailable.{" "}
            {stale
              ? "This page is no longer current. Return to the first notification page."
              : state.error}
          </p>
        ) : null}
        {notifications ? (
          <>
            {notifications.items.length === 0 ? (
              <p>
                {notifications.nextCursor
                  ? "No visible notifications on this page. Continue to the next page."
                  : "No visible incident notifications."}
              </p>
            ) : null}
            <ul className="grid gap-3 md:grid-cols-2">
              {notifications.items.map((item) => (
                <li
                  key={item.notificationId}
                  className="min-w-0 space-y-2 rounded-lg border p-3 text-sm"
                >
                  <p className="font-medium">{item.summary}</p>
                  <p>
                    Recorded status: {item.status} · Recorded severity: {item.severity}
                  </p>
                  <p>Recorded incident version: {item.incidentVersion}</p>
                  <p>
                    Recorded: <time dateTime={item.createdAt}>{item.createdAt}</time>
                  </p>
                  <Link
                    className="block break-all underline"
                    href={`/admin/agents/incidents/${encodeURIComponent(item.incidentId)}`}
                  >
                    Open incident {item.incidentId}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {cursor ? (
            <Button variant="outline" disabled={state.loading} onClick={() => setCursor(null)}>
              First notification page
            </Button>
          ) : null}
          {notifications?.nextCursor ? (
            <Button variant="outline" onClick={() => setCursor(notifications.nextCursor)}>
              Next notification page
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={state.loading || (stale && cursor !== null)}
            onClick={state.reload}
          >
            Refresh notifications
          </Button>
        </div>
      </AgentRecoveryBoundary>
    </section>
  );
}
