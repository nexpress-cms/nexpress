"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  npAgentGatewayExposureRank,
  npRequireAgentPrincipalV1,
  npRequireAgentServiceTokenV1,
  npRequireAgentStudioOneTimeTokenV1,
  npRequireAgentStudioPrincipalDetailV1,
  type NpAgentEnabledGatewayExposureMode,
  type NpAgentGatewayExposureMode,
  type NpAgentGatewaySettingsV1,
  type NpAgentScope,
  type NpAgentServiceTokenTransportV1,
  type NpAgentStudioOneTimeTokenV1,
  type NpAgentStudioPrincipalDetailV1,
} from "@nexpress/core/agent-contract";
import { Copy, KeyRound } from "lucide-react";

import { AgentStudioFrame } from "./agent-studio-frame.js";
import { loadAgentStudioOverview, responseError } from "./agent-studio-api.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { npFetch } from "../lib/api-client.js";

function defaultExpiry(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  return date.toISOString().slice(0, 16);
}

const TRANSPORTS = [
  { value: "stdio", setting: "stdio", label: "Local stdio" },
  { value: "mcp-http", setting: "mcpHttp", label: "MCP on existing HTTP origin" },
  { value: "agent-http", setting: "agentHttp", label: "Agent API on existing HTTP origin" },
] as const;

const EXPOSURES: NpAgentEnabledGatewayExposureMode[] = ["read", "propose", "approved-execute"];

function boundExposure(
  current: NpAgentEnabledGatewayExposureMode,
  ceiling: NpAgentGatewayExposureMode,
): NpAgentEnabledGatewayExposureMode {
  if (ceiling === "disabled") return "read";
  return npAgentGatewayExposureRank[current] <= npAgentGatewayExposureRank[ceiling]
    ? current
    : ceiling;
}

export function AgentPrincipalDetailView({ principalId }: { principalId: string }) {
  const router = useRouter();
  const [detail, setDetail] = React.useState<NpAgentStudioPrincipalDetailV1 | null>(null);
  const [gatewaySettings, setGatewaySettings] = React.useState<NpAgentGatewaySettingsV1 | null>(
    null,
  );
  const [oneTime, setOneTime] = React.useState<NpAgentStudioOneTimeTokenV1 | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [tokenName, setTokenName] = React.useState("Local client");
  const [transport, setTransport] = React.useState<NpAgentServiceTokenTransportV1>("stdio");
  const [exposure, setExposure] = React.useState<NpAgentEnabledGatewayExposureMode>("read");
  const [expiresAt, setExpiresAt] = React.useState(defaultExpiry);
  const [scopes, setScopes] = React.useState<NpAgentScope[]>(["site:read"]);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [response, overview] = await Promise.all([
        npFetch(`/api/admin/agents/gateway/principals/${encodeURIComponent(principalId)}`, {
          cache: "no-store",
        }),
        loadAgentStudioOverview(),
      ]);
      if (!response.ok) throw await responseError(response);
      const value = npRequireAgentStudioPrincipalDetailV1(await response.json());
      setDetail(value);
      setGatewaySettings(overview.gatewaySettings);
      const enabled = TRANSPORTS.filter(
        (candidate) => overview.gatewaySettings[candidate.setting] !== "disabled",
      );
      const selected = enabled[0] ?? null;
      setTransport(selected?.value ?? "stdio");
      setExposure(
        selected ? boundExposure("read", overview.gatewaySettings[selected.setting]) : "read",
      );
      setScopes((current) =>
        current.filter((scope) => value.principal.scopes.includes(scope)).length > 0
          ? current.filter((scope) => value.principal.scopes.includes(scope))
          : ["site:read"],
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load principal.");
    }
  }, [principalId]);

  const enabledTransports = gatewaySettings
    ? TRANSPORTS.filter((candidate) => gatewaySettings[candidate.setting] !== "disabled")
    : [];
  const selectedTransport = TRANSPORTS.find((candidate) => candidate.value === transport);
  const selectedCeiling =
    gatewaySettings && selectedTransport ? gatewaySettings[selectedTransport.setting] : "disabled";
  const enabledExposures = EXPOSURES.filter(
    (candidate) =>
      npAgentGatewayExposureRank[candidate] <= npAgentGatewayExposureRank[selectedCeiling],
  );
  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const createToken = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    setOneTime(null);
    try {
      const response = await npFetch(
        `/api/admin/agents/gateway/principals/${encodeURIComponent(principalId)}/tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            expectedVersion: detail.principal.rowVersion,
            name: tokenName,
            scopes: [...scopes].sort(),
            transport,
            exposure,
            expiresAt: new Date(expiresAt).toISOString(),
          }),
        },
      );
      if (!response.ok) throw await responseError(response);
      setOneTime(npRequireAgentStudioOneTimeTokenV1(await response.json()));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create token.");
    } finally {
      setSubmitting(false);
    }
  };

  const revokePrincipal = async () => {
    if (!detail || !window.confirm(`Revoke ${detail.principal.name} and all live tokens?`)) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await npFetch(
        `/api/admin/agents/gateway/principals/${encodeURIComponent(principalId)}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            expectedVersion: detail.principal.rowVersion,
            reason: "Revoked in Agent Studio",
          }),
        },
      );
      if (!response.ok) throw await responseError(response);
      const principal = npRequireAgentPrincipalV1(await response.json());
      setDetail({ ...detail, principal });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke principal.");
    } finally {
      setSubmitting(false);
    }
  };

  const revokeToken = async (tokenId: string, expectedVersion: number) => {
    if (!window.confirm("Revoke this service token?")) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await npFetch(
        `/api/admin/agents/gateway/principals/${encodeURIComponent(principalId)}/tokens/${encodeURIComponent(tokenId)}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            expectedVersion,
            reason: "Revoked in Agent Studio",
          }),
        },
      );
      if (!response.ok) throw await responseError(response);
      npRequireAgentServiceTokenV1(await response.json());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke token.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AgentStudioFrame active="connections">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] text-red-900"
        >
          {error}
        </p>
      ) : null}
      {detail ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[18px] font-semibold">{detail.principal.name}</h2>
                <Badge variant={detail.principal.status === "active" ? "brand" : "destructive"}>
                  {detail.principal.status}
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-neutral-500">
                {detail.principal.description || "External Gateway principal"}
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={submitting || detail.principal.status === "revoked"}
              onClick={() => void revokePrincipal()}
            >
              Revoke principal
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Authority ceiling</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {detail.principal.scopes.map((scope) => (
                <Badge key={scope} variant="outline">
                  {scope}
                </Badge>
              ))}
            </CardContent>
          </Card>
          {oneTime ? (
            <Card className="border-amber-300 dark:border-amber-900">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[14px]">
                  <KeyRound className="size-4" />
                  Copy this token now
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[12.5px] text-neutral-600 dark:text-neutral-300">
                  It will not be shown again. Losing it requires a new rotation generation.
                </p>
                <div className="flex min-w-0 gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-neutral-950 px-3 py-2 text-[12px] text-neutral-100">
                    {oneTime.value}
                  </code>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label="Copy token"
                    onClick={() => void navigator.clipboard.writeText(oneTime.value)}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOneTime(null)}>
                  I saved it
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {detail.principal.status === "active" && enabledTransports.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-[14px]">Create expiring service token</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={(event) => void createToken(event)}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="token-name">Name</Label>
                      <Input
                        id="token-name"
                        required
                        maxLength={120}
                        value={tokenName}
                        onChange={(e) => setTokenName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="token-expiry">Expires</Label>
                      <Input
                        id="token-expiry"
                        type="datetime-local"
                        required
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="token-transport">Transport</Label>
                      <select
                        id="token-transport"
                        className="h-10 rounded-lg border border-neutral-200 bg-transparent px-3 text-[13px] sm:h-8 dark:border-neutral-800"
                        value={transport}
                        onChange={(e) => {
                          const next = e.target.value as NpAgentServiceTokenTransportV1;
                          const candidate = TRANSPORTS.find((entry) => entry.value === next);
                          setTransport(next);
                          if (gatewaySettings && candidate) {
                            setExposure((current) =>
                              boundExposure(current, gatewaySettings[candidate.setting]),
                            );
                          }
                        }}
                      >
                        {enabledTransports.map((candidate) => (
                          <option key={candidate.value} value={candidate.value}>
                            {candidate.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="token-exposure">Exposure</Label>
                      <select
                        id="token-exposure"
                        className="h-10 rounded-lg border border-neutral-200 bg-transparent px-3 text-[13px] sm:h-8 dark:border-neutral-800"
                        value={exposure}
                        onChange={(e) =>
                          setExposure(e.target.value as NpAgentEnabledGatewayExposureMode)
                        }
                      >
                        {enabledExposures.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {candidate}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-[12.5px] font-medium">Narrow token scopes</legend>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {detail.principal.scopes.map((scope) => (
                        <label key={scope} className="flex items-center gap-2 text-[12.5px]">
                          <input
                            type="checkbox"
                            checked={scopes.includes(scope)}
                            disabled={scope === "site:read"}
                            onChange={(e) =>
                              setScopes((current) =>
                                e.target.checked
                                  ? [...current, scope].sort()
                                  : current.filter((entry) => entry !== scope),
                              )
                            }
                          />
                          {scope}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <p className="text-[12px] text-neutral-500">
                    Remote HTTP tokens require an existing canonical HTTPS site origin and never
                    open another listener or port.
                  </p>
                  <Button type="submit" size="sm" disabled={submitting}>
                    {submitting ? "Creating…" : "Create token"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : detail.principal.status === "active" ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              All Gateway transports are disabled by the effective deployment and site ceiling. No
              service token can be issued.
            </p>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Service tokens</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.tokens.length === 0 ? (
                <p className="text-[12.5px] text-neutral-500">No tokens issued.</p>
              ) : (
                <div className="space-y-2">
                  {detail.tokens.map((token) => (
                    <div
                      key={token.id}
                      className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2.5 dark:border-neutral-800"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{token.name}</p>
                        <p className="truncate text-[11.5px] text-neutral-500">
                          {token.transport} · {token.exposureMode} · expires {token.expiresAt}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={token.status === "active_head" ? "brand" : "secondary"}>
                          {token.status}
                        </Badge>
                        {token.status === "active_head" || token.status === "overlap" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={submitting}
                            onClick={() => void revokeToken(token.id, token.rowVersion)}
                          >
                            Revoke
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/admin/agents/connections")}
          >
            Back to connections
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-neutral-500">Loading Gateway principal…</p>
      )}
    </AgentStudioFrame>
  );
}
