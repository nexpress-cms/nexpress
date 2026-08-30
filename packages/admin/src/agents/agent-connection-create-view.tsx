"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  npAgentProviderDataClasses,
  npDigestAgentStudioConnectionDefinitionV1,
  npRequireAgentConnectionV1,
  npSerializeAgentStudioConnectionDefinitionV1,
  type NpAgentConnectionKind,
  type NpAgentJsonObject,
  type NpAgentProviderDataClass,
  type NpAgentStudioAdapterV1,
  type NpAgentStudioConnectionDefinitionV1,
  type NpAgentStudioOverviewV1,
} from "@nexpress/core/agent-contract";

import { AgentStudioFrame } from "./agent-studio-frame.js";
import { loadAgentStudioOverview, responseError } from "./agent-studio-api.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { npFetch } from "../lib/api-client.js";

function defaultConfig(adapter: NpAgentStudioAdapterV1): NpAgentJsonObject {
  const schema = adapter.configSchema as Record<string, unknown>;
  const properties =
    typeof schema.properties === "object" && schema.properties !== null
      ? (schema.properties as Record<string, unknown>)
      : {};
  const result: NpAgentJsonObject = {};
  for (const [key, raw] of Object.entries(properties)) {
    const property =
      typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    if (Array.isArray(property.enum) && property.enum.length > 0) {
      result[key] = property.enum[0] as never;
    } else if (
      Array.isArray(property.anyOf) &&
      property.anyOf.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { type?: unknown }).type === "null",
      )
    ) {
      result[key] = null;
    } else if (property.type === "boolean") {
      result[key] = false;
    } else if (property.type === "integer" || property.type === "number") {
      result[key] = 0;
    } else {
      result[key] = "";
    }
  }
  return result;
}

export function AgentConnectionCreateView() {
  const router = useRouter();
  const [overview, setOverview] = React.useState<NpAgentStudioOverviewV1 | null>(null);
  const [adapterId, setAdapterId] = React.useState("");
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<NpAgentConnectionKind>("model");
  const [authKind, setAuthKind] = React.useState<"api_key" | "oauth">("api_key");
  const [ceiling, setCeiling] = React.useState<NpAgentProviderDataClass>("public-only");
  const [configJson, setConfigJson] = React.useState("{}");
  const [credential, setCredential] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    void loadAgentStudioOverview()
      .then((value) => {
        setOverview(value);
        const first = value.adapters[0];
        if (first) {
          setAdapterId(first.id);
          setKind(first.supportedConnectionKinds[0]);
          setAuthKind(first.supportedAuthKinds[0]);
          setConfigJson(JSON.stringify(defaultConfig(first), null, 2));
        }
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Could not load adapters."),
      );
  }, []);

  const adapter = overview?.adapters.find((entry) => entry.id === adapterId) ?? null;
  const chooseAdapter = (id: string) => {
    setAdapterId(id);
    const selected = overview?.adapters.find((entry) => entry.id === id);
    if (!selected) return;
    setKind(selected.supportedConnectionKinds[0]);
    setAuthKind(selected.supportedAuthKinds[0]);
    setConfigJson(JSON.stringify(defaultConfig(selected), null, 2));
    setCredential("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!adapter) return;
    setSubmitting(true);
    setError(null);
    try {
      const config = JSON.parse(configJson) as NpAgentJsonObject;
      const definition: NpAgentStudioConnectionDefinitionV1 = {
        schemaVersion: "np.agent-studio-connection-definition.v1",
        name,
        kind,
        provider: adapter.id,
        adapterId: adapter.id,
        adapterContractVersion: adapter.contractVersion,
        adapterFingerprint: adapter.fingerprint,
        authKind,
        config,
        dataProcessingCeiling: ceiling,
      };
      const response = await npFetch("/api/admin/agents/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          credential: authKind === "api_key" ? credential : "",
          definitionJson: npSerializeAgentStudioConnectionDefinitionV1(definition),
          definitionHash: await npDigestAgentStudioConnectionDefinitionV1(definition),
          vaultOperationId: crypto.randomUUID(),
        }),
      });
      setCredential("");
      if (!response.ok) throw await responseError(response);
      const created = npRequireAgentConnectionV1(await response.json());
      router.push(`/admin/agents/connections/${encodeURIComponent(created.id)}`);
    } catch (caught) {
      setCredential("");
      setError(caught instanceof Error ? caught.message : "Could not create connection.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AgentStudioFrame active="connections">
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-[16px]">Add provider connection</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={(event) => void submit(event)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="adapter">Installed adapter</Label>
                <select
                  id="adapter"
                  className="h-10 rounded-lg border border-neutral-200 bg-transparent px-3 text-[13px] sm:h-8 dark:border-neutral-800"
                  required
                  value={adapterId}
                  onChange={(e) => chooseAdapter(e.target.value)}
                >
                  {overview?.adapters.map((entry) => (
                    <option
                      key={`${entry.id}:${entry.contractVersion.toString()}`}
                      value={entry.id}
                    >
                      {entry.id} v{entry.contractVersion}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="connection-name">Name</Label>
                <Input
                  id="connection-name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="purpose">Purpose</Label>
                <select
                  id="purpose"
                  className="h-10 rounded-lg border border-neutral-200 bg-transparent px-3 text-[13px] sm:h-8 dark:border-neutral-800"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as NpAgentConnectionKind)}
                >
                  {adapter?.supportedConnectionKinds.map((entry) => (
                    <option key={entry}>{entry}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="auth-kind">Authentication</Label>
                <select
                  id="auth-kind"
                  className="h-10 rounded-lg border border-neutral-200 bg-transparent px-3 text-[13px] sm:h-8 dark:border-neutral-800"
                  value={authKind}
                  onChange={(e) => {
                    setAuthKind(e.target.value as "api_key" | "oauth");
                    setCredential("");
                  }}
                >
                  {adapter?.supportedAuthKinds.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry === "api_key" ? "API key" : "OAuth"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="data-ceiling">Data processing ceiling</Label>
                <select
                  id="data-ceiling"
                  className="h-10 rounded-lg border border-neutral-200 bg-transparent px-3 text-[13px] sm:h-8 dark:border-neutral-800"
                  value={ceiling}
                  onChange={(e) => setCeiling(e.target.value as NpAgentProviderDataClass)}
                >
                  {npAgentProviderDataClasses.map((entry) => (
                    <option key={entry}>{entry}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="provider-config">Non-secret provider configuration</Label>
              <Textarea
                id="provider-config"
                className="min-h-44 font-mono text-[12px]"
                spellCheck={false}
                value={configJson}
                onChange={(e) => setConfigJson(e.target.value)}
              />
              <p className="text-[12px] text-neutral-500">
                Validated against the installed adapter’s exact JSON schema. Secrets are rejected
                from this object.
              </p>
            </div>
            {authKind === "api_key" ? (
              <div className="grid gap-2">
                <Label htmlFor="credential">API key (write only)</Label>
                <Input
                  id="credential"
                  type="password"
                  autoComplete="off"
                  required
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                />
                <p className="text-[12px] text-neutral-500">
                  Cleared from browser state after submission and never returned by the API.
                </p>
              </div>
            ) : (
              <p className="rounded-lg bg-neutral-50 px-3 py-2.5 text-[12.5px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                OAuth creates a pending connection. Authorization can start only through the
                adapter’s exact server-owned callback configuration.
              </p>
            )}
            {error ? (
              <p role="alert" className="text-[12.5px] text-red-600">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={submitting || !adapter || overview?.runtime.connections.state !== "ready"}
              >
                {submitting ? "Saving…" : "Save connection"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push("/admin/agents/connections")}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AgentStudioFrame>
  );
}
