import * as React from "react";
import type { NpAgentGuardianSecurityEvidenceV1 } from "@nexpress/core/agent-contract";

const transitionLabels: Record<NpAgentGuardianSecurityEvidenceV1["targetKind"], string> = {
  "site-role": "Site authority elevated",
  "super-admin": "Super administrator granted",
  "agent-policy": "Agent policy activated",
  "password-replaced": "Password replaced",
  "gateway-token": "Gateway token changed",
  "gateway-principal": "Gateway principal changed",
  "connection-credential": "Connection credential changed",
  "plugin-activation": "Plugin activation changed",
  "plugin-config": "Plugin configuration changed",
};

export function IncidentGuardianSecurityEvidence({
  evidence,
}: {
  evidence: NpAgentGuardianSecurityEvidenceV1[] | null;
}) {
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="incident-guardian-security">
      <h3 id="incident-guardian-security" className="font-semibold">
        Guardian security transitions
      </h3>
      <p className="text-sm">
        These observations verify committed authority, policy, credential or plugin changes. Review
        their authorized purpose; a change alone does not establish abuse. Recorded impact describes
        the sites at the time of the change.
      </p>
      {evidence === null ? (
        <p>Verified security transition evidence is unavailable.</p>
      ) : evidence.length === 0 ? (
        <p>No verified security transitions are visible.</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((item) => (
            <li key={item.signalId} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm">
              <h4 className="font-medium">{transitionLabels[item.targetKind]}</h4>
              <p>Evidence: Committed transition</p>
              <p>
                Observed:{" "}
                <time className="break-all" dateTime={item.observedAt}>
                  {item.observedAt}
                </time>
              </p>
              <p>
                Recorded impact: {item.impact.scope === "deployment" ? "Deployment" : "This site"}
                {" · "}
                {item.impact.affectedSiteCount} affected{" "}
                {item.impact.affectedSiteCount === 1 ? "site" : "sites"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
