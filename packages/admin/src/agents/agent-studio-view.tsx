"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Cable, KeyRound, Plus, RefreshCw, Shield } from "lucide-react";
import {
  npAgentScopes,
  npRequireAgentPrincipalV1,
  type NpAgentScope,
  type NpAgentStudioOverviewV1,
} from "@nexpress/core/agent-contract";

import { AgentStudioFrame, type AgentStudioSection } from "./agent-studio-frame.js";
import { loadAgentStudioOverview, responseError } from "./agent-studio-api.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Textarea } from "../ui/textarea.js";
import { npFetch } from "../lib/api-client.js";

function stateTone(state: string) {
  if (state === "ready" || state === "active") return "brand" as const;
  if (state === "unavailable" || state === "error" || state === "revoked")
    return "destructive" as const;
  return "secondary" as const;
}

function RuntimeNotice({ overview }: { overview: NpAgentStudioOverviewV1 }) {
  const unavailable = [
    overview.runtime.connections.issueCode,
    overview.runtime.gateway.issueCode,
  ].filter((value): value is string => value !== null);
  if (unavailable.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
    >
      Agent control-plane mutations are disabled until the host supplies its independent keys,
      Vault, adapters, and reauthentication verifier. Safe code: {unavailable.join(", ")}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-[13px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
      {children}
    </div>
  );
}

export function AgentStudioView({ section }: { section: AgentStudioSection }) {
  const [overview, setOverview] = React.useState<NpAgentStudioOverviewV1 | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await loadAgentStudioOverview());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Agent Studio.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  return (
    <AgentStudioFrame active={section}>
      {loading ? <p className="text-[13px] text-neutral-500">Loading Agent Studio…</p> : null}
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"
        >
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : null}
      {overview ? (
        <>
          <RuntimeNotice overview={overview} />
          {section === "overview" ? (
            <OverviewContent overview={overview} />
          ) : (
            <ConnectionsContent overview={overview} onChanged={reload} />
          )}
        </>
      ) : null}
    </AgentStudioFrame>
  );
}

function OverviewContent({ overview }: { overview: NpAgentStudioOverviewV1 }) {
  const enabledTransports = Object.entries(overview.gatewaySettings).filter(
    ([key, value]) => key !== "schemaVersion" && value !== "disabled",
  ).length;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Provider connections", overview.connections.length.toString(), Cable],
          ["Gateway principals", overview.principals.length.toString(), Shield],
          ["Installed adapters", overview.adapters.length.toString(), RefreshCw],
          ["Enabled transports", enabledTransports.toString(), KeyRound],
        ].map(([label, value, Icon]) => (
          <Card key={String(label)}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  {String(label)}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{String(value)}</p>
              </div>
              <Icon className="size-4 text-neutral-400" aria-hidden />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Control-plane boundary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-[13px] md:grid-cols-2">
          <div className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900/50">
            <p className="font-medium">NexPress → Provider</p>
            <p className="mt-1 text-neutral-500 dark:text-neutral-400">
              Model and notification credentials remain Vault-backed and are used only by server
              workers.
            </p>
          </div>
          <div className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900/50">
            <p className="font-medium">External client → NexPress</p>
            <p className="mt-1 text-neutral-500 dark:text-neutral-400">
              Gateway authority is site-scoped, exposure-bounded, and served on existing stdio or
              HTTP paths—never a new port.
            </p>
          </div>
        </CardContent>
      </Card>
      <Button asChild variant="outline">
        <Link href="/admin/agents/connections">
          Manage connections <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    </div>
  );
}

function ConnectionsContent({
  overview,
  onChanged,
}: {
  overview: NpAgentStudioOverviewV1;
  onChanged: () => Promise<void>;
}) {
  return (
    <Tabs defaultValue="providers" className="space-y-4">
      <TabsList>
        <TabsTrigger value="providers">Provider outbound</TabsTrigger>
        <TabsTrigger value="gateway">Gateway inbound</TabsTrigger>
      </TabsList>
      <TabsContent value="providers" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold">Provider connections</h2>
            <p className="text-[12.5px] text-neutral-500">
              Credentials NexPress uses to call installed providers.
            </p>
          </div>
          <Button asChild size="sm" disabled={overview.runtime.connections.state !== "ready"}>
            <Link href="/admin/agents/connections/new">
              <Plus className="size-3.5" />
              Add connection
            </Link>
          </Button>
        </div>
        {overview.connections.length === 0 ? (
          <Empty>No provider connections for this site.</Empty>
        ) : (
          <div className="grid gap-2">
            {overview.connections.map((connection) => (
              <Link
                key={connection.id}
                href={`/admin/agents/connections/${encodeURIComponent(connection.id)}`}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-3 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{connection.name}</p>
                  <p className="truncate text-[12px] text-neutral-500">
                    {connection.provider} · {connection.kind} · {connection.authKind}
                  </p>
                </div>
                <Badge variant={stateTone(connection.status)}>{connection.status}</Badge>
              </Link>
            ))}
          </div>
        )}
      </TabsContent>
      <TabsContent value="gateway" className="space-y-4">
        <div>
          <h2 className="text-[16px] font-semibold">Gateway principals</h2>
          <p className="text-[12.5px] text-neutral-500">
            Site-scoped authority for external MCP, Agent HTTP, or local stdio clients.
          </p>
        </div>
        <PrincipalCreateForm
          disabled={overview.runtime.gateway.state !== "ready"}
          onCreated={onChanged}
        />
        {overview.principals.length === 0 ? (
          <Empty>No external Gateway principals for this site.</Empty>
        ) : (
          <div className="grid gap-2">
            {overview.principals.map((principal) => (
              <Link
                key={principal.id}
                href={`/admin/agents/gateway/${encodeURIComponent(principal.id)}`}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-3 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{principal.name}</p>
                  <p className="truncate text-[12px] text-neutral-500">
                    {principal.scopes.join(", ")}
                  </p>
                </div>
                <Badge variant={stateTone(principal.status)}>{principal.status}</Badge>
              </Link>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

function PrincipalCreateForm({
  disabled,
  onCreated,
}: {
  disabled: boolean;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [scopes, setScopes] = React.useState<NpAgentScope[]>(["site:read"]);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await npFetch("/api/admin/agents/gateway/principals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          name,
          description: description || null,
          scopes: [...scopes].sort(),
        }),
      });
      if (!response.ok) throw await responseError(response);
      npRequireAgentPrincipalV1(await response.json());
      setName("");
      setDescription("");
      setScopes(["site:read"]);
      setOpen(false);
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create principal.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open)
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" />
        Create principal
      </Button>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[14px]">New Gateway principal</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="principal-name">Name</Label>
            <Input
              id="principal-name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="principal-description">Description</Label>
            <Textarea
              id="principal-description"
              maxLength={4096}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-[12.5px] font-medium">Scopes</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {npAgentScopes.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    disabled={scope === "site:read"}
                    onChange={(e) =>
                      setScopes((current) =>
                        e.target.checked
                          ? [...current, scope].sort()
                          : current.filter((item) => item !== scope),
                      )
                    }
                  />
                  {scope}
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-[12.5px] text-red-600">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
