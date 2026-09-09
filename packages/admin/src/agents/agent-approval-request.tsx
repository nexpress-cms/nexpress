"use client";

import * as React from "react";
import Link from "next/link";
import {
  npRequireAgentApprovalDetailV1,
  type NpAgentChangeSetWire,
} from "@nexpress/core/agent-contract";
import { npFetch } from "../lib/api-client.js";
import { AgentStudioApiError, responseError } from "./agent-studio-api.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";

/** Requesting a human decision never dispatches the intended execution. */
export function AgentApprovalRequest({
  changeSet,
  onChanged,
  onLost,
}: {
  changeSet: NpAgentChangeSetWire;
  onChanged: () => void;
  onLost: () => void;
}) {
  const [operation, setOperation] = React.useState<"apply" | "schedule">("apply");
  const [scheduledFor, setScheduledFor] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [approvalId, setApprovalId] = React.useState<string | null>(null);
  const keys = React.useRef<Record<string, string>>({});
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!changeSet.planHash || changeSet.state !== "ready") return;
    const time = operation === "schedule" ? new Date(scheduledFor) : null;
    if (time && !Number.isFinite(time.getTime())) {
      setError("Choose a valid intended schedule time.");
      return;
    }
    const canonicalTime = time?.toISOString() ?? null;
    const binding = JSON.stringify([
      changeSet.id,
      changeSet.draftVersion,
      changeSet.planHash,
      operation,
      canonicalTime,
    ]);
    keys.current[binding] ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const response = await npFetch(
        `/api/admin/agents/changesets/${encodeURIComponent(changeSet.id)}/request-approval`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: "np.agent-changeset-request-approval-input.v1",
            expectedDraftVersion: changeSet.draftVersion,
            planHash: changeSet.planHash,
            intendedOperation: operation,
            scheduledFor: canonicalTime,
            idempotencyKey: keys.current[binding],
          }),
        },
      );
      if (!response.ok) throw await responseError(response);
      const result = npRequireAgentApprovalDetailV1(await response.json());
      if (
        result.item.target.kind !== "changeset" ||
        result.item.target.changeSetId !== changeSet.id ||
        result.item.target.planHash !== changeSet.planHash ||
        result.item.intendedOperation !== operation ||
        result.item.scheduledFor !== canonicalTime
      )
        throw new Error("Approval target mismatch");
      setApprovalId(result.item.approval.id);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof AgentStudioApiError && caught.status === 409
          ? "The sealed facts changed. Review the current proposal before requesting approval again."
          : "Approval could not be requested. Reload to check current authority and evidence.",
      );
      if (caught instanceof AgentStudioApiError && [401, 403, 404, 409].includes(caught.status))
        onLost();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-labelledby="request-approval-heading">
      <h2 id="request-approval-heading" className="text-lg font-semibold">
        Human approval
      </h2>
      <p>
        Request a decision for this exact sealed plan. Approval does not apply content or schedule
        execution.
      </p>
      {changeSet.approval && (
        <p>
          <Link className="underline" href={`/admin/agents/approvals/${changeSet.approval.id}`}>
            Review approval
          </Link>{" "}
          · {changeSet.approval.state}
        </p>
      )}
      {approvalId && (
        <p role="status">
          <Link className="underline" href={`/admin/agents/approvals/${approvalId}`}>
            Open requested approval
          </Link>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {changeSet.state === "ready" && (
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="space-y-3"
        >
          <Label htmlFor="approval-intended-operation">Intended operation</Label>
          <select
            id="approval-intended-operation"
            value={operation}
            disabled={busy}
            onChange={(event) => setOperation(event.target.value as "apply" | "schedule")}
            className="rounded border p-2"
          >
            <option value="apply">Apply</option>
            <option value="schedule">Schedule</option>
          </select>
          {operation === "schedule" && (
            <div>
              <Label htmlFor="approval-intended-time">Intended schedule time (local time)</Label>
              <Input
                id="approval-intended-time"
                type="datetime-local"
                required
                value={scheduledFor}
                disabled={busy}
                onChange={(event) => setScheduledFor(event.target.value)}
              />
            </div>
          )}
          <Button type="submit" disabled={busy || !changeSet.planHash}>
            Request approval
          </Button>
        </form>
      )}
    </section>
  );
}
