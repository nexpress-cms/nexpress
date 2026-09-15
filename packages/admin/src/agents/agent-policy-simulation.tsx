"use client";

import * as React from "react";
import {
  npBuildAgentPolicySimulationFixtureInputV1,
  npRequireAgentPolicySimulationReportV1,
  type NpAgentPolicySimulationReportV1,
  type NpAgentRuntimeStudioPolicyV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeRequest, runtimeErrorMessage } from "./agent-runtime-api.js";
import { Button } from "../ui/button.js";

export function AgentPolicySimulation({
  policy,
  onAccessLost,
}: {
  policy: NpAgentRuntimeStudioPolicyV1;
  onAccessLost: (message: string) => void;
}) {
  const [report, setReport] = React.useState<NpAgentPolicySimulationReportV1 | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const key = React.useRef(crypto.randomUUID());
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controller.current?.abort(), []);
  async function simulate() {
    if (busy || stale) return;
    const attempt = new AbortController();
    controller.current = attempt;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const fixture = await npBuildAgentPolicySimulationFixtureInputV1();
      if (attempt.signal.aborted) return;
      const result = await runtimeRequest(
        `/api/admin/agents/policies/${policy.id}/simulate`,
        npRequireAgentPolicySimulationReportV1,
        {
          method: "POST",
          signal: attempt.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: key.current,
            expectedVersion: policy.rowVersion,
            configHash: policy.contentHash,
            ...fixture,
          }),
        },
      );
      if (attempt.signal.aborted) return;
      if (
        result.policyId !== policy.id ||
        result.policyVersion !== policy.version ||
        result.policyHash !== policy.contentHash ||
        result.fixtureHash !== fixture.fixtureHash
      )
        throw new AgentStudioApiError(
          "Simulation evidence does not match this policy.",
          502,
          "RUNTIME_CONTRACT_ERROR",
        );
      setReport(result);
      key.current = crypto.randomUUID();
    } catch (caught) {
      if (attempt.signal.aborted) return;
      const message = runtimeErrorMessage(caught);
      setError(message);
      if (caught instanceof AgentStudioApiError && [401, 403, 404].includes(caught.status))
        onAccessLost(message);
      if (caught instanceof AgentStudioApiError && caught.status === 409) setStale(true);
    } finally {
      if (!attempt.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Policy simulation">
      <h3 className="font-semibold">Policy simulation</h3>
      <p className="text-sm">
        Version 1 synthetic fixtures compare four autonomy modes under the current framework and
        site ceilings. The selected policy replaces its policy layer. Agent overrides also include
        the active site policy. This is a snapshot of policy rules, not an Agent run.
      </p>
      <p className="text-sm">
        Non-authorizing: no capability is executed. Authority, budgets and provider readiness are
        not checked. Guidance cannot grant permission.
      </p>
      <Button variant="outline" disabled={busy || stale} onClick={() => void simulate()}>
        {busy ? "Simulating…" : "Simulate policy"}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {report ? (
        <div className="space-y-4" role="status" aria-label="Non-authorizing simulation report">
          <p>Simulation complete · policy version {report.policyVersion} · synthetic fixture v1</p>
          {report.cases.map((entry) => (
            <details key={entry.autonomy} className="rounded border p-3">
              <summary className="cursor-pointer font-medium">
                {entry.autonomy} · {entry.capabilities.length} policy capabilities
              </summary>
              <p className="mt-2 text-sm">Provider data ceiling: {entry.providerDataMaximum}</p>
              {entry.capabilities.length === 0 ? (
                <p>No capabilities survive the policy intersection.</p>
              ) : (
                <ul className="list-disc pl-5 text-sm">
                  {entry.capabilities.map((capability) => (
                    <li key={capability.capabilityId}>
                      {capability.capabilityId}: {capability.mode} ·{" "}
                      {capability.permissions.join(", ")}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-sm">
                UTC quiet periods (minutes after midnight):{" "}
                {entry.automation.quietHoursUtc
                  .map((window) => `${window.startMinute}–${window.endMinute}`)
                  .join(", ") || "None"}
              </p>
              <details className="mt-2">
                <summary>Effective enforced rules</summary>
                <dl className="mt-2 space-y-2 text-sm">
                  <dt>Resource allowlists</dt>
                  <dd>
                    {Object.entries(entry.resources).map(([name, values]) => (
                      <p key={name}>
                        {name.replace(/([A-Z])/g, " $1")}:{" "}
                        {values === null
                          ? "No additional restriction"
                          : values.join(", ") || "None allowed"}
                      </p>
                    ))}
                  </dd>
                  <dt>Automatic action ceiling</dt>
                  <dd>{entry.risk.automaticActionMaximum}</dd>
                  <dt>Preview required from</dt>
                  <dd>{entry.risk.requirePreviewAtOrAbove ?? "No additional policy threshold"}</dd>
                  <dt>Recent authentication required from</dt>
                  <dd>
                    {entry.risk.requireRecentAuthAtOrAbove ?? "No additional policy threshold"}
                  </dd>
                  <dt>Retention in days</dt>
                  <dd>
                    {Object.entries(entry.retentionDays).map(([name, days]) => (
                      <p key={name}>
                        {name.replace(/([A-Z])/g, " $1")}: {days}
                      </p>
                    ))}
                  </dd>
                  <dt>Escalation</dt>
                  <dd>
                    {entry.escalation.minimumSeverity} ·{" "}
                    {entry.escalation.channels.join(", ") || "No channels"}
                  </dd>
                </dl>
              </details>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}
