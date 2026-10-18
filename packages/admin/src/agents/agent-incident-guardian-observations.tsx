import * as React from "react";
import Link from "next/link";
import type {
  NpAgentGuardianContentEvidenceV1,
  NpAgentGuardianRuntimeEvidenceV1,
  NpAgentGuardianHttpEvidenceV1,
  NpAgentGuardianExternalEvidenceV1,
  NpAgentGuardianAssessmentV1,
  NpAgentGuardianSessionEvidenceV1,
} from "@nexpress/core/agent-contract";

export function IncidentGuardianSessionEvidence({
  evidence,
}: {
  evidence: NpAgentGuardianSessionEvidenceV1[] | null;
}) {
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-guardian-login">
      <h3 id="incident-guardian-login" className="font-semibold">
        Guardian login observations
      </h3>
      <p className="text-sm">
        A trusted successful login followed a bounded group of failures. This observation alone does
        not prove account compromise.
      </p>
      {evidence === null ? (
        <p>Verified login evidence is unavailable.</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((entry) => (
            <li key={entry.signalId} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm">
              <p>
                Audience: {entry.audience === "staff" ? "Staff" : "Member"} · At least{" "}
                {entry.precedingFailureCount} preceding failures
              </p>
              <p className="break-all">
                Successful login observed:{" "}
                <time dateTime={entry.successfulLoginAt}>{entry.successfulLoginAt}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function IncidentGuardianContentEvidence({
  evidence,
}: {
  evidence: NpAgentGuardianContentEvidenceV1[] | null;
}) {
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-guardian-content">
      <h3 id="incident-guardian-content" className="font-semibold">
        Guardian content activity
      </h3>
      <p className="text-sm">
        These lower bounds describe observed saves and new autosave revisions. Distinct accounts do
        not prove distinct people or abuse. Scheduled publication and deletion are outside this
        observation.
      </p>
      {evidence === null ? (
        <p>Verified content activity evidence is unavailable.</p>
      ) : evidence.length === 0 ? (
        <p>No verified content observations are visible.</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((entry) => (
            <li key={entry.signalId} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm">
              <h4 className="font-medium">
                {entry.basis === "committed-saves" ? "Repeated document saves" : "Revision volume"}
              </h4>
              <p>
                Collection: <span className="break-all">{entry.document.collection}</span>
              </p>
              <p>
                At least {entry.observedCount}{" "}
                {entry.basis === "committed-saves" ? "committed saves" : "persisted revisions"} ·{" "}
                {entry.distinctAccountCount} distinct authenticated accounts in this evidence
                cohort.
              </p>
              <p className="break-all">
                Observed window:{" "}
                <time dateTime={entry.window.startedAt}>{entry.window.startedAt}</time> –{" "}
                <time dateTime={entry.window.endedAt}>{entry.window.endedAt}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function IncidentGuardianExternalEvidence({
  evidence,
}: {
  evidence: NpAgentGuardianExternalEvidenceV1[] | null;
}) {
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-guardian-external">
      <h3 id="incident-guardian-external" className="font-semibold">
        Guardian external observations
      </h3>
      <p className="text-sm">
        The installed adapter authenticated these external issue reports. A report is an external
        observation, not a verified attack or authority to act.
      </p>
      {evidence === null ? (
        <p>Verified external source evidence is unavailable.</p>
      ) : evidence.length === 0 ? (
        <p>No verified external observations are visible.</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((entry) => (
            <li key={entry.signalId} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm">
              <h4 className="font-medium">Sentry error issue created</h4>
              <p>Source: Authenticated external fact · One observed issue</p>
              <p className="break-all">
                Observed: <time dateTime={entry.observedAt}>{entry.observedAt}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function IncidentGuardianAssessment({
  assessment,
}: {
  assessment: NpAgentGuardianAssessmentV1;
}) {
  return (
    <div className="min-w-0 space-y-2 break-words">
      <p className="font-medium">Guardian AI assessment: {assessment.disposition}</p>
      <p className="text-sm">
        Advisory model output. The model score ({assessment.confidenceBasisPoints / 100} / 100) is
        not a calibrated probability. This assessment does not change severity, close the Incident
        or approve a response.
      </p>
      <p className="whitespace-pre-wrap">{assessment.summary}</p>
      <p className="text-sm">
        Assessment codes: {assessment.assessmentCodes.join(", ")}. Evidence references:{" "}
        {assessment.evidenceDigests.length}.
      </p>
      <p className="text-sm">
        {assessment.provenance.provider} / {assessment.provenance.model} · Source observed{" "}
        <time dateTime={assessment.observedAt}>{assessment.observedAt}</time>
      </p>
      <Link
        className="text-primary underline"
        href={`/admin/agents/runs/${assessment.provenance.runId}`}
      >
        Review assessment Run
      </Link>
    </div>
  );
}

const runtimeLabels: Record<NpAgentGuardianRuntimeEvidenceV1["detectorId"], string> = {
  "guardian.repeated-proposals": "Repeated capability proposals",
  "guardian.denied-scopes": "Denied capability scopes",
  "guardian.spend-velocity": "Known provider cost threshold",
  "guardian.action-velocity": "Admitted Action volume",
};
export function IncidentGuardianRuntimeEvidence({
  evidence,
}: {
  evidence: NpAgentGuardianRuntimeEvidenceV1[] | null;
}) {
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-guardian-runtime">
      <h3 id="incident-guardian-runtime" className="font-semibold">
        Guardian Runtime observations
      </h3>
      <p className="text-sm">
        Committed Runtime facts met a bounded review threshold. These counts do not establish
        malicious intent or authorize a response. Cost totals cover the retained cohort only.
      </p>
      {evidence === null ? (
        <p>Verified Runtime evidence is unavailable.</p>
      ) : evidence.length === 0 ? (
        <p>No verified Runtime observations are visible.</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((entry) => (
            <li key={entry.signalId} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm">
              <h4 className="font-medium">{runtimeLabels[entry.detectorId]}</h4>
              <p>
                At least {entry.observedCount} observed{" "}
                {entry.detectorId === "guardian.repeated-proposals"
                  ? "proposals"
                  : entry.detectorId === "guardian.action-velocity"
                    ? "Actions"
                    : "provider calls"}
                .
              </p>
              {entry.accounting ? (
                <div>
                  <p>
                    Provider reported: USD{" "}
                    {(entry.accounting.reportedCostMicros / 1_000_000).toFixed(6)} (
                    {entry.accounting.reportedCallCount} calls).
                  </p>
                  <p>
                    Adapter estimated: USD{" "}
                    {(entry.accounting.estimatedCostMicros / 1_000_000).toFixed(6)} (
                    {entry.accounting.estimatedCallCount} calls).
                  </p>
                  <p>
                    Unknown actual cost: {entry.accounting.unknownCallCount} calls. Their reserved
                    budget charge is USD{" "}
                    {(entry.accounting.unknownBudgetChargeMicros / 1_000_000).toFixed(6)}.
                  </p>
                  <p>Released reservations: {entry.accounting.releasedCallCount} calls.</p>
                </div>
              ) : null}
              <p className="break-all">
                Observed window:{" "}
                <time dateTime={entry.window.startedAt}>{entry.window.startedAt}</time> –{" "}
                <time dateTime={entry.window.endedAt}>{entry.window.endedAt}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function IncidentGuardianHttpEvidence({
  evidence,
}: {
  evidence: NpAgentGuardianHttpEvidenceV1[] | null;
}) {
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-guardian-http">
      <h3 id="incident-guardian-http" className="font-semibold">
        Guardian HTTP responses
      </h3>
      <p className="text-sm">
        Actual final responses met a bounded review threshold within one route family and network
        bucket. A response code, including 404, does not establish an attack or identify a person.
      </p>
      {evidence === null ? (
        <p>Verified HTTP response evidence is unavailable.</p>
      ) : evidence.length === 0 ? (
        <p>No verified HTTP observations are visible.</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((entry) => (
            <li key={entry.signalId} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm">
              <h4 className="font-medium">
                HTTP {entry.status} · {entry.routeFamily}
              </h4>
              <p>At least {entry.observedCount} responses in the retained cohort.</p>
              <p className="break-all">
                Observed window:{" "}
                <time dateTime={entry.window.startedAt}>{entry.window.startedAt}</time> –{" "}
                <time dateTime={entry.window.endedAt}>{entry.window.endedAt}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
