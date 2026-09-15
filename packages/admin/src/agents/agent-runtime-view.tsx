"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  npAnalyzeAgentRuntimeStudioConfigurationsPageV1,
  npAnalyzeAgentRuntimeStudioTriggersPageV1,
  npRequireAgentContractResult,
  npRequireAgentRuntimeStudioConfigurationV1,
  npRequireAgentRuntimeStudioCatalogV1,
  npRequireAgentRuntimeStudioEffectiveV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  npBuildAgentRuntimeStudioDefinitionInputV1,
  npAgentConfigurationStatusesV1,
  npAgentRecipeTemplates,
  npAgentAutonomyModes,
  type NpAgentConfigurationDefinitionV1,
  type NpAgentRuntimeStudioCatalogV1,
  type NpAgentRuntimeStudioConfigurationV1,
  type NpAgentRuntimeAdminOperationIdV1,
  type NpAgentTrigger,
  type NpAgentRuntimeStudioEffectiveV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioFrame } from "./agent-studio-frame.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeRequest, runtimeErrorMessage, useRuntimeResource } from "./agent-runtime-api.js";
import { RuntimeBudgetFields, RuntimeSelect } from "./agent-runtime-fields.js";
import { RuntimeCapabilityModes } from "./agent-policy-fields.js";
import { RuntimeEventTriggerFields } from "./agent-trigger-fields.js";
import { RuntimeRecipeFields, runtimeRecipeDraft } from "./agent-recipe-fields.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

const configurationsPage = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioConfigurationsPageV1(value));
const triggersPage = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioTriggersPageV1(value));
const choices = <T extends string>(values: readonly T[]) =>
  values.map((value) => ({ value, label: value }));
export const runtimeCatalogPath = "/api/admin/agents/capabilities";

export const parseRuntimeAck = npRequireAgentRuntimeStudioMutationResultV1;

export function RuntimeNotice({ loading, error }: { loading: boolean; error: string | null }) {
  return (
    <>
      {loading ? <p role="status">Loading Runtime data…</p> : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

export function AgentRuntimeListView({ query = "" }: { query?: string }) {
  const router = useRouter();
  const state = useRuntimeResource(
    `/api/admin/agents/configurations${query ? `?${query}` : ""}`,
    configurationsPage,
  );
  const [name, setName] = React.useState(new URLSearchParams(query).get("name") ?? "");
  const [status, setStatus] = React.useState(new URLSearchParams(query).get("status") ?? "all");
  const catalog = useRuntimeResource(runtimeCatalogPath, npRequireAgentRuntimeStudioCatalogV1);
  const [template, setTemplate] = React.useState(
    new URLSearchParams(query).get("template") ?? "all",
  );
  const [triggerKind, setTriggerKind] = React.useState(
    new URLSearchParams(query).get("triggerKind") ?? "all",
  );
  const [connectionId, setConnectionId] = React.useState(
    new URLSearchParams(query).get("connectionId") ?? "all",
  );
  return (
    <AgentStudioFrame active="configurations">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Runtime Agents</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={state.reload}>
            Refresh
          </Button>
          <Button asChild>
            <Link href="/admin/agents/configurations/new">Create Agent</Link>
          </Button>
        </div>
      </div>
      <p className="text-sm text-neutral-500">
        Agents use immutable reviewed versions. Saving a draft does not activate it or start a
        worker.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const params = new URLSearchParams();
          if (name.trim()) params.set("name", name.trim());
          if (status !== "all") params.set("status", status);
          if (template !== "all") params.set("template", template);
          if (triggerKind !== "all") params.set("triggerKind", triggerKind);
          if (connectionId !== "all") params.set("connectionId", connectionId);
          router.push(`/admin/agents/configurations?${params}`);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="runtime-agent-search">Agent name</Label>
          <Input
            id="runtime-agent-search"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <RuntimeSelect
          label="Agent status"
          value={status}
          options={[
            { value: "all", label: "All statuses" },
            ...choices(npAgentConfigurationStatusesV1),
          ]}
          onChange={setStatus}
        />
        <RuntimeSelect
          label="Template filter"
          value={template}
          options={[{ value: "all", label: "All templates" }, ...choices(npAgentRecipeTemplates)]}
          onChange={setTemplate}
        />
        <RuntimeSelect
          label="Trigger filter"
          value={triggerKind}
          options={[
            { value: "all", label: "All triggers" },
            ...choices(["manual", "schedule", "event"] as const),
          ]}
          onChange={setTriggerKind}
        />
        <RuntimeSelect
          label="Connection filter"
          value={connectionId}
          options={[
            { value: "all", label: "All connections" },
            ...(catalog.value?.connections.map((entry) => ({
              value: entry.id,
              label: entry.alias,
            })) ?? []),
          ]}
          onChange={setConnectionId}
        />
        <Button type="submit" variant="outline">
          Apply filters
        </Button>
      </form>
      <RuntimeNotice loading={state.loading} error={state.error} />
      {state.value?.items.length === 0 ? (
        <p>No Agents match this view. Create a draft to configure a supported recipe.</p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {state.value?.items.map((agent) => (
          <Card key={agent.id}>
            <CardHeader>
              <CardTitle>
                <Link className="underline" href={`/admin/agents/configurations/${agent.id}`}>
                  {agent.definition.name}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {agent.status} · {agent.definition.template} · version {agent.version}
              </p>
              <p>
                {agent.definition.model ? `Model: ${agent.definition.model}` : "Deterministic only"}
              </p>
              <p>
                {agent.definition.scopes.length} scopes · {agent.definition.capabilityModes.length}{" "}
                enabled capabilities
              </p>
              <p>Draft version: {agent.draftVersionId ? "available for review" : "none"}</p>
              <p>Updated {agent.updatedAt}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {state.value?.nextCursor ? (
        <Button
          variant="outline"
          onClick={() => {
            const params = new URLSearchParams(query);
            params.set("cursor", state.value!.nextCursor!);
            router.push(`/admin/agents/configurations?${params}`);
          }}
        >
          Next page
        </Button>
      ) : null}
    </AgentStudioFrame>
  );
}

function initialDefinition(
  catalog: NpAgentRuntimeStudioCatalogV1,
): NpAgentConfigurationDefinitionV1 {
  const recipe = catalog.recipes[0];
  return {
    schemaVersion: "np.agent-configuration-definition.v1",
    name: "",
    template: recipe?.allowedTemplates[0] ?? "custom",
    modelConnectionId: null,
    model: null,
    scopes: [],
    autonomy: "observe",
    capabilityModes: [],
    policyMode: "site",
    budget: { ...catalog.effectiveBudget },
    settings: recipe ? [runtimeRecipeDraft(recipe.id)] : [],
  };
}

export function AgentRuntimeCreateView() {
  const catalog = useRuntimeResource(runtimeCatalogPath, npRequireAgentRuntimeStudioCatalogV1);
  return (
    <AgentStudioFrame active="configurations">
      <h2 className="text-lg font-semibold">Create Agent draft</h2>
      <RuntimeNotice loading={catalog.loading} error={catalog.error} />
      {catalog.value ? (
        catalog.value.recipes.length ? (
          <RuntimeConfigurationEditor
            catalog={catalog.value}
            initial={initialDefinition(catalog.value)}
          />
        ) : (
          <p>
            No Runtime recipes are installed. Ask the host operator to configure the Runtime
            service.
          </p>
        )
      ) : null}
    </AgentStudioFrame>
  );
}

function RuntimeConfigurationEditor({
  catalog,
  initial,
  current,
  onSaved,
}: {
  catalog: NpAgentRuntimeStudioCatalogV1;
  initial: NpAgentConfigurationDefinitionV1;
  current?: NpAgentRuntimeStudioConfigurationV1;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [definition, setDefinition] = React.useState(initial);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const [accessLost, setAccessLost] = React.useState(false);
  const [delegated, setDelegated] = React.useState(false);
  const update = (next: NpAgentConfigurationDefinitionV1) => {
    setDefinition(next);
    setKey(crypto.randomUUID());
  };
  const selected = catalog.recipes.filter((recipe) =>
    definition.settings.some((setting) => setting.recipeId === recipe.id),
  );
  const modes = catalog.capabilities
    .filter((capability) => selected.some((recipe) => recipe.capabilityIds.includes(capability.id)))
    .flatMap((capability) =>
      capability.modes.map((mode) => ({ capabilityId: capability.id, mode })),
    );
  const connection = catalog.connections.find((entry) => entry.id === definition.modelConnectionId);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    let requestAttempted = false;
    try {
      const body = {
        ...(await npBuildAgentRuntimeStudioDefinitionInputV1({
          ...definition,
          name: definition.name.trim(),
        })),
        idempotencyKey: key,
        ...(current
          ? { expectedVersion: current.rowVersion, configHash: current.configHash }
          : delegated && catalog.selfDelegation
            ? { authority: { kind: "user", userId: catalog.selfDelegation.userId } }
            : {}),
      };
      requestAttempted = true;
      const result = await runtimeRequest(
        `/api/admin/agents/configurations${current ? `/${current.id}` : ""}`,
        parseRuntimeAck,
        {
          method: current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (current && onSaved) onSaved();
      else router.push(`/admin/agents/configurations/${result.resourceId}`);
    } catch (caught) {
      setError(
        requestAttempted
          ? runtimeErrorMessage(caught)
          : "The draft is invalid. Check required recipe or policy fields, capability modes, scopes and numeric limits before saving.",
      );
      if (caught instanceof AgentStudioApiError && [401, 403, 404].includes(caught.status))
        setAccessLost(true);
      if (caught instanceof AgentStudioApiError && caught.status === 409) setStale(true);
    } finally {
      setBusy(false);
    }
  };
  if (accessLost) return <RuntimeNotice loading={false} error={error} />;
  return (
    <form className="space-y-6" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy || stale} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="runtime-agent-name">Agent name</Label>
            <Input
              id="runtime-agent-name"
              required
              maxLength={120}
              value={definition.name}
              onChange={(event) => update({ ...definition, name: event.target.value })}
            />
          </div>
          <RuntimeSelect
            label="Template"
            value={definition.template}
            options={choices(
              npAgentRecipeTemplates.filter((template) =>
                selected.every((recipe) => recipe.allowedTemplates.includes(template)),
              ),
            )}
            onChange={(template) => update({ ...definition, template })}
          />
        </div>
        <fieldset className="space-y-3">
          <legend className="font-medium">Installed recipes</legend>
          {catalog.recipes.map((recipe) => (
            <label className="flex items-start gap-2 text-sm" key={recipe.id}>
              <input
                type="checkbox"
                checked={selected.includes(recipe)}
                onChange={(event) => {
                  const settings = [
                    ...definition.settings.filter((entry) => entry.recipeId !== recipe.id),
                    ...(event.target.checked ? [runtimeRecipeDraft(recipe.id)] : []),
                  ].sort((a, b) => a.recipeId.localeCompare(b.recipeId));
                  update({ ...definition, settings });
                }}
              />
              <span>
                {recipe.id} · provider {recipe.providerMode} · triggers:{" "}
                {recipe.triggerKinds.join(", ")}
              </span>
            </label>
          ))}
        </fieldset>
        {definition.settings.map((settings) => (
          <RuntimeRecipeFields
            key={settings.recipeId}
            value={settings}
            onChange={(next) =>
              update({
                ...definition,
                settings: definition.settings.map((entry) =>
                  entry.recipeId === next.recipeId ? next : entry,
                ),
              })
            }
          />
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <RuntimeSelect
            label="Provider connection"
            value={definition.modelConnectionId ?? "deterministic"}
            options={[
              ...(selected.every((recipe) => recipe.providerMode !== "required")
                ? [{ value: "deterministic", label: "Deterministic only" }]
                : []),
              ...catalog.connections.map((entry) => ({ value: entry.id, label: entry.alias })),
            ]}
            onChange={(id) => {
              const next = catalog.connections.find((entry) => entry.id === id);
              update({
                ...definition,
                modelConnectionId: next?.id ?? null,
                model: next?.models[0] ?? null,
              });
            }}
          />
          {connection ? (
            <RuntimeSelect
              label="Model"
              value={definition.model ?? ""}
              options={choices(connection.models)}
              onChange={(model) => update({ ...definition, model })}
            />
          ) : null}
          <RuntimeSelect
            label="Agent autonomy ceiling"
            value={definition.autonomy}
            options={choices(npAgentAutonomyModes)}
            onChange={(autonomy) => update({ ...definition, autonomy })}
          />
          <RuntimeSelect
            label="Policy resolution"
            value={definition.policyMode}
            options={[
              { value: "site", label: "Site policy" },
              { value: "site_and_agent", label: "Site and Agent policy" },
            ]}
            onChange={(policyMode) => update({ ...definition, policyMode })}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="font-medium">Available scopes</legend>
          <p className="text-sm text-neutral-500">
            Scopes remain bounded by live deployment authority and any explicit staff delegation.
          </p>
          {!current && catalog.selfDelegation ? (
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={delegated}
                onChange={(event) => {
                  setDelegated(event.target.checked);
                  setKey(crypto.randomUUID());
                }}
              />
              Explicitly delegate my current staff authority to this Agent
            </label>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.scopes.map((scope) => (
              <label className="flex gap-2 text-sm" key={scope}>
                <input
                  type="checkbox"
                  checked={definition.scopes.includes(scope)}
                  onChange={(event) =>
                    update({
                      ...definition,
                      scopes: [
                        ...definition.scopes.filter((entry) => entry !== scope),
                        ...(event.target.checked ? [scope] : []),
                      ].sort(),
                    })
                  }
                />
                {scope}
              </label>
            ))}
          </div>
        </fieldset>
        <RuntimeCapabilityModes
          value={definition.capabilityModes}
          available={modes}
          onChange={(capabilityModes) => update({ ...definition, capabilityModes })}
        />
        <RuntimeBudgetFields
          value={definition.budget}
          ceiling={catalog.effectiveBudget}
          onChange={(budget) => update({ ...definition, budget })}
        />
        <p className="text-sm text-neutral-500">
          Save writes only a draft. Review current readiness and policy hashes before the separate
          activation step. Trigger changes are reviewed and saved with activation.
        </p>
        <Button type="submit" disabled={!selected.length}>
          {busy ? "Saving draft…" : "Save draft"}
        </Button>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function AgentRuntimeDetailView({ id }: { id: string }) {
  const state = useRuntimeResource(
    `/api/admin/agents/configurations/${encodeURIComponent(id)}`,
    npRequireAgentRuntimeStudioConfigurationV1,
  );
  const catalog = useRuntimeResource(runtimeCatalogPath, npRequireAgentRuntimeStudioCatalogV1);
  const triggers = useRuntimeResource(
    `/api/admin/agents/triggers?agentId=${encodeURIComponent(id)}`,
    triggersPage,
  );
  const [editing, setEditing] = React.useState(false);
  const [review, setReview] = React.useState<NpAgentRuntimeStudioEffectiveV1 | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const agent = state.value;
  const refresh = () => {
    setReview(null);
    state.reload();
    triggers.reload();
  };
  const loadReview = async (active = false) => {
    setError(null);
    setReview(null);
    try {
      setReview(
        await runtimeRequest(
          `/api/admin/agents/configurations/${encodeURIComponent(id)}/effective${active ? "?version=active" : ""}`,
          npRequireAgentRuntimeStudioEffectiveV1,
        ),
      );
    } catch (caught) {
      setError(runtimeErrorMessage(caught));
    }
  };
  return (
    <AgentStudioFrame active="configurations">
      <Link className="text-sm underline" href="/admin/agents/configurations">
        Back to Agents
      </Link>
      <RuntimeNotice loading={state.loading} error={state.error} />
      {agent ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{agent.definition.name}</h2>
            <Button variant="outline" onClick={refresh}>
              Refresh
            </Button>
          </div>
          <p>
            {agent.status} · {agent.definition.template} · version {agent.version} (
            {agent.versionStatus})
          </p>
          <p className="text-sm text-neutral-500">
            {agent.definition.model ? `Model: ${agent.definition.model}` : "Deterministic only"} ·{" "}
            {agent.definition.scopes.length} scopes · policy: {agent.definition.policyMode}
          </p>
          <div className="flex flex-wrap gap-2">
            {agent.availableActions.includes("agents.configurations.update") ? (
              <Button variant="outline" onClick={() => setEditing(!editing)}>
                {editing ? "Close editor" : "Edit draft"}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void loadReview()}>
              Review effective configuration
            </Button>
            {(agent.status === "paused" || agent.status === "error") && agent.activeVersion ? (
              <Button variant="outline" onClick={() => void loadReview(true)}>
                Review active version for resume
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={`/admin/agents/activity?origin=runtime&principalId=${agent.principalId}`}>
                View activity
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/agents/policies/new?agentId=${agent.id}`}>
                Create Agent policy
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/agents/policies?agentId=${agent.id}`}>View Agent policies</Link>
            </Button>
          </div>
          {editing && catalog.value ? (
            <RuntimeConfigurationEditor
              key={`${agent.id}:${agent.rowVersion}`}
              catalog={catalog.value}
              initial={agent.definition}
              current={agent}
              onSaved={() => {
                setEditing(false);
                refresh();
              }}
            />
          ) : null}
          <RuntimeNotice loading={false} error={error} />
          {review && review.rowVersion === agent.rowVersion ? (
            <Card>
              <CardHeader>
                <CardTitle>Effective configuration review</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  {review.ready
                    ? "Ready for an explicit activation or resume request"
                    : "Activation is blocked"}
                </p>
                {review.blockers.map((blocker) => (
                  <p key={blocker}>{blocker}</p>
                ))}
                <dl>
                  {Object.entries(review.readiness).map(([name, value]) => (
                    <div key={name} className="flex gap-2">
                      <dt>{name}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p>Resolved policy references: {review.policyRefs.length}</p>
                {review.policyRefs.map((policy) => (
                  <p className="break-all" key={`${policy.kind}:${policy.id ?? "framework"}`}>
                    {policy.kind} · {policy.id ?? "framework"} · {policy.digest}
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : null}
          <RuntimeAgentActions
            key={`${agent.id}:${agent.rowVersion}`}
            agent={agent}
            review={review?.rowVersion === agent.rowVersion ? review : null}
            catalog={catalog.value}
            manualTriggers={
              triggers.value?.items
                .filter(
                  (trigger) =>
                    trigger.enabled &&
                    trigger.definition.type === "manual" &&
                    trigger.agentVersionId === agent.activeVersion?.id,
                )
                .map((trigger) => trigger.definition) ?? []
            }
            onChanged={refresh}
            onAccessLost={state.clear}
          />
          <Card>
            <CardHeader>
              <CardTitle>Registered triggers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <RuntimeNotice loading={triggers.loading} error={triggers.error} />
              {triggers.value?.items.length === 0 ? (
                <p>No triggers are registered. Add a trigger in the explicit activation review.</p>
              ) : null}
              {triggers.value?.items.map((trigger) => (
                <div key={trigger.definition.id} className="text-sm">
                  <p>
                    {trigger.definition.type} · {trigger.enabled ? "enabled" : "disabled"}
                  </p>
                  <p className="break-all">{trigger.definition.id}</p>
                  {trigger.definition.type === "schedule" ? (
                    <p>
                      {trigger.definition.cron} UTC · catch-up {trigger.definition.catchUp} · next{" "}
                      {trigger.nextRunAt ?? "unavailable"}
                    </p>
                  ) : trigger.definition.type === "event" ? (
                    <p>
                      {trigger.definition.eventKind} · coalescing{" "}
                      {trigger.definition.coalesceSeconds}s
                    </p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}
    </AgentStudioFrame>
  );
}

function RuntimeAgentActions({
  agent,
  review,
  catalog,
  manualTriggers,
  onChanged,
  onAccessLost,
}: {
  agent: NpAgentRuntimeStudioConfigurationV1;
  review: NpAgentRuntimeStudioEffectiveV1 | null;
  catalog: NpAgentRuntimeStudioCatalogV1 | null;
  manualTriggers: NpAgentTrigger[];
  onChanged: () => void;
  onAccessLost: (message: string) => void;
}) {
  const router = useRouter();
  const [action, setAction] = React.useState<NpAgentRuntimeAdminOperationIdV1 | null>(null);
  const [reason, setReason] = React.useState("");
  const [goal, setGoal] = React.useState("");
  const [triggerId, setTriggerId] = React.useState(manualTriggers[0]?.id ?? "");
  const [recipeId, setRecipeId] = React.useState(agent.manualRecipeIds[0] ?? "");
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stale, setStale] = React.useState(false);
  const [plan, setPlan] = React.useState<Array<{ definition: NpAgentTrigger; enabled: boolean }>>(
    [],
  );
  const labels: Partial<Record<NpAgentRuntimeAdminOperationIdV1, string>> = {
    "agents.configurations.activate": "Activate reviewed version",
    "agents.configurations.pause": "Pause Agent",
    "agents.configurations.resume": "Resume Agent",
    "agents.configurations.archive": "Archive Agent",
    "agents.configurations.run": "Run now",
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!action) return;
    setBusy(true);
    setError(null);
    const suffix = action.split(".").at(-1)!;
    try {
      const base = { expectedVersion: agent.rowVersion, idempotencyKey: key };
      const body =
        suffix === "pause" || suffix === "archive"
          ? { ...base, reason: reason.trim() }
          : suffix === "run"
            ? {
                ...base,
                configHash: agent.activeVersion?.configHash ?? agent.configHash,
                triggerId: triggerId || manualTriggers[0]?.id,
                inputJson: JSON.stringify({ recipeId, goal: goal.trim() }),
              }
            : {
                ...base,
                configHash: review?.configHash ?? agent.configHash,
                ...(suffix === "activate"
                  ? { reviewedPolicyRefs: review?.policyRefs, triggers: plan }
                  : {}),
              };
      const result = await runtimeRequest(
        `/api/admin/agents/configurations/${agent.id}/${suffix === "run" ? "runs" : suffix}`,
        parseRuntimeAck,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      setAction(null);
      if (suffix === "run") router.push(`/admin/agents/activity/${result.resourceId}`);
      else onChanged();
    } catch (caught) {
      const message = runtimeErrorMessage(caught);
      setError(message);
      if (caught instanceof AgentStudioApiError && [401, 403, 404].includes(caught.status))
        onAccessLost(message);
      if (caught instanceof AgentStudioApiError && caught.status === 409) setStale(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {agent.availableActions
          .filter((id) => labels[id])
          .map((id) => (
            <Button
              key={id}
              variant={id.endsWith("archive") ? "destructive" : "outline"}
              disabled={
                busy ||
                ((id.endsWith("activate") || id.endsWith("resume")) &&
                  (!review?.ready ||
                    review.versionId !==
                      (id.endsWith("resume") ? agent.activeVersion?.id : agent.versionId))) ||
                (id.endsWith("run") && (!manualTriggers.length || !agent.manualRecipeIds.length))
              }
              onClick={() => {
                setAction(id);
                setKey(crypto.randomUUID());
                setError(null);
                setStale(false);
              }}
            >
              {labels[id]}
            </Button>
          ))}
      </div>
      {action ? (
        <form onSubmit={(event) => void submit(event)} className="space-y-4 rounded-lg border p-4">
          <h3 className="font-medium">{labels[action]}</h3>
          <fieldset disabled={busy || stale} className="space-y-4">
            <p className="text-sm text-neutral-500">
              The server rechecks current authority, version and dependencies. Recent staff-primary
              reauthentication may be required. An unknown outcome keeps the same request key.
            </p>
            {action.endsWith("pause") || action.endsWith("archive") ? (
              <div className="space-y-2">
                <Label htmlFor="runtime-agent-reason">Reason</Label>
                <Textarea
                  id="runtime-agent-reason"
                  maxLength={2000}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setKey(crypto.randomUUID());
                  }}
                />
                <p className="text-sm">
                  New admission stops; existing work reaches its recorded safe boundary. Archive
                  preserves history and cannot be resumed.
                </p>
              </div>
            ) : null}
            {action.endsWith("run") ? (
              <>
                <RuntimeSelect
                  label="Manual recipe"
                  value={recipeId}
                  options={choices(agent.manualRecipeIds)}
                  onChange={(next) => {
                    setRecipeId(next);
                    setKey(crypto.randomUUID());
                  }}
                />
                <RuntimeSelect
                  label="Manual trigger"
                  value={triggerId || manualTriggers[0]?.id || ""}
                  options={manualTriggers.map((trigger) => ({
                    value: trigger.id,
                    label: trigger.id,
                  }))}
                  onChange={(next) => {
                    setTriggerId(next);
                    setKey(crypto.randomUUID());
                  }}
                />
                <Label htmlFor="runtime-manual-goal">Run goal</Label>
                <Textarea
                  id="runtime-manual-goal"
                  required
                  maxLength={2000}
                  value={goal}
                  onChange={(event) => {
                    setGoal(event.target.value);
                    setKey(crypto.randomUUID());
                  }}
                />
                <p className="text-sm">
                  The goal cannot add a prompt, capability, scope, model or target beyond the active
                  recipe.
                </p>
              </>
            ) : null}
            {action.endsWith("activate") && catalog ? (
              <RuntimeTriggerPlan
                catalog={catalog}
                agent={agent}
                plan={plan}
                onChange={(next) => {
                  setPlan(next);
                  setKey(crypto.randomUUID());
                }}
              />
            ) : null}
            <div className="flex gap-2">
              <Button type="submit">{busy ? "Submitting…" : "Confirm"}</Button>
              <Button type="button" variant="ghost" onClick={() => setAction(null)}>
                Cancel
              </Button>
            </div>
          </fieldset>
          {error ? <p role="alert">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}

function RuntimeTriggerPlan({
  catalog,
  agent,
  plan,
  onChange,
}: {
  catalog: NpAgentRuntimeStudioCatalogV1;
  agent: NpAgentRuntimeStudioConfigurationV1;
  plan: Array<{ definition: NpAgentTrigger; enabled: boolean }>;
  onChange: (plan: Array<{ definition: NpAgentTrigger; enabled: boolean }>) => void;
}) {
  const recipes = catalog.recipes.filter((recipe) =>
    agent.definition.settings.some((entry) => entry.recipeId === recipe.id),
  );
  const kinds = (["manual", "schedule", "event"] as const).filter((kind) =>
    recipes.some((recipe) => recipe.triggerKinds.includes(kind)),
  );
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">Triggers for this activation</legend>
      <p className="text-sm">
        Trigger registration and enablement are saved atomically with activation. Editing an active
        trigger requires a replacement draft and fresh trigger identity.
      </p>
      {plan.map((entry, index) => (
        <div className="space-y-2 rounded border p-3" key={entry.definition.id}>
          <p>{entry.definition.type}</p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={entry.enabled}
              onChange={(event) =>
                onChange(
                  plan.map((value, i) =>
                    i === index ? { ...value, enabled: event.target.checked } : value,
                  ),
                )
              }
            />
            Enable after activation
          </label>
          {entry.definition.type === "schedule" ? (
            <>
              <Label htmlFor={`trigger-cron-${index}`}>Five-field UTC cron</Label>
              <Input
                id={`trigger-cron-${index}`}
                required
                value={entry.definition.cron}
                onChange={(event) =>
                  onChange(
                    plan.map((value, i) =>
                      i === index && value.definition.type === "schedule"
                        ? {
                            ...value,
                            definition: { ...value.definition, cron: event.target.value },
                          }
                        : value,
                    ),
                  )
                }
              />
              <RuntimeSelect
                label="Missed schedule handling"
                value={entry.definition.catchUp}
                options={[
                  { value: "skip", label: "Skip missed schedules" },
                  { value: "once", label: "Catch up once" },
                ]}
                onChange={(catchUp) =>
                  onChange(
                    plan.map((value, i) =>
                      i === index && value.definition.type === "schedule"
                        ? { ...value, definition: { ...value.definition, catchUp } }
                        : value,
                    ),
                  )
                }
              />
            </>
          ) : null}
          {entry.definition.type === "event" ? (
            <RuntimeEventTriggerFields
              value={entry.definition}
              onChange={(definition) =>
                onChange(plan.map((value, i) => (i === index ? { ...value, definition } : value)))
              }
            />
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(plan.filter((_, i) => i !== index))}
          >
            Remove trigger
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {kinds.map((kind) => (
          <Button
            key={kind}
            type="button"
            variant="outline"
            disabled={plan.length >= 32}
            onClick={() =>
              onChange([
                ...plan,
                {
                  enabled: false,
                  definition:
                    kind === "manual"
                      ? { type: "manual", id: crypto.randomUUID() }
                      : kind === "schedule"
                        ? {
                            type: "schedule",
                            id: crypto.randomUUID(),
                            cron: "0 * * * *",
                            catchUp: "skip",
                          }
                        : {
                            type: "event",
                            id: crypto.randomUUID(),
                            eventKind: "agent.run.changed",
                            filter: { op: "eq", field: "privacy", value: "internal" },
                            coalesceSeconds: 0,
                          },
                },
              ])
            }
          >
            Add {kind} trigger
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
