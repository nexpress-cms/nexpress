"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  npAgentIncidentStates,
  npAgentIncidentCategories,
  npAgentIncidentSeverities,
  npRequireAgentIncidentListOutputV1,
  npRequireAgentIncidentStudioDetailV1,
  npRequireAgentIncidentFeedbackInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  type NpAgentIncidentStudioDetailV1,
  type NpAgentIncidentFeedbackInputV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioFrame } from "./agent-studio-frame.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeAccessLost, runtimeRequest, useRuntimeResource } from "./agent-runtime-api.js";
import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { RuntimeSelect } from "./agent-runtime-fields.js";
import { useAgentPolling } from "./use-agent-polling.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

const root = "/api/admin/agents/incidents";
const unresolved = "open,investigating,contained,monitoring";
const allStatuses = npAgentIncidentStates.join(",");
const statusFilter = (value: string | null) => (value === allStatuses ? "all" : value || "all");
const options = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

export function AgentIncidentListView({ query = "" }: { query?: string }) {
  return <IncidentList key={query} query={query} />;
}
function IncidentList({ query }: { query: string }) {
  const router = useRouter();
  const params = new URLSearchParams(query);
  if (!params.has("statuses")) params.set("statuses", unresolved);
  const normalized = params.toString();
  const [filters, setFilters] = React.useState({
    statuses: statusFilter(params.get("statuses")),
    categories: params.get("categories") || "all",
    severities: params.get("severities") || "all",
  });
  const state = useRuntimeResource(`${root}?${normalized}`, npRequireAgentIncidentListOutputV1);
  return (
    <AgentStudioFrame
      active="incidents"
      busy={state.loading}
      refreshing={state.refreshing}
      observedAt={state.observedAt}
      recovery={state.failure}
    >
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-semibold">Incidents</h2>
        <Button variant="outline" onClick={state.reload}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-neutral-500">
        Review correlated signals and record human feedback. Feedback does not approve or execute
        containment.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams(normalized);
          next.delete("cursor");
          for (const [key, value] of Object.entries(filters)) {
            if (value !== "all") next.set(key, value);
            else if (key === "statuses") next.set(key, allStatuses);
            else next.delete(key);
          }
          router.push(`/admin/agents/incidents?${next}`);
        }}
      >
        <RuntimeSelect
          label="Incident status"
          value={filters.statuses}
          onChange={(statuses) => setFilters((value) => ({ ...value, statuses }))}
          options={[
            { value: unresolved, label: "Unresolved" },
            { value: "all", label: "All statuses" },
            ...options(npAgentIncidentStates),
          ]}
        />
        <RuntimeSelect
          label="Incident category"
          value={filters.categories}
          onChange={(categories) => setFilters((value) => ({ ...value, categories }))}
          options={[
            { value: "all", label: "All categories" },
            ...options(npAgentIncidentCategories),
          ]}
        />
        <RuntimeSelect
          label="Incident severity"
          value={filters.severities}
          onChange={(severities) => setFilters((value) => ({ ...value, severities }))}
          options={[
            { value: "all", label: "All severities" },
            ...options(npAgentIncidentSeverities),
          ]}
        />
        <Button variant="outline" type="submit">
          Apply filters
        </Button>
      </form>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.value?.items.length === 0 ? (
        <p>
          {state.value.nextCursor
            ? "No visible incidents on this page. Continue to the next page."
            : "No incidents match this view."}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {state.value?.items.map((incident) => (
          <Card key={incident.id}>
            <CardHeader>
              <CardTitle>
                <Link className="underline" href={`/admin/agents/incidents/${incident.id}`}>
                  {incident.title}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {incident.category} · {incident.severity} · {incident.status}
              </p>
              <p>{incident.summary}</p>
              <p>
                {incident.signalIds.length} signals · {incident.eventCount} events
              </p>
              <p>
                First observed:{" "}
                <time dateTime={incident.firstObservedAt}>{incident.firstObservedAt}</time>
              </p>
              <p>
                Last observed:{" "}
                <time dateTime={incident.lastObservedAt}>{incident.lastObservedAt}</time>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {state.value?.nextCursor ? (
        <Button
          variant="outline"
          onClick={() => {
            const next = new URLSearchParams(normalized);
            next.set("cursor", state.value!.nextCursor!);
            router.push(`/admin/agents/incidents?${next}`);
          }}
        >
          Next page
        </Button>
      ) : null}
    </AgentStudioFrame>
  );
}

const timelineLabels: Record<string, string> = {
  observed: "Observed fact",
  correlated: "Deterministic correlation/policy",
  agent_assessment: "Agent assessment",
  human_note: "Human note/decision",
  state_transition: "State transition",
  action: "Action/containment",
  verification: "Verification",
  notification: "Notification",
};

export function AgentIncidentDetailView({ id }: { id: string }) {
  return <IncidentDetail key={id} id={id} />;
}
function IncidentDetail({ id }: { id: string }) {
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [writing, setWriting] = React.useState(false);
  const path = `${root}/${encodeURIComponent(id)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const state = useRuntimeResource(path, npRequireAgentIncidentStudioDetailV1);
  const detail = state.value;
  useAgentPolling(
    path,
    detail,
    Boolean(
      detail && !cursor && !writing && !["resolved", "dismissed"].includes(detail.incident.status),
    ),
    state.loading,
    state.reload,
  );
  return (
    <AgentStudioFrame
      active="incidents"
      busy={state.loading}
      refreshing={state.refreshing}
      observedAt={state.observedAt}
      recovery={state.failure}
    >
      <div className="flex flex-wrap justify-between gap-3">
        <Link className="underline" href="/admin/agents/incidents">
          All incidents
        </Link>
        <Button
          variant="outline"
          disabled={writing}
          onClick={() => {
            setCursor(null);
            state.reload();
          }}
        >
          Refresh
        </Button>
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {detail ? (
        <>
          <header className="space-y-2">
            <h2 className="text-lg font-semibold">{detail.incident.title}</h2>
            <p>{detail.incident.summary}</p>
            <p>
              {detail.incident.category} · {detail.incident.severity} · {detail.incident.status}
            </p>
            <p className="text-sm">
              Incident {detail.incident.id} · Version {detail.incident.versionNumber}
            </p>
            <p className="text-sm">
              First observed: {detail.incident.firstObservedAt} · Last observed:{" "}
              {detail.incident.lastObservedAt}
            </p>
          </header>
          <section className="space-y-3" aria-labelledby="incident-signals">
            <h3 id="incident-signals" className="font-semibold">
              Signal evidence
            </h3>
            <p className="text-sm text-neutral-500">
              Source references are shown below. Private signal payloads and raw logs are not
              included in this view.
            </p>
            {detail.signals.length === 0 ? (
              <p>No visible signals.</p>
            ) : (
              <ul className="space-y-2">
                {detail.signals.map((signal) => (
                  <li key={signal.id} className="rounded-lg border p-3 text-sm">
                    <p>
                      {signal.category} · Detector {signal.detectorId} · Version{" "}
                      {signal.detectorVersion}
                    </p>
                    <p>Deterministic confidence basis: {signal.confidenceBasis}</p>
                    <p>
                      Deterministic score:{" "}
                      {signal.scoreBasisPoints === null
                        ? "Unknown"
                        : `${signal.scoreBasisPoints} basis points`}
                    </p>
                    <p>Signal {signal.id}</p>
                    <time dateTime={signal.createdAt}>{signal.createdAt}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <IncidentFeedback
            detail={detail}
            onWriting={setWriting}
            onSuccess={() => {
              setCursor(null);
              state.reload();
            }}
            onAccessLost={(error) =>
              state.clear("This incident is unavailable or you no longer have access.", error)
            }
            onConflict={() =>
              state.clear(
                "This incident changed. Reload and review the current evidence before submitting feedback.",
              )
            }
          />
          <section className="space-y-3" aria-labelledby="incident-timeline">
            <h3 id="incident-timeline" className="font-semibold">
              Timeline
            </h3>
            <p className="text-sm text-neutral-500">
              Each entry is labeled by its source. An Agent assessment is not an observed fact or an
              authorization.
            </p>
            {detail.timeline.length === 0 ? (
              <p>No timeline entries on this page.</p>
            ) : (
              <ol className="space-y-2">
                {detail.timeline.map((entry) => (
                  <li key={entry.id} className="space-y-1 rounded-lg border p-3 text-sm">
                    <p className="font-medium">{timelineLabels[entry.kind] ?? entry.kind}</p>
                    <p>
                      #{entry.sequence} · <time dateTime={entry.createdAt}>{entry.createdAt}</time>
                    </p>
                    <div className="flex flex-wrap gap-4">
                      {entry.approvalId ? (
                        <Link
                          className="underline"
                          href={`/admin/agents/approvals/${entry.approvalId}`}
                        >
                          Review approval
                        </Link>
                      ) : null}
                      {entry.actionId ? (
                        <Link
                          className="underline"
                          href={`/admin/agents/activity/actions/${entry.actionId}`}
                        >
                          Review action and verification
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex gap-3">
              {cursor ? (
                <Button variant="outline" disabled={writing} onClick={() => setCursor(null)}>
                  First timeline page
                </Button>
              ) : null}
              {detail.nextTimelineCursor ? (
                <Button
                  variant="outline"
                  disabled={writing}
                  onClick={() => setCursor(detail.nextTimelineCursor)}
                >
                  Next timeline page
                </Button>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </AgentStudioFrame>
  );
}

function IncidentFeedback({
  detail,
  onWriting,
  onSuccess,
  onAccessLost,
  onConflict,
}: {
  detail: NpAgentIncidentStudioDetailV1;
  onWriting: (value: boolean) => void;
  onSuccess: () => void;
  onAccessLost: (error: unknown) => void;
  onConflict: () => void;
}) {
  const feedbackSignals = detail.signals.filter((signal) => signal.category === "spam");
  const [signalId, setSignalId] = React.useState(feedbackSignals[0]?.id ?? "");
  const [label, setLabel] = React.useState("confirmed-spam");
  const [command, setCommand] = React.useState<NpAgentIncidentFeedbackInputV1 | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  const blocked = useAgentRetryBlocked(failure);
  React.useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  const latest = detail.feedback.find(
    (item) =>
      item.signalId === signalId &&
      !detail.feedback.some((later) => later.supersedesId === item.id),
  );
  async function submit() {
    if (request.current || blocked) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      const next =
        command ??
        npRequireAgentIncidentFeedbackInputV1({
          schemaVersion: "np.agent-incident-feedback-input.v1",
          expectedVersion: detail.incident.versionNumber,
          signalId,
          label,
          supersedesId: latest?.id ?? null,
          idempotencyKey: crypto.randomUUID(),
        });
      setCommand(next);
      setBusy(true);
      onWriting(true);
      setFailure(null);
      setMessage(null);
      await runtimeRequest(
        `${root}/${encodeURIComponent(detail.incident.id)}/feedback`,
        npRequireAgentRuntimeStudioMutationResultV1,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        },
      );
      if (controller.signal.aborted) return;
      setCommand(null);
      onWriting(false);
      setMessage("Feedback recorded. No containment was executed.");
      onSuccess();
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailure(error);
      if (runtimeAccessLost(error)) {
        onWriting(false);
        onAccessLost(error);
        return;
      }
      if (error instanceof AgentStudioApiError && error.status === 409) {
        setCommand(null);
        onWriting(false);
        onConflict();
        return;
      }
      if (
        error instanceof AgentStudioApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      ) {
        setCommand(null);
        onWriting(false);
        setMessage(error.message);
      } else
        setMessage(
          "The feedback outcome is unconfirmed. Retry the unchanged request using the same identity.",
        );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-labelledby="incident-feedback">
      <h3 id="incident-feedback" className="font-semibold">
        Human feedback
      </h3>
      <p className="text-sm">
        Feedback labels a signal for review. It does not dismiss the incident, grant approval,
        quarantine content or restore it.
      </p>
      <ul className="space-y-1 text-sm">
        {detail.feedback.map((item) => (
          <li key={item.id}>
            {item.label} · Signal {item.signalId} · {item.createdAt}
            {item.supersedesId ? " · Supersedes earlier feedback" : ""}
          </li>
        ))}
      </ul>
      {!detail.feedbackAvailable || feedbackSignals.length === 0 ? (
        <p>Feedback is unavailable for this incident or your current access.</p>
      ) : (
        <AgentRecoveryBoundary error={failure}>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset disabled={busy || command !== null} className="flex flex-wrap gap-3">
              <RuntimeSelect
                label="Feedback signal"
                disabled={busy || command !== null}
                value={signalId}
                onChange={setSignalId}
                options={feedbackSignals.map((signal) => ({
                  value: signal.id,
                  label: `${signal.detectorId} · ${signal.id}`,
                }))}
              />
              <RuntimeSelect
                label="Feedback classification"
                disabled={busy || command !== null}
                value={label}
                onChange={setLabel}
                options={[
                  { value: "confirmed-spam", label: "Confirmed spam" },
                  { value: "false-positive", label: "False positive" },
                ]}
              />
            </fieldset>
            {latest ? (
              <p className="text-sm">
                Submitting will supersede the current {latest.label} label for this signal and
                preserve its history.
              </p>
            ) : null}
            <Button type="submit" disabled={busy || blocked || !signalId}>
              {busy
                ? "Recording feedback…"
                : command
                  ? "Retry unchanged feedback"
                  : "Record feedback"}
            </Button>
          </form>
        </AgentRecoveryBoundary>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
