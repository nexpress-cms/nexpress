import * as React from "react";
import type { NpAgentGuardianEvidenceV1 } from "@nexpress/core/agent-contract";

export function IncidentGuardianEvidence({
  evidence,
}: {
  evidence: NpAgentGuardianEvidenceV1[] | null;
}) {
  return (
    <section className="space-y-3" aria-labelledby="incident-guardian-observations">
      <h3 id="incident-guardian-observations" className="font-semibold">
        Guardian observations
      </h3>
      <p className="text-sm">
        These observations use fixed rule thresholds. They are a reason to review activity, not
        proof of an attack. Existing sign-in lockout and request limits continue to enforce their
        own rules.
      </p>
      {evidence === null ? (
        <p>Verified Guardian observations are unavailable.</p>
      ) : evidence.length === 0 ? (
        <p>No visible Guardian observations.</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((item) => (
            <li key={item.signalId} className="space-y-1 break-words rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {item.detectorId === "guardian.login-failures"
                  ? "Failed sign-ins"
                  : "Requests limited"}
              </p>
              {item.audience !== null ? (
                <p>Account audience: {item.audience === "staff" ? "Staff" : "Members"}</p>
              ) : null}
              {item.routeFamily !== null ? (
                <p>Route family: {item.routeFamily.replaceAll("-", " ")}</p>
              ) : null}
              <p>
                At least {item.observedCount} observations · Rule threshold: {item.threshold}
              </p>
              <p className="text-neutral-500">
                This count is a lower bound, not the total activity during this window.
              </p>
              <p>
                Window: <time dateTime={item.window.startedAt}>{item.window.startedAt}</time> to{" "}
                <time dateTime={item.window.endedAt}>{item.window.endedAt}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
