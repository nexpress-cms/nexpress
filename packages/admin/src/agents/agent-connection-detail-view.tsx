"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  npRequireAgentConnectionV1,
  type NpAgentConnectionV1,
} from "@nexpress/core/agent-contract";

import { AgentStudioFrame } from "./agent-studio-frame.js";
import { AgentStudioApiError, responseError } from "./agent-studio-api.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { npFetch } from "../lib/api-client.js";

export function AgentConnectionDetailView({ connectionId }: { connectionId: string }) {
  return <AgentConnectionDetailViewContent key={connectionId} connectionId={connectionId} />;
}

function AgentConnectionDetailViewContent({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [connection, setConnection] = React.useState<NpAgentConnectionV1 | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [loading, setLoading] = React.useState(true);
  const [receivedAt, setReceivedAt] = React.useState<string | null>(null);
  const [revision, requestReload] = React.useReducer((value: number) => value + 1, 0);
  const alertRef = React.useRef<HTMLParagraphElement>(null);
  const current = React.useRef(0);
  const retry = React.useRef<{ id: string; version: number; key: string } | null>(null);

  React.useEffect(() => {
    const generation = ++current.current;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await npFetch(
          `/api/admin/agents/connections/${encodeURIComponent(connectionId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw await responseError(response);
        const value = npRequireAgentConnectionV1(await response.json());
        if (value.id !== connectionId) throw new Error("Connection mismatch");
        if (current.current !== generation) return;
        setConnection(value);
        setReceivedAt(new Date().toISOString());
      } catch (caught) {
        if (current.current !== generation) return;
        setConnection(null);
        setReceivedAt(null);
        setError(connectionError(caught));
      } finally {
        if (current.current === generation) setLoading(false);
      }
    })();
    return () => {
      current.current = generation + 1;
      controller.abort();
    };
  }, [connectionId, revision]);
  React.useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);
  const reload = () => {
    setLoading(true);
    setError(null);
    requestReload();
  };

  const visible = connection?.id === connectionId ? connection : null;
  const revoke = async () => {
    if (
      !visible ||
      loading ||
      submitting ||
      error ||
      !window.confirm(`Revoke ${visible.name}? This is terminal.`)
    )
      return;
    const generation = current.current;
    setSubmitting(true);
    setError(null);
    if (retry.current?.id !== visible.id || retry.current.version !== visible.configVersion) {
      retry.current = { id: visible.id, version: visible.configVersion, key: crypto.randomUUID() };
    }
    try {
      const response = await npFetch(
        `/api/admin/agents/connections/${encodeURIComponent(visible.id)}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: retry.current.key,
            expectedVersion: visible.configVersion,
            reason: "Revoked in Agent Studio",
          }),
        },
      );
      if (!response.ok) throw await responseError(response);
      const value = npRequireAgentConnectionV1(await response.json());
      if (value.id !== visible.id) throw new Error("Connection mismatch");
      if (current.current !== generation) return;
      setConnection(value);
      setReceivedAt(new Date().toISOString());
      retry.current = null;
    } catch (caught) {
      if (current.current !== generation) return;
      // Re-read authority before further actions; never retain rejected response evidence.
      setConnection(null);
      setReceivedAt(null);
      if (caught instanceof AgentStudioApiError && [401, 403, 404, 409].includes(caught.status)) {
        retry.current = null;
      }
      setError(connectionError(caught));
    } finally {
      if (current.current === generation) setSubmitting(false);
    }
  };

  return (
    <AgentStudioFrame
      active="connections"
      busy={loading}
      refreshing={visible !== null}
      observedAt={receivedAt ? Date.parse(receivedAt) : undefined}
    >
      {error ? (
        <p
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] text-red-900"
        >
          {error}
        </p>
      ) : null}
      {error ? (
        <Button type="button" variant="outline" disabled={loading} onClick={reload}>
          Reload connection
        </Button>
      ) : null}
      {visible ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="break-all text-[18px] font-semibold">{visible.name}</h2>
                <Badge
                  variant={
                    visible.status === "ready"
                      ? "brand"
                      : visible.status === "revoked" || visible.status === "error"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {visible.status}
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-neutral-500">
                {visible.provider} · {visible.kind} · {visible.authKind}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || submitting}
                onClick={reload}
              >
                Refresh
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={loading || submitting || error !== null || visible.status === "revoked"}
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
                  <span className="text-neutral-500">Adapter:</span> {visible.adapterId} v
                  {visible.adapterContractVersion}
                </p>
                <p className="break-all">
                  <span className="text-neutral-500">Fingerprint:</span>{" "}
                  {visible.adapterFingerprint}
                </p>
                <p>
                  <span className="text-neutral-500">Config version:</span> {visible.configVersion}
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
                  {visible.credential.state === "stored"
                    ? `stored v${visible.credential.version.toString()}`
                    : "absent"}
                </p>
                <p>Verification: {visible.verification?.verifiedAt ?? "not verified"}</p>
                <p>Error: {visible.lastErrorCode ?? "none"}</p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Safe provider configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-72 overflow-auto rounded-lg bg-neutral-950 p-3 text-[12px] text-neutral-100">
                {JSON.stringify(visible.safeConfig, null, 2)}
              </pre>
            </CardContent>
          </Card>
          {visible.authKind === "oauth" && visible.status === "pending" ? (
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
      ) : null}
    </AgentStudioFrame>
  );
}

function connectionError(error: unknown): string {
  if (error instanceof AgentStudioApiError) {
    if ([401, 403, 404].includes(error.status))
      return "This connection is unavailable or you no longer have access. Sign in again if your session expired.";
    if (error.status === 409)
      return "The connection changed. Reload and review the current version before continuing.";
    return `Connection request failed. Safe code: ${error.code}. Reload to check current facts before retrying.`;
  }
  return "The connection response could not be loaded or validated. Reload to check current facts before retrying.";
}
