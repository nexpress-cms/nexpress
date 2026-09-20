"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Cable, KeyRound, Plus, RefreshCw, Shield } from "lucide-react";
import {
  npAgentScopes,
  npRequireAgentOauthClientV1,
  npRequireAgentPrincipalV1,
  type NpAgentOauthClientTransportV1,
  type NpAgentOauthClientV1,
  type NpAgentScope,
  type NpAgentStudioOverviewV1,
} from "@nexpress/core/agent-contract";

import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { AgentStudioFrame, type AgentStudioSection } from "./agent-studio-frame.js";
import {
  AgentStudioApiError,
  loadAgentOauthClients,
  loadAgentStudioOverview,
  responseError,
} from "./agent-studio-api.js";
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
  const [failure, setFailure] = React.useState<unknown>();
  const failureRef = React.useRef<unknown>(undefined);
  const [loading, setLoading] = React.useState(true);
  const [observedAt, setObservedAt] = React.useState<number>();
  const request = React.useRef<AbortController | null>(null);

  const onChildFailure = React.useCallback((caught: unknown) => {
    if (!(caught instanceof AgentStudioApiError) || ![401, 403, 404].includes(caught.status))
      return;
    request.current?.abort();
    failureRef.current = caught;
    setFailure(caught);
    setOverview(null);
    setObservedAt(undefined);
    setLoading(false);
    setError(
      caught.code === "RECENT_REAUTHENTICATION_REQUIRED"
        ? "Recent staff-primary reauthentication is required. Reauthenticate and reload."
        : "Agent Studio is unavailable or you no longer have access.",
    );
  }, []);

  const reload = React.useCallback(async () => {
    const previous = failureRef.current;
    if (
      previous instanceof AgentStudioApiError &&
      (previous.status === 401 || (previous.retryAt !== undefined && previous.retryAt > Date.now()))
    )
      return;
    failureRef.current = undefined;
    setFailure(undefined);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const value = await loadAgentStudioOverview(controller.signal);
      if (controller.signal.aborted) return;
      setOverview(value);
      setObservedAt(Date.now());
    } catch (caught) {
      if (controller.signal.aborted) return;
      failureRef.current = caught;
      setFailure(caught);
      setOverview(null);
      setObservedAt(undefined);
      setError(
        caught instanceof AgentStudioApiError &&
          caught.status === 403 &&
          caught.code === "RECENT_REAUTHENTICATION_REQUIRED"
          ? "Recent staff-primary reauthentication is required. Reauthenticate and reload."
          : caught instanceof AgentStudioApiError && [401, 403, 404].includes(caught.status)
            ? "Agent Studio is unavailable or you no longer have access."
            : caught instanceof AgentStudioApiError
              ? `${caught.message} (${caught.code})`
              : "Could not load Agent Studio.",
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
    };
  }, [reload]);

  return (
    <AgentStudioFrame
      active={section}
      recovery={failure}
      busy={loading}
      refreshing={loading && overview !== null}
      observedAt={observedAt}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {section === "overview" ? "Overview" : "Connections"}
        </h2>
        <Button type="button" variant="outline" onClick={() => void reload()}>
          Refresh
        </Button>
      </div>
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
            <ConnectionsContent overview={overview} onChanged={reload} onFailure={onChildFailure} />
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
  onFailure,
}: {
  onFailure: (failure: unknown) => void;
  overview: NpAgentStudioOverviewV1;
  onChanged: () => Promise<void>;
}) {
  return (
    <Tabs defaultValue="providers" className="space-y-4">
      <TabsList className="grid h-auto w-full grid-cols-2 sm:w-fit">
        <TabsTrigger value="providers" className="min-w-0 whitespace-normal">
          Provider outbound
        </TabsTrigger>
        <TabsTrigger value="gateway" className="min-w-0 whitespace-normal">
          Gateway inbound
        </TabsTrigger>
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
                  <p className="break-words text-[13.5px] font-medium leading-snug">
                    {connection.name}
                  </p>
                  <p className="break-words text-[12px] text-neutral-500">
                    {connection.provider} · {connection.kind} · {connection.authKind}
                  </p>
                </div>
                <Badge
                  className="shrink-0 whitespace-nowrap"
                  variant={stateTone(connection.status)}
                >
                  {connection.status}
                </Badge>
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
        <OauthClientsPanel
          disabled={overview.runtime.gateway.state !== "ready"}
          onFailure={onFailure}
        />
        <PrincipalCreateForm
          disabled={overview.runtime.gateway.state !== "ready"}
          onCreated={onChanged}
          onFailure={onFailure}
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
                  <p className="break-words text-[13.5px] font-medium leading-snug">
                    {principal.name}
                  </p>
                  <p className="break-words text-[12px] text-neutral-500">
                    {principal.scopes.join(", ")}
                  </p>
                </div>
                <Badge className="shrink-0 whitespace-nowrap" variant={stateTone(principal.status)}>
                  {principal.status}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

function OauthClientsPanel({
  disabled,
  onFailure,
}: {
  disabled: boolean;
  onFailure: (failure: unknown) => void;
}) {
  const [loading, setLoading] = React.useState(!disabled);
  const [loaded, setLoaded] = React.useState(false);
  const [clients, setClients] = React.useState<NpAgentOauthClientV1[]>([]);
  const [name, setName] = React.useState("");
  const [redirects, setRedirects] = React.useState("http://127.0.0.1:3000/callback");
  const [transports, setTransports] = React.useState<NpAgentOauthClientTransportV1[]>(["mcp-http"]);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<unknown>();
  const failureRef = React.useRef<unknown>(undefined);
  const retryBlocked = useAgentRetryBlocked(failure);
  const request = React.useRef<AbortController | null>(null);
  const retry = React.useRef<{ fingerprint: string; key: string } | null>(null);
  const revokeRetry = React.useRef<{ fingerprint: string; key: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    const previous = failureRef.current;
    if (
      previous instanceof AgentStudioApiError &&
      (previous.status === 401 || (previous.retryAt !== undefined && previous.retryAt > Date.now()))
    )
      return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const value = await loadAgentOauthClients(controller.signal);
      if (controller.signal.aborted) return;
      setClients(value);
      setLoaded(true);
      failureRef.current = undefined;
      setFailure(undefined);
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted) return;
      failureRef.current = caught;
      setFailure(caught);
      onFailure(caught);
      setClients([]);
      setError(caught instanceof Error ? caught.message : "Could not load OAuth clients.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [onFailure]);

  React.useEffect(() => {
    if (disabled) return;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
    };
  }, [disabled, reload]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || busy || retryBlocked) return;
    setBusy(true);
    setError(null);
    try {
      const redirectUris = [
        ...new Set(
          redirects
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ].sort();
      const fingerprint = JSON.stringify({
        name,
        redirectUris,
        transports: [...transports].sort(),
      });
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, key: crypto.randomUUID() };
      const response = await npFetch("/api/admin/agents/gateway/oauth-clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: retry.current.key,
          name,
          redirectUris,
          transports: [...transports].sort(),
        }),
      });
      if (!response.ok) throw await responseError(response);
      npRequireAgentOauthClientV1(await response.json());
      retry.current = null;
      setName("");
      setOpen(false);
      failureRef.current = undefined;
      setFailure(undefined);
      await reload();
    } catch (caught) {
      failureRef.current = caught;
      setFailure(caught);
      onFailure(caught);
      setError(caught instanceof Error ? caught.message : "Could not register OAuth client.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (client: NpAgentOauthClientV1) => {
    if (disabled || busy || retryBlocked) return;
    const fingerprint = `${client.id}:${client.rowVersion}`;
    if (revokeRetry.current?.fingerprint !== fingerprint)
      revokeRetry.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const response = await npFetch(
        `/api/admin/agents/gateway/oauth-clients/${encodeURIComponent(client.id)}/revoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: revokeRetry.current.key,
            expectedVersion: client.rowVersion,
            reason: "Revoked from Agent Studio",
          }),
        },
      );
      if (!response.ok) throw await responseError(response);
      npRequireAgentOauthClientV1(await response.json());
      revokeRetry.current = null;
      failureRef.current = undefined;
      setFailure(undefined);
      await reload();
    } catch (caught) {
      failureRef.current = caught;
      setFailure(caught);
      onFailure(caught);
      setError(caught instanceof Error ? caught.message : "Could not revoke OAuth client.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AgentRecoveryBoundary error={failure} retry={() => void reload()}>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-[14px]">Registered public OAuth clients</CardTitle>
            <p className="mt-1 text-[12px] text-neutral-500">
              Exact redirect URIs only. Client secrets are never issued.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || busy}
            onClick={() => setOpen((value) => !value)}
          >
            <Plus className="size-3.5" /> Register client
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {disabled ? (
            <p role="status" className="text-[12px] text-neutral-500">
              OAuth client listing is unavailable until the Gateway control plane is ready.
            </p>
          ) : null}
          {loading && !disabled ? (
            <p role="status" className="min-h-12 text-[12px] text-neutral-500">
              {loaded ? "Refreshing OAuth clients…" : "Loading OAuth clients…"}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
              {error}
              <Button
                type="button"
                variant="outline"
                disabled={busy || retryBlocked}
                onClick={() => void reload()}
              >
                Reload OAuth clients
              </Button>
            </p>
          ) : null}
          {open ? (
            <form
              className="space-y-3 rounded-lg border p-3"
              onSubmit={(event) => void submit(event)}
            >
              <div className="grid gap-2">
                <Label htmlFor="oauth-name">Client name</Label>
                <Input
                  id="oauth-name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="oauth-redirects">Redirect URIs, one per line</Label>
                <Textarea
                  id="oauth-redirects"
                  required
                  value={redirects}
                  onChange={(event) => setRedirects(event.target.value)}
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-[12.5px] font-medium">Transports</legend>
                {(["agent-http", "mcp-http"] as const).map((transport) => (
                  <label
                    key={transport}
                    className="mr-4 inline-flex items-center gap-2 text-[12.5px]"
                  >
                    <input
                      type="checkbox"
                      checked={transports.includes(transport)}
                      onChange={(event) =>
                        setTransports((current) =>
                          event.target.checked
                            ? [...new Set([...current, transport])].sort()
                            : current.filter((value) => value !== transport),
                        )
                      }
                    />
                    {transport}
                  </label>
                ))}
              </fieldset>
              <Button type="submit" size="sm" disabled={busy || transports.length === 0}>
                Register public client
              </Button>
            </form>
          ) : null}
          {clients.length === 0 && !error && !loading && loaded ? (
            <Empty>No registered OAuth clients for this site.</Empty>
          ) : (
            clients.map((client) => (
              <div
                key={client.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{client.name}</p>
                  <p className="truncate font-mono text-[11px] text-neutral-500">
                    {client.clientId}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {client.transports.join(", ")} · {client.redirectUris.length.toString()}{" "}
                    redirect URI(s)
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {client.redirectUris.map((redirectUri) => (
                      <li
                        key={redirectUri}
                        className="break-all font-mono text-[10.5px] text-neutral-500"
                      >
                        {redirectUri}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={stateTone(client.status)}>{client.status}</Badge>
                  {client.status === "active" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void revoke(client)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AgentRecoveryBoundary>
  );
}

function PrincipalCreateForm({
  disabled,
  onCreated,
  onFailure,
}: {
  disabled: boolean;
  onCreated: () => Promise<void>;
  onFailure: (failure: unknown) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [scopes, setScopes] = React.useState<NpAgentScope[]>(["site:read"]);
  const [error, setError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<unknown>();
  const retryBlocked = useAgentRetryBlocked(failure);
  const retry = React.useRef<{ fingerprint: string; key: string } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || submitting || retryBlocked) return;
    setSubmitting(true);
    setError(null);
    try {
      const fingerprint = JSON.stringify({
        name,
        description: description || null,
        scopes: [...scopes].sort(),
      });
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, key: crypto.randomUUID() };
      const response = await npFetch("/api/admin/agents/gateway/principals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: retry.current.key,
          name,
          description: description || null,
          scopes: [...scopes].sort(),
        }),
      });
      if (!response.ok) throw await responseError(response);
      npRequireAgentPrincipalV1(await response.json());
      retry.current = null;
      setFailure(undefined);
      setName("");
      setDescription("");
      setScopes(["site:read"]);
      setOpen(false);
      await onCreated();
    } catch (caught) {
      setFailure(caught);
      onFailure(caught);
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
    <AgentRecoveryBoundary error={failure}>
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
    </AgentRecoveryBoundary>
  );
}
