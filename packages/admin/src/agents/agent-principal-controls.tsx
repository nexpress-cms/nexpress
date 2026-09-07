"use client";

import * as React from "react";
import {
  npGetAgentAdminOperationV1,
  npRequireAgentPrincipalV1,
  type NpAgentPrincipalV1,
} from "@nexpress/core/agent-contract";

import {
  AgentStudioApiError,
  principalAccessLostMessage,
  responseError,
} from "./agent-studio-api.js";
import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";

type PrincipalAction = "suspend" | "resume" | "revoke";
const labels = {
  suspend: "Suspend principal",
  resume: "Resume principal",
  revoke: "Revoke principal",
} as const;

export function AgentPrincipalControls({
  principal,
  disabled,
  onChanged,
  onAccessLost,
}: {
  principal: NpAgentPrincipalV1;
  disabled: boolean;
  onChanged: () => Promise<void>;
  onAccessLost: (message: string) => void;
}) {
  const [request, setRequest] = React.useState<{
    action: PrincipalAction;
    expectedVersion: number;
    idempotencyKey: string;
  } | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const open = (action: PrincipalAction) => {
    setRequest({
      action,
      expectedVersion: principal.rowVersion,
      idempotencyKey: crypto.randomUUID(),
    });
    setError(null);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const response = await npFetch(
        `/api/admin/agents/gateway/principals/${encodeURIComponent(principal.id)}/${request.action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: request.idempotencyKey,
            expectedVersion: request.expectedVersion,
            ...(request.action === "resume" ? {} : { reason: reason.trim() }),
          }),
        },
      );
      if (!response.ok) throw await responseError(response);
      npRequireAgentPrincipalV1(await response.json());
      setRequest(null);
      setReason("");
      await onChanged();
    } catch (caught) {
      if (caught instanceof AgentStudioApiError && [401, 403, 404].includes(caught.status)) {
        setRequest(null);
        onAccessLost(principalAccessLostMessage(caught));
      } else {
        setError(caught instanceof Error ? caught.message : "Could not update principal.");
        if (caught instanceof AgentStudioApiError && caught.status === 409) await onChanged();
      }
    } finally {
      setBusy(false);
    }
  };
  const requiresReauthentication = request
    ? npGetAgentAdminOperationV1(`agents.gateway.principals.${request.action}`).approval
        .reauthenticationFloor === "recent-staff-primary"
    : false;
  if (principal.kind !== "external" || principal.status === "revoked") return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => open(principal.status === "suspended" ? "resume" : "suspend")}
      >
        {principal.status === "suspended" ? labels.resume : labels.suspend}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={disabled || busy}
        onClick={() => open("revoke")}
      >
        {labels.revoke}
      </Button>
      <Dialog
        open={request !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setRequest(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{request ? labels[request.action] : "Principal access"}</DialogTitle>
            <DialogDescription>
              {request?.action === "resume"
                ? "The server will recheck current authority, scopes, and live credentials before resuming access."
                : request?.action === "revoke"
                  ? "Revoke this principal and its live credentials. Existing action history remains available."
                  : "Suspend inbound access for this principal. Existing action history remains available."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            {request?.action !== "resume" ? (
              <div className="space-y-2">
                <Label htmlFor="principal-change-reason">Reason</Label>
                <Textarea
                  id="principal-change-reason"
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setRequest((current) =>
                      current ? { ...current, idempotencyKey: crypto.randomUUID() } : null,
                    );
                  }}
                />
              </div>
            ) : null}
            <p className="text-[12px] text-neutral-500">
              {requiresReauthentication ? "Recent primary authentication is required. " : ""}
              The server rechecks permission and the current principal version before applying a
              change.
            </p>
            {error ? (
              <p role="alert" className="text-[13px] text-red-700 dark:text-red-300">
                {error}
              </p>
            ) : null}
            {request && request.expectedVersion !== principal.rowVersion ? (
              <p role="alert" className="text-[13px]">
                This principal changed. Close this dialog, review its current state, and start the
                action again.
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setRequest(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={request?.action === "revoke" ? "destructive" : "default"}
                disabled={busy || !request || request.expectedVersion !== principal.rowVersion}
              >
                {busy ? "Saving…" : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
