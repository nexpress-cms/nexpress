"use client";

import * as React from "react";
import {
  npRequireAgentIncidentEvidenceV1,
  type NpAgentIncidentStudioDetailV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeAccessLost, useRuntimeResource } from "./agent-runtime-api.js";
import { AgentRecoveryBoundary } from "./agent-recovery.js";
import { Button } from "../ui/button.js";

export function IncidentEvidence({
  detail,
  onSelect,
  onClearSelection,
  onAccessLost,
  onConflict,
}: {
  detail: NpAgentIncidentStudioDetailV1;
  onSelect: (index: string) => void;
  onClearSelection: () => void;
  onAccessLost: (error: unknown) => void;
  onConflict: () => void;
}) {
  const [cursor, setCursor] = React.useState<string | null>(null);
  const path = `/api/admin/agents/incidents/${encodeURIComponent(detail.incident.id)}/evidence${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const state = useRuntimeResource(path, npRequireAgentIncidentEvidenceV1);
  const evidence = state.loading ? null : state.value;
  const staleTarget = evidence?.items.some((item) => {
    if (!item.target || !item.current) return false;
    const target = item.target;
    const current = item.current;
    const choices =
      detail.response?.choices.filter(
        (choice) =>
          choice.capabilityId === "moderation.quarantine" &&
          choice.target.kind === target.kind &&
          choice.target.collection === target.collection &&
          choice.target.id === target.id,
      ) ?? [];
    return (
      choices.length > 0 &&
      !choices.some((choice) => choice.expectedVersionDigest === current.versionDigest)
    );
  });
  const mismatch = Boolean(
    evidence &&
    (evidence.incidentId !== detail.incident.id ||
      evidence.incidentVersion !== detail.incident.versionNumber ||
      staleTarget),
  );
  React.useEffect(() => {
    if (!state.failure && !mismatch) return;
    onClearSelection();
    if (runtimeAccessLost(state.failure)) onAccessLost(state.failure);
    else if (
      mismatch ||
      (state.failure instanceof AgentStudioApiError &&
        (state.failure.status === 409 ||
          (state.failure.status === 400 &&
            state.failure.code === "INCIDENT_EVIDENCE_CURSOR_INVALID")))
    )
      onConflict();
  }, [state.failure, mismatch, onClearSelection, onAccessLost, onConflict]);

  function page(next: string | null) {
    onClearSelection();
    setCursor(next);
  }
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-comment-evidence">
      <h3 id="incident-comment-evidence" className="font-semibold">
        Comment evidence
      </h3>
      <p className="text-sm text-neutral-500">
        Compare recorded observation metadata with the comment’s current state. Comment content and
        author details are not included. The current version is not a historical version.
      </p>
      <AgentRecoveryBoundary error={state.failure}>
        {state.loading ? <p role="status">Loading comment evidence…</p> : null}
        {state.error ? <p role="alert">Comment evidence is unavailable. {state.error}</p> : null}
        {mismatch ? (
          <p role="alert">Evidence changed. Refresh the incident before continuing.</p>
        ) : null}
        {evidence && !mismatch ? (
          <>
            {evidence.items.length === 0 ? <p>No visible comment evidence on this page.</p> : null}
            <ul className="space-y-3">
              {evidence.items.map((item) => {
                const choiceIndex =
                  detail.response?.choices.findIndex(
                    (choice) =>
                      item.target !== null &&
                      choice.capabilityId === "moderation.quarantine" &&
                      choice.target.kind === item.target?.kind &&
                      choice.target.collection === item.target.collection &&
                      choice.target.id === item.target.id &&
                      choice.expectedVersionDigest === item.current?.versionDigest,
                  ) ?? -1;
                const eligible = item.responseEligible && choiceIndex >= 0;
                return (
                  <li
                    key={item.eventId}
                    className="space-y-3 break-words rounded-lg border p-3 text-sm"
                  >
                    <p className="break-all">Event {item.eventId}</p>
                    <p className="break-all">Signals: {item.signalIds.join(", ")}</p>
                    {item.availability === "available" &&
                    item.observed &&
                    item.current &&
                    item.target ? (
                      <>
                        <p className="break-all">
                          Comment: {item.target.collection} · {item.target.id}
                        </p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1">
                            <h4 className="font-medium">Recorded observation</h4>
                            <p>Status: {item.observed.status}</p>
                            <p>
                              Spam: {item.observed.spamVerdict} · Profanity:{" "}
                              {item.observed.profanityVerdict}
                            </p>
                            <p>
                              Observed:{" "}
                              <time dateTime={item.observed.occurredAt}>
                                {item.observed.occurredAt}
                              </time>
                            </p>
                            <p>
                              Retention eligible after:{" "}
                              <time dateTime={item.observed.retentionExpiresAt}>
                                {item.observed.retentionExpiresAt}
                              </time>
                            </p>
                            <p>
                              References can retain evidence beyond this date; it is not an expiry
                              guarantee.
                            </p>
                          </div>
                          <div className="min-w-0 space-y-1">
                            <h4 className="font-medium">Current comment</h4>
                            <p>Compared with observation: {item.current.state}</p>
                            <p>Status: {item.current.status}</p>
                            <p>Edited: {item.current.editedAt ?? "No edit recorded"}</p>
                            <p className="break-all">
                              Current version: {item.current.versionDigest}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          disabled={!eligible}
                          onClick={() => onSelect(String(choiceIndex))}
                        >
                          Select for response plan
                        </Button>
                        {!eligible ? (
                          <p>
                            {item.responseEligible
                              ? "This version does not match a current response target. Refresh the incident to review it again."
                              : "This evidence is not eligible for a new response plan."}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p>
                        Evidence is unavailable. Its current state and retention outcome cannot be
                        determined.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-3">
              {cursor ? (
                <Button variant="outline" onClick={() => page(null)}>
                  First evidence page
                </Button>
              ) : null}
              {evidence.nextCursor ? (
                <Button variant="outline" onClick={() => page(evidence.nextCursor)}>
                  Next evidence page
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
        <Button
          variant="outline"
          disabled={state.loading}
          onClick={() => {
            onClearSelection();
            state.reload();
          }}
        >
          Refresh comment evidence
        </Button>
      </AgentRecoveryBoundary>
    </section>
  );
}
