"use client";

import * as React from "react";
import { npRequireAgentGuardianIncidentExportV1 } from "@nexpress/core/agent-contract";
import { Button } from "../ui/button.js";
import { runtimeRequest, runtimeErrorMessage } from "./agent-runtime-api.js";
import { AgentStudioApiError } from "./agent-studio-api.js";

/** Keyed by the displayed generation so a stale download cannot outlive its evidence. */
export function IncidentGuardianExport({
  incidentId,
  version,
  onAccessLost,
}: {
  incidentId: string;
  version: number;
  onAccessLost: (error: unknown) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => request.current?.abort(), []);
  const download = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await runtimeRequest(
        `/api/admin/agents/incidents/${encodeURIComponent(incidentId)}/guardian-export?version=${version}`,
        npRequireAgentGuardianIncidentExportV1,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (result.incident.id !== incidentId || result.incident.versionNumber !== version)
        throw new Error("Unbound Guardian export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2) + "\n"], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `guardian-incident-${incidentId}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof AgentStudioApiError && [401, 403, 404].includes(failure.status))
        onAccessLost(failure);
      else setError(runtimeErrorMessage(failure));
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section className="space-y-2" aria-label="Guardian evidence export">
      <Button variant="outline" disabled={busy} onClick={() => void download()}>
        {busy ? "Preparing export…" : "Export verified Guardian evidence"}
      </Button>
      <p className="text-sm text-neutral-500">
        Contains bounded observations and outcome codes. Private targets, credentials and model
        prose are excluded.
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
