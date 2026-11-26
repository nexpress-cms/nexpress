"use client";

import * as React from "react";
import {
  npRequireAgentIncidentNotificationDeliveriesV1,
  type NpAgentIncidentNotificationDeliveryItemV1,
} from "@nexpress/core/agent-contract";
import { runtimeAccessLost, useRuntimeResource } from "./agent-runtime-api.js";
import { AgentRecoveryBoundary } from "./agent-recovery.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { Button } from "../ui/button.js";

const states: Record<NpAgentIncidentNotificationDeliveryItemV1["state"], string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  suppressed: "Suppressed",
};
const outcomes: Record<NpAgentIncidentNotificationDeliveryItemV1["outcome"], string> = {
  pending: "Pending dispatch",
  confirmed: "Delivery confirmed",
  "not-sent": "Confirmed not sent",
  unknown: "Delivery outcome unknown",
  suppressed: "Suppressed before dispatch",
};

/** Read retained staff-authorized facts. Loading or refreshing never dispatches a notification. */
export function IncidentNotificationDeliveries({
  incidentId,
  onAccessLost,
}: {
  incidentId: string;
  onAccessLost: (error: unknown) => void;
}) {
  const [cursor, setCursor] = React.useState<string | null>(null);
  const parse = React.useCallback(
    (value: unknown) => {
      const result = npRequireAgentIncidentNotificationDeliveriesV1(value);
      if (result.incidentId !== incidentId)
        throw new Error("Incident delivery binding is invalid.");
      return result;
    },
    [incidentId],
  );
  const path = `/api/admin/agents/incidents/${encodeURIComponent(incidentId)}/deliveries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const state = useRuntimeResource(path, parse);
  const deliveries = state.loading ? null : state.value;
  const stale = state.failure instanceof AgentStudioApiError && state.failure.status === 409;
  const unavailable = state.failure instanceof AgentStudioApiError && state.failure.status === 503;
  React.useEffect(() => {
    if (runtimeAccessLost(state.failure)) onAccessLost(state.failure);
  }, [state.failure, onAccessLost]);
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border p-4"
      aria-labelledby="incident-external-deliveries"
    >
      <h3 id="incident-external-deliveries" className="font-semibold">
        External notification delivery
      </h3>
      <p className="text-sm text-neutral-500">
        Recorded email, Slack, webhook and SIEM delivery status for this incident. Local Admin
        notification recording is separate. Refreshing only reads status; it does not send or retry
        a message.
      </p>
      <AgentRecoveryBoundary error={state.failure}>
        {state.loading ? <p role="status">Loading external notification delivery…</p> : null}
        {state.error ? (
          <p role="alert">
            {unavailable
              ? "External notification delivery is disabled or unavailable."
              : "External notification delivery status is unavailable."}{" "}
            {stale
              ? "This page is no longer current. Return to the first delivery page."
              : unavailable
                ? "No delivery outcome can be inferred."
                : state.error}
          </p>
        ) : null}
        {deliveries ? (
          <>
            {deliveries.items.length === 0 ? (
              <p>
                {deliveries.nextCursor
                  ? "No visible deliveries on this page. Continue to the next page."
                  : "No visible external delivery records for this incident."}
              </p>
            ) : null}
            <ul className="grid gap-3 md:grid-cols-2">
              {deliveries.items.map((item) => (
                <li
                  key={item.notificationId}
                  className="min-w-0 space-y-2 rounded-lg border p-3 text-sm"
                >
                  <p className="font-medium">
                    {item.channel === "siem"
                      ? "SIEM"
                      : item.channel === "slack"
                        ? "Slack"
                        : item.channel === "email"
                          ? "Email"
                          : "Webhook"}{" "}
                    · {states[item.state]}
                  </p>
                  <p>
                    {outcomes[item.outcome]}
                    {item.outcome === "unknown"
                      ? ". The message may have been delivered; this is not a confirmed failure to send."
                      : "."}
                  </p>
                  <p>
                    Recorded incident version: {item.incidentVersion} · Attempts: {item.attempts}
                  </p>
                  <p className="break-all">Connection: {item.connectionId}</p>
                  {item.lastErrorCode ? (
                    <p className="break-all">
                      Error code: <code>{item.lastErrorCode}</code>
                    </p>
                  ) : null}
                  <p>
                    Updated: <time dateTime={item.updatedAt}>{item.updatedAt}</time>
                  </p>
                  {item.nextAttemptAt ? (
                    <p>
                      Next eligible attempt:{" "}
                      <time dateTime={item.nextAttemptAt}>{item.nextAttemptAt}</time>
                    </p>
                  ) : null}
                  {item.sentAt ? (
                    <p>
                      Confirmed sent: <time dateTime={item.sentAt}>{item.sentAt}</time>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {cursor ? (
            <Button variant="outline" disabled={state.loading} onClick={() => setCursor(null)}>
              First delivery page
            </Button>
          ) : null}
          {deliveries?.nextCursor ? (
            <Button variant="outline" onClick={() => setCursor(deliveries.nextCursor)}>
              Next delivery page
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={state.loading || (stale && cursor !== null)}
            onClick={state.reload}
          >
            Refresh delivery status
          </Button>
        </div>
      </AgentRecoveryBoundary>
    </section>
  );
}
