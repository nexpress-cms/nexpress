"use client";

import * as React from "react";
import {
  npRequireAgentIncidentMemberReportEvidenceV1,
  type NpAgentIncidentStudioDetailV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeAccessLost, useRuntimeResource } from "./agent-runtime-api.js";
import { AgentRecoveryBoundary } from "./agent-recovery.js";
import { Button } from "../ui/button.js";

export function IncidentMemberReportEvidence({
  detail,
  onClearSelection,
  onAccessLost,
  onConflict,
}: {
  detail: NpAgentIncidentStudioDetailV1;
  onClearSelection: () => void;
  onAccessLost: (error: unknown) => void;
  onConflict: () => void;
}) {
  const [cursor, setCursor] = React.useState<string | null>(null);
  const path = `/api/admin/agents/incidents/${encodeURIComponent(detail.incident.id)}/member-report-evidence${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const state = useRuntimeResource(path, npRequireAgentIncidentMemberReportEvidenceV1);
  const evidence = state.loading ? null : state.value;
  const subject = detail.incident.primarySubject;
  const mismatch = Boolean(
    evidence &&
    (evidence.incidentId !== detail.incident.id ||
      evidence.incidentVersion !== detail.incident.versionNumber ||
      subject?.kind !== "member" ||
      evidence.items.some((item) => item.target && item.target.id !== subject.memberId)),
  );
  React.useEffect(() => {
    onClearSelection();
  }, [state.loading, evidence, onClearSelection]);
  React.useEffect(() => {
    if (!state.failure && !mismatch) return;
    onClearSelection();
    if (runtimeAccessLost(state.failure)) onAccessLost(state.failure);
    else if (
      mismatch ||
      (state.failure instanceof AgentStudioApiError &&
        (state.failure.status === 409 ||
          (state.failure.status === 400 &&
            state.failure.code === "INCIDENT_MEMBER_REPORT_EVIDENCE_CURSOR_INVALID")))
    )
      onConflict();
  }, [state.failure, mismatch, onClearSelection, onAccessLost, onConflict]);

  function page(next: string | null) {
    onClearSelection();
    setCursor(next);
  }
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-member-report-evidence">
      <h3 id="incident-member-report-evidence" className="font-semibold">
        Member report evidence
      </h3>
      <p className="text-sm text-neutral-500">
        Compare the filed report with the member’s current global account status and this site’s
        report status. A report is an unverified claim. Member profiles and reporter details are not
        included. This evidence does not authorize an account action.
      </p>
      <AgentRecoveryBoundary error={state.failure}>
        {state.loading ? <p role="status">Loading member report evidence…</p> : null}
        {state.error ? (
          <p role="alert">Member report evidence is unavailable. {state.error}</p>
        ) : null}
        {mismatch ? (
          <p role="alert">Evidence changed. Refresh the incident before continuing.</p>
        ) : null}
        {evidence && !mismatch ? (
          <>
            {evidence.items.length === 0 ? <p>No visible member reports on this page.</p> : null}
            <ul className="space-y-3">
              {evidence.items.map((item) => (
                <li
                  key={item.eventId}
                  className="space-y-3 break-words rounded-lg border p-3 text-sm"
                >
                  <p className="break-all">Event {item.eventId}</p>
                  <p className="break-all">Signals: {item.signalIds.join(", ")}</p>
                  {item.availability === "available" &&
                  item.target &&
                  item.observed &&
                  item.current ? (
                    <>
                      <p className="break-all">Member: {item.target.id}</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <h4 className="font-medium">Filed member report</h4>
                          <p>Recorded account status: {item.observed.status}</p>
                          <p>Claim: unverified. No abuse assessment was recorded.</p>
                          <p>
                            Filed:{" "}
                            <time dateTime={item.observed.occurredAt}>
                              {item.observed.occurredAt}
                            </time>
                          </p>
                          <p>
                            Eligible for cleanup after:{" "}
                            <time dateTime={item.observed.retentionExpiresAt}>
                              {item.observed.retentionExpiresAt}
                            </time>
                          </p>
                          <p>
                            References can retain evidence beyond this date. This is not proof of
                            deletion.
                          </p>
                        </div>
                        <div className="space-y-1">
                          <h4 className="font-medium">Current member</h4>
                          <p>Compared with filed account state: {item.current.state}</p>
                          <p>Global account status: {item.current.status}</p>
                          <p>
                            Account updated:{" "}
                            <time dateTime={item.current.updatedAt}>{item.current.updatedAt}</time>
                          </p>
                          <p className="break-all">
                            Current account version: {item.current.versionDigest}
                          </p>
                          <p>Site report status: {item.current.report.status}</p>
                          <p>
                            Report resolved:{" "}
                            {item.current.report.resolvedAt ? (
                              <time dateTime={item.current.report.resolvedAt}>
                                {item.current.report.resolvedAt}
                              </time>
                            ) : (
                              "Not resolved"
                            )}
                          </p>
                          <p>Resolving a site report does not change the global account status.</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p>
                      Evidence is unavailable. Its current account state and retention outcome
                      cannot be determined.
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              {cursor ? (
                <Button variant="outline" onClick={() => page(null)}>
                  First member report page
                </Button>
              ) : null}
              {evidence.nextCursor ? (
                <Button variant="outline" onClick={() => page(evidence.nextCursor)}>
                  Next member report page
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
          Refresh member report evidence
        </Button>
      </AgentRecoveryBoundary>
    </section>
  );
}
