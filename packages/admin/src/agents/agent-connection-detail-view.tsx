"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  npRequireAgentConnectionV1,
  type NpAgentConnectionV1,
} from "@nexpress/core/agent-contract";

import { AgentStudioFrame } from "./agent-studio-frame.js";
import { responseError } from "./agent-studio-api.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { npFetch } from "../lib/api-client.js";

export function AgentConnectionDetailView({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [connection, setConnection] = React.useState<NpAgentConnectionV1 | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const response = await npFetch(
        `/api/admin/agents/connections/${encodeURIComponent(connectionId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw await responseError(response);
      setConnection(npRequireAgentConnectionV1(await response.json()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load connection.");
    }
  }, [connectionId]);
  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const revoke = async () => {
    if (!connection || !window.confirm(`Revoke ${connection.name}? This is terminal.`)) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await npFetch(
        `/api/admin/agents/connections/${encodeURIComponent(connection.id)}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            expectedVersion: connection.configVersion,
            reason: "Revoked in Agent Studio",
          }),
        },
      );
      if (!response.ok) throw await responseError(response);
      setConnection(npRequireAgentConnectionV1(await response.json()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke connection.");
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
      {connection ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[18px] font-semibold">{connection.name}</h2>
                <Badge
                  variant={
                    connection.status === "ready"
                      ? "brand"
                      : connection.status === "revoked" || connection.status === "error"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {connection.status}
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-neutral-500">
                {connection.provider} · {connection.kind} · {connection.authKind}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Refresh
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={submitting || connection.status === "revoked"}
                onClick={() => void revoke()}
              >
                {submitting ? "Revoking…" : "Revoke"}
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-[14px]">Immutable adapter binding</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-[12.5px]">
                <p>
                  <span className="text-neutral-500">Adapter:</span> {connection.adapterId} v
                  {connection.adapterContractVersion}
                </p>
                <p className="break-all">
                  <span className="text-neutral-500">Fingerprint:</span>{" "}
                  {connection.adapterFingerprint}
                </p>
                <p>
                  <span className="text-neutral-500">Config version:</span>{" "}
                  {connection.configVersion}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-[14px]">Credential and verification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-[12.5px]">
                <p>
                  Credential:{" "}
                  {connection.credential.state === "stored"
                    ? `stored v${connection.credential.version.toString()}`
                    : "absent"}
                </p>
                <p>Verification: {connection.verification?.verifiedAt ?? "not verified"}</p>
                <p>Error: {connection.lastErrorCode ?? "none"}</p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Safe provider configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-72 overflow-auto rounded-lg bg-neutral-950 p-3 text-[12px] text-neutral-100">
                {JSON.stringify(connection.safeConfig, null, 2)}
              </pre>
            </CardContent>
          </Card>
          {connection.authKind === "oauth" && connection.status === "pending" ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-950">
              OAuth authorization has not started. The host must provide an exact client digest and
              same-origin callback before this pending connection can receive credentials.
            </p>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/admin/agents/connections")}
          >
            Back to connections
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-neutral-500">Loading connection…</p>
      )}
    </AgentStudioFrame>
  );
}
