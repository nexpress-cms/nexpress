"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  npAnalyzeAgentRuntimeStudioPoliciesPageV1,
  npRequireAgentContractResult,
  npRequireAgentRuntimeStudioPolicyV1,
  npRequireAgentRuntimeStudioCatalogV1,
  npBuildAgentRuntimeStudioDefinitionInputV1,
  type NpAgentPolicyDefinitionV1,
  type NpAgentRuntimeStudioPolicyV1,
  type NpAgentRuntimeStudioCatalogV1,
} from "@nexpress/core/agent-contract";
import { AgentPolicySimulation } from "./agent-policy-simulation.js";
import { AgentStudioFrame } from "./agent-studio-frame.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeRequest, runtimeErrorMessage, useRuntimeResource } from "./agent-runtime-api.js";
import { RuntimeSelect } from "./agent-runtime-fields.js";
import { RuntimePolicyFields } from "./agent-policy-fields.js";
import { RuntimeNotice, parseRuntimeAck, runtimeCatalogPath } from "./agent-runtime-view.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

const policyPage = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioPoliciesPageV1(value));

export function AgentPolicyListView({ query = "" }: { query?: string }) {
  const router = useRouter();
  const [status, setStatus] = React.useState(new URLSearchParams(query).get("status") ?? "all");
  const state = useRuntimeResource(
    `/api/admin/agents/policies${query ? `?${query}` : ""}`,
    policyPage,
  );
  return (
    <AgentStudioFrame active="policies">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-semibold">Policies</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={state.reload}>
            Refresh
          </Button>
          <Button asChild>
            <Link href="/admin/agents/policies/new">Create policy draft</Link>
          </Button>
        </div>
      </div>
      <p className="text-sm text-neutral-500">
        Enforced rules control execution. Agent guidance can influence output but cannot grant
        authority. Active and retired versions are immutable.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const params = new URLSearchParams(query);
          params.delete("cursor");
          if (status === "all") params.delete("status");
          else params.set("status", status);
          router.push(`/admin/agents/policies?${params}`);
        }}
      >
        <RuntimeSelect
          label="Policy status"
          value={status}
          options={[
            { value: "all", label: "All policy states" },
            ...(["draft", "active", "retired"] as const).map((value) => ({ value, label: value })),
          ]}
          onChange={setStatus}
        />
        <Button type="submit" variant="outline">
          Apply policy filter
        </Button>
      </form>
      <RuntimeNotice loading={state.loading} error={state.error} />
      {state.value?.items.length === 0 ? <p>No policies match this view.</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {state.value?.items.map((policy) => (
          <Card key={policy.id}>
            <CardHeader>
              <CardTitle>
                <Link className="underline" href={`/admin/agents/policies/${policy.id}`}>
                  {policy.definition.name}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {policy.status} · version {policy.version} ·{" "}
                {policy.definition.agentId ? "Agent override" : "Site policy"}
              </p>
              <p className="break-all">{policy.contentHash}</p>
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
            router.push(`/admin/agents/policies?${params}`);
          }}
        >
          Next page
        </Button>
      ) : null}
    </AgentStudioFrame>
  );
}

export function AgentPolicyCreateView({ agentId }: { agentId?: string }) {
  const catalog = useRuntimeResource(runtimeCatalogPath, npRequireAgentRuntimeStudioCatalogV1);
  return (
    <AgentStudioFrame active="policies">
      <h2 className="text-lg font-semibold">Create policy draft</h2>
      <RuntimeNotice loading={catalog.loading} error={catalog.error} />
      {catalog.value ? (
        <PolicyEditor
          catalog={catalog.value}
          initial={{
            schemaVersion: "np.agent-policy-definition.v1",
            agentId: agentId ?? null,
            name: "",
            instructions: "",
            rules: catalog.value.defaultPolicyRules,
          }}
        />
      ) : null}
    </AgentStudioFrame>
  );
}

function PolicyEditor({
  initial,
  catalog,
  current,
  onSaved,
}: {
  initial: NpAgentPolicyDefinitionV1;
  catalog: NpAgentRuntimeStudioCatalogV1;
  current?: NpAgentRuntimeStudioPolicyV1;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [definition, setDefinition] = React.useState(initial);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const [accessLost, setAccessLost] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const update = (next: NpAgentPolicyDefinitionV1) => {
    setDefinition(next);
    setKey(crypto.randomUUID());
  };
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
          ? { expectedVersion: current.rowVersion, configHash: current.contentHash }
          : {}),
      };
      requestAttempted = true;
      const result = await runtimeRequest(
        `/api/admin/agents/policies${current ? `/${current.id}` : ""}`,
        parseRuntimeAck,
        {
          method: current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (current && onSaved) onSaved();
      else router.push(`/admin/agents/policies/${result.resourceId}`);
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
        <div className="space-y-2">
          <Label htmlFor="runtime-policy-name">Policy name</Label>
          <Input
            id="runtime-policy-name"
            required
            maxLength={120}
            value={definition.name}
            onChange={(event) => update({ ...definition, name: event.target.value })}
          />
          <p className="text-sm">
            Applies to {definition.agentId ? `Agent ${definition.agentId}` : "the current site"}.
          </p>
        </div>
        <section className="space-y-4 rounded-lg border p-4" aria-label="Enforced policy rules">
          <h3 className="font-semibold">Enforced rules</h3>
          <p className="text-sm text-neutral-500">
            These structured rules authorize or block actions, within all existing deployment and
            staff authority ceilings.
          </p>
          <RuntimePolicyFields
            value={definition.rules}
            availableModes={catalog.capabilities.flatMap((capability) =>
              capability.modes.map((mode) => ({ capabilityId: capability.id, mode })),
            )}
            onChange={(rules) => update({ ...definition, rules })}
          />
        </section>
        <section
          className="space-y-3 rounded-lg border p-4"
          aria-label="Non-authorizing Agent guidance"
        >
          <h3 className="font-semibold">Agent guidance</h3>
          <p className="text-sm text-neutral-500">
            Guidance is untrusted context. It cannot grant a scope, capability or approval.
          </p>
          <Label htmlFor="runtime-policy-guidance">Guidance (Markdown text)</Label>
          <Textarea
            id="runtime-policy-guidance"
            rows={8}
            maxLength={262_144}
            value={definition.instructions}
            onChange={(event) => update({ ...definition, instructions: event.target.value })}
          />
        </section>
        <Button type="submit">{busy ? "Saving draft…" : "Save policy draft"}</Button>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function AgentPolicyDetailView({ id }: { id: string }) {
  const state = useRuntimeResource(
    `/api/admin/agents/policies/${encodeURIComponent(id)}`,
    npRequireAgentRuntimeStudioPolicyV1,
  );
  const catalog = useRuntimeResource(runtimeCatalogPath, npRequireAgentRuntimeStudioCatalogV1);
  const [editing, setEditing] = React.useState(false);
  const [duplicate, setDuplicate] = React.useState(false);
  const [action, setAction] = React.useState<"validate" | "activate" | null>(null);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [challenge, setChallenge] = React.useState("");
  const [stale, setStale] = React.useState(false);
  const policy = state.value;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!policy || !action) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await runtimeRequest(`/api/admin/agents/policies/${policy.id}/${action}`, parseRuntimeAck, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: key,
          expectedVersion: policy.rowVersion,
          configHash: policy.contentHash,
        }),
      });
      setMessage(
        action === "validate"
          ? "The server completed deterministic validation. This does not activate the policy."
          : "The exact policy version was activated. Previously admitted runs retain their frozen policy references.",
      );
      setAction(null);
      state.reload();
    } catch (caught) {
      const text = runtimeErrorMessage(caught);
      setError(text);
      if (caught instanceof AgentStudioApiError && [401, 403, 404].includes(caught.status))
        state.clear(text);
      if (caught instanceof AgentStudioApiError && caught.status === 409) setStale(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AgentStudioFrame active="policies">
      <Link className="text-sm underline" href="/admin/agents/policies">
        Back to policies
      </Link>
      <RuntimeNotice loading={state.loading} error={state.error} />
      {policy ? (
        <>
          <h2 className="text-lg font-semibold">{policy.definition.name}</h2>
          <p>
            {policy.status} · version {policy.version} ·{" "}
            {policy.definition.agentId ? "Agent override" : "Site policy"}
          </p>
          <p className="break-all text-sm">Content hash: {policy.contentHash}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                state.reload();
                setStale(false);
                setAction(null);
              }}
            >
              Refresh
            </Button>
            {policy.availableActions.includes("agents.policies.update") ? (
              <Button variant="outline" onClick={() => setEditing(!editing)}>
                {editing ? "Close editor" : "Edit draft"}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setDuplicate(!duplicate)}>
                {duplicate ? "Close duplicate draft" : "Duplicate as draft"}
              </Button>
            )}
            {(["validate", "activate"] as const)
              .filter((name) => policy.availableActions.includes(`agents.policies.${name}`))
              .map((name) => (
                <Button
                  key={name}
                  variant="outline"
                  onClick={() => {
                    setAction(name);
                    setKey(crypto.randomUUID());
                    setChallenge("");
                    setError(null);
                  }}
                >
                  {name === "validate" ? "Validate policy" : "Activate policy"}
                </Button>
              ))}
          </div>
          {catalog.value && (editing || duplicate) ? (
            <PolicyEditor
              key={`${policy.id}:${policy.rowVersion}:${duplicate}`}
              initial={policy.definition}
              catalog={catalog.value}
              current={duplicate ? undefined : policy}
              onSaved={() => {
                setEditing(false);
                state.reload();
              }}
            />
          ) : (
            <>
              <section className="space-y-3" aria-label="Enforced rules summary">
                <h3 className="font-semibold">Enforced rules</h3>
                <p>
                  Maximum automatic action: {policy.definition.rules.risk.automaticActionMaximum} ·
                  provider data: {policy.definition.rules.providerDataMaximum}
                </p>
                {policy.definition.rules.capabilityModes.map((mode) => (
                  <p className="text-sm" key={mode.capabilityId}>
                    {mode.capabilityId}: {mode.mode}
                  </p>
                ))}
                {catalog.value ? (
                  <fieldset disabled>
                    <RuntimePolicyFields
                      value={policy.definition.rules}
                      availableModes={catalog.value.capabilities.flatMap((capability) =>
                        capability.modes.map((mode) => ({ capabilityId: capability.id, mode })),
                      )}
                      onChange={() => undefined}
                    />
                  </fieldset>
                ) : null}
              </section>
              <section className="space-y-2" aria-label="Non-authorizing guidance">
                <h3 className="font-semibold">Agent guidance</h3>
                <p className="text-sm text-neutral-500">
                  Untrusted plain text; this cannot grant authority.
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {policy.definition.instructions || "No guidance configured."}
                </p>
              </section>
            </>
          )}
          {action ? (
            <form
              className="space-y-3 rounded-lg border p-4"
              onSubmit={(event) => void submit(event)}
            >
              <h3 className="font-medium">
                {action === "activate"
                  ? "Activate exact reviewed policy"
                  : "Validate current policy"}
              </h3>
              <p className="text-sm">
                Activation affects newly admitted runs. Recent staff-primary reauthentication is
                required for activation. Validation is non-authorizing.
              </p>
              {action === "activate" ? (
                <>
                  <Label htmlFor="runtime-policy-confirm">
                    Type ACTIVATE to confirm this version
                  </Label>
                  <Input
                    id="runtime-policy-confirm"
                    value={challenge}
                    onChange={(event) => setChallenge(event.target.value)}
                  />
                </>
              ) : null}
              <div className="flex gap-2">
                <Button
                  disabled={busy || stale || (action === "activate" && challenge !== "ACTIVATE")}
                  type="submit"
                >
                  {busy ? "Submitting…" : "Confirm"}
                </Button>
                <Button variant="ghost" type="button" onClick={() => setAction(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
          {!editing &&
          !duplicate &&
          policy.availableActions.includes("agents.policies.simulate") ? (
            <AgentPolicySimulation
              key={`${policy.id}:${policy.rowVersion}`}
              policy={policy}
              onAccessLost={state.clear}
            />
          ) : null}
          {message ? <p role="status">{message}</p> : null}
          <RuntimeNotice loading={false} error={error} />
        </>
      ) : null}
    </AgentStudioFrame>
  );
}
