"use client";

import * as React from "react";
import {
  npRequireAgentRuntimeStudioBudgetV1,
  npRequireAgentRuntimeStudioOverviewV1,
  npBuildAgentRuntimeStudioDefinitionInputV1,
  type NpAgentBudgetV1,
  type NpAgentRuntimeStudioBudgetV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioFrame } from "./agent-studio-frame.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeRequest, runtimeErrorMessage, useRuntimeResource } from "./agent-runtime-api.js";
import { RuntimeBudgetFields, runtimeBudgetLabels } from "./agent-runtime-fields.js";
import { RuntimeNotice, parseRuntimeAck } from "./agent-runtime-view.js";
import { Button } from "../ui/button.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

export function AgentBudgetView() {
  const budget = useRuntimeResource(
    "/api/admin/agents/budgets",
    npRequireAgentRuntimeStudioBudgetV1,
  );
  const runtime = useRuntimeResource(
    "/api/admin/agents/runtime-status",
    npRequireAgentRuntimeStudioOverviewV1,
  );
  const [editing, setEditing] = React.useState(false);
  const [action, setAction] = React.useState<"pause" | "resume" | null>(null);
  const [reason, setReason] = React.useState("");
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const refresh = () => {
    budget.reload();
    runtime.reload();
    setAction(null);
    setStale(false);
  };
  const status = runtime.value?.status;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!status || !action) return;
    setBusy(true);
    setError(null);
    try {
      await runtimeRequest(`/api/admin/agents/runtime/${action}`, parseRuntimeAck, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: key,
          expectedVersion: status.revision,
          reason: reason.trim(),
        }),
      });
      setMessage(
        action === "pause"
          ? "Runtime emergency pause was recorded."
          : "Runtime resume was recorded after current readiness checks.",
      );
      refresh();
    } catch (caught) {
      const text = runtimeErrorMessage(caught);
      setError(text);
      if (caught instanceof AgentStudioApiError && [401, 403, 404].includes(caught.status)) {
        runtime.clear(text);
        budget.clear(text);
      }
      if (caught instanceof AgentStudioApiError && caught.status === 409) setStale(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AgentStudioFrame active="budgets">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-semibold">Budgets and Runtime operations</h2>
        <Button variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <RuntimeNotice loading={runtime.loading} error={runtime.error} />
      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Site Runtime</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              {status.enabled ? "Enabled by the host" : "Disabled"} ·{" "}
              {status.paused ? "Emergency paused" : "Not emergency paused"}
            </p>
            <p className="text-sm text-neutral-500">
              Observed {status.generatedAt}. Readiness is server evidence; this view does not start
              providers or install a worker.
            </p>
            <dl className="grid gap-3 sm:grid-cols-3">
              {Object.entries(status.readiness).map(([name, value]) => (
                <div key={name}>
                  <dt className="text-sm text-neutral-500">{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <Button
              variant={status.paused ? "outline" : "destructive"}
              onClick={() => {
                setAction(status.paused ? "resume" : "pause");
                setKey(crypto.randomUUID());
                setError(null);
              }}
              disabled={
                busy ||
                (status.paused &&
                  (!status.enabled ||
                    Object.values(status.readiness).some(
                      (value) => value !== "ready" && value !== "not-required",
                    )))
              }
            >
              {status.paused ? "Review site Runtime resume" : "Emergency pause site Runtime"}
            </Button>
            {action ? (
              <form
                className="space-y-3 rounded border p-4"
                onSubmit={(event) => void submit(event)}
              >
                <h3 className="font-medium">
                  {action === "pause"
                    ? "Emergency pause all Runtime Agents"
                    : "Resume site Runtime"}
                </h3>
                <p className="text-sm">
                  This site-wide control is separate from pausing one Agent. New admission and
                  provider calls stop; existing deterministic work reaches a recorded safe boundary.
                  Independent security controls continue. An authorized administrator must
                  revalidate readiness to resume.
                </p>
                <Label htmlFor="runtime-site-reason">Reason</Label>
                <Textarea
                  id="runtime-site-reason"
                  maxLength={2000}
                  value={reason}
                  disabled={busy}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setKey(crypto.randomUUID());
                  }}
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy || stale}>
                    {busy ? "Submitting…" : "Confirm"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setAction(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {runtime.value ? (
        <Card>
          <CardHeader>
            <CardTitle>Operations backlog</CardTitle>
          </CardHeader>
          <CardContent>
            {runtime.value.operations ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {Object.entries(runtime.value.operations).map(([group, values]) => (
                  <section key={group} className="space-y-2">
                    <h3 className="font-medium">{group}</h3>
                    <dl>
                      {Object.entries(values).map(([name, value]) => (
                        <div className="flex justify-between gap-3 text-sm" key={name}>
                          <dt>{name.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt>
                          <dd>
                            {value === null
                              ? "Unknown"
                              : typeof value === "boolean"
                                ? value
                                  ? "Yes"
                                  : "No"
                                : typeof value === "number"
                                  ? value.toString()
                                  : "Unknown"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            ) : (
              <p>Operations evidence is unavailable. Counts are unknown.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      <RuntimeNotice loading={budget.loading} error={budget.error} />
      {budget.value ? (
        <Card>
          <CardHeader>
            <CardTitle>Site ceiling and usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              Site limits narrow deployment limits. Per-Agent limits narrow these further. Unknown
              usage is never treated as zero.
            </p>
            <p>Measurement: {budget.value.measurement}</p>
            {budget.value.usage ? (
              <dl className="grid gap-3 sm:grid-cols-3">
                {Object.entries(budget.value.usage).map(([name, value]) => (
                  <div key={name}>
                    <dt className="text-sm text-neutral-500">
                      {name.replace(/([a-z])([A-Z])/g, "$1 $2")}
                    </dt>
                    <dd>
                      {value === null
                        ? "Unknown"
                        : typeof value === "number"
                          ? value.toString()
                          : "Unknown"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p role="status">Measurement unavailable; configured hard limits fail closed.</p>
            )}
            <Button variant="outline" onClick={() => setEditing(!editing)}>
              {editing ? "Close budget editor" : "Edit site budget"}
            </Button>
            {editing ? (
              <SiteBudgetEditor
                key={budget.value.rowVersion}
                current={budget.value}
                onSaved={() => {
                  setEditing(false);
                  refresh();
                }}
              />
            ) : (
              <dl className="grid gap-3 sm:grid-cols-3">
                {(Object.keys(runtimeBudgetLabels) as (keyof typeof runtimeBudgetLabels)[]).map(
                  (key) => (
                    <div key={key}>
                      <dt className="text-sm text-neutral-500">{runtimeBudgetLabels[key]}</dt>
                      <dd>{budget.value!.effectiveCeiling[key] ?? "Not configured"}</dd>
                    </div>
                  ),
                )}
              </dl>
            )}
          </CardContent>
        </Card>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <RuntimeNotice loading={false} error={error} />
    </AgentStudioFrame>
  );
}

function SiteBudgetEditor({
  current,
  onSaved,
}: {
  current: NpAgentRuntimeStudioBudgetV1;
  onSaved: () => void;
}) {
  const [value, setValue] = React.useState<NpAgentBudgetV1>(current.siteCeiling);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [reviewing, setReviewing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const definition = await npBuildAgentRuntimeStudioDefinitionInputV1(value);
      if (!reviewing) {
        setReviewing(true);
        return;
      }
      setBusy(true);
      await runtimeRequest("/api/admin/agents/budgets", parseRuntimeAck, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...definition,
          expectedVersion: current.rowVersion,
          idempotencyKey: key,
        }),
      });
      onSaved();
    } catch (caught) {
      setError(runtimeErrorMessage(caught));
      if (caught instanceof AgentStudioApiError && caught.status === 409) setStale(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <fieldset disabled={busy || stale} className="space-y-4">
        <RuntimeBudgetFields
          ceiling={current.deploymentCeiling}
          value={value}
          onChange={(next) => {
            setValue(next);
            setKey(crypto.randomUUID());
            setReviewing(false);
          }}
        />
        {reviewing ? (
          <section className="space-y-2">
            <h3 className="font-medium">Review proposed ceiling changes</h3>
            <p className="text-sm">
              The server rechecks deployment bounds and the current revision. Lower limits retain
              existing reservations and block subsequent admissions as needed.
            </p>
            {(Object.keys(runtimeBudgetLabels) as (keyof typeof runtimeBudgetLabels)[])
              .filter((key) => current.siteCeiling[key] !== value[key])
              .map((key) => (
                <p className="text-sm" key={key}>
                  {runtimeBudgetLabels[key]}: {current.siteCeiling[key] ?? "Inherit"} →{" "}
                  {value[key] ?? "Inherit"}
                </p>
              ))}
          </section>
        ) : null}
        <Button type="submit">
          {busy ? "Saving…" : reviewing ? "Confirm budget update" : "Review budget changes"}
        </Button>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
