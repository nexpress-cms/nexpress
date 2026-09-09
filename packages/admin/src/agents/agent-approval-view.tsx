"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  npRequireAgentApprovalPageV1,
  npRequireAgentApprovalDetailV1,
  npRequireAgentApprovalQueryV1,
  npRequireAgentApprovalChallengeOutputV1,
  npRequireAgentPreviewDetailWireV1,
  type NpAgentApprovalDetailV1,
  type NpAgentApprovalListItemV1,
  type NpAgentApprovalDecisionPurposeV1,
  type NpAgentApprovalChallengeOutputV1,
  type NpAgentChangeSetReviewV1,
  type NpAgentPreviewDetailWireV1,
} from "@nexpress/core/agent-contract";
import { npFetch } from "../lib/api-client.js";
import { AgentStudioApiError, responseError } from "./agent-studio-api.js";
import {
  AgentChangeSetReviewFacts,
  AgentChangeSetPreview,
  useAgentReviewRead,
} from "./agent-changeset-view.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { Badge } from "../ui/badge.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";

const base = "/api/admin/agents/approvals";
const labels = { approve: "Approve", reject: "Reject", revoke: "Revoke" } as const;
function approvalError(error: unknown) {
  if (error instanceof AgentStudioApiError) {
    if (error.code === "RECENT_REAUTHENTICATION_REQUIRED")
      return "Recent staff-primary reauthentication is required. Reauthenticate and reload.";
    if (error.status === 409)
      return "Approval facts changed. Review the refreshed facts and start a new decision.";
    if ([401, 403, 404].includes(error.status))
      return "Approvals are unavailable or you no longer have access.";
  }
  return "The approval response could not be loaded or validated.";
}
function Time({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}
function Target({ item }: { item: NpAgentApprovalListItemV1 }) {
  return item.target.kind === "action" ? (
    <span>Action {item.target.actionId}</span>
  ) : (
    <Link className="underline" href={`/admin/agents/changesets/${item.target.changeSetId}`}>
      ChangeSet {item.target.changeSetId}
    </Link>
  );
}
const filterOptions = {
  state: ["pending", "approved", "rejected", "expired", "consumed", "revoked", "all"],
  risk: ["reversible", "sensitive", "destructive"],
  targetKind: ["changeset", "changeset_rollback", "action"],
  requesterKind: ["staff", "principal"],
} as const;
const filterLabels: Record<string, string> = {
  state: "State",
  risk: "Risk",
  targetKind: "Target kind",
  requesterKind: "Requester kind",
  requesterId: "Requester ID",
  requiredHumanCapability: "Required staff capability",
  createdAfter: "Created after (UTC)",
  createdBefore: "Created before (UTC)",
  expiresAfter: "Expires after (UTC)",
  expiresBefore: "Expires before (UTC)",
  limit: "Page size",
};
export function AgentApprovalListView({ queryString = "" }: { queryString?: string }) {
  const router = useRouter();
  const result = useAgentReviewRead(
    `${base}${queryString ? `?${queryString}` : ""}`,
    npRequireAgentApprovalPageV1,
    approvalError,
  );
  const [filterError, setFilterError] = React.useState<string | null>(null);
  const query = new URLSearchParams(queryString);
  function filter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const decoded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values))
      if (typeof value === "string" && value)
        decoded[key] =
          key === "limit" ? Number(value) : key === "state" && value === "all" ? null : value;
    try {
      npRequireAgentApprovalQueryV1(decoded);
    } catch {
      setFilterError(
        "Use valid filters and canonical UTC dates, for example 2026-09-09T00:00:00.000Z.",
      );
      return;
    }
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (typeof value === "string" && value) next.set(key, value);
    setFilterError(null);
    router.push(`/admin/agents/approvals?${next}`);
  }
  const next = new URLSearchParams(queryString);
  if (result.value?.nextCursor) next.set("cursor", result.value.nextCursor);
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold">Agent Approvals</h1>
      <p>
        Current-site human decisions, ordered by soonest expiry, highest risk, then approval ID.
      </p>
      <form
        key={queryString}
        onSubmit={filter}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {Object.entries(filterOptions).map(([key, options]) => (
          <div key={key}>
            <Label htmlFor={`approval-filter-${key}`}>{filterLabels[key]}</Label>
            <select
              className="block w-full rounded border p-2"
              id={`approval-filter-${key}`}
              name={key}
              defaultValue={query.get(key) ?? (key === "state" ? "pending" : "")}
            >
              {key !== "state" && <option value="">Any</option>}
              {options.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
        ))}
        {[
          "requesterId",
          "requiredHumanCapability",
          "createdAfter",
          "createdBefore",
          "expiresAfter",
          "expiresBefore",
          "limit",
        ].map((key) => (
          <div key={key}>
            <Label htmlFor={`approval-filter-${key}`}>{filterLabels[key]}</Label>
            <Input
              id={`approval-filter-${key}`}
              name={key}
              defaultValue={query.get(key) ?? (key === "limit" ? "25" : "")}
              type={key === "limit" ? "number" : "text"}
              min={key === "limit" ? 1 : undefined}
              max={key === "limit" ? 100 : undefined}
              maxLength={key === "requesterId" ? 36 : 128}
            />
          </div>
        ))}
        <Button type="submit">Apply filters</Button>
      </form>
      {filterError && <p role="alert">{filterError}</p>}
      <Button variant="outline" onClick={result.refresh}>
        Refresh
      </Button>
      {result.loading && <p role="status">Loading approvals…</p>}
      {result.error && <p role="status">{result.error}</p>}
      {result.value && result.value.items.length === 0 && (
        <p>
          {!result.value.nextCursor &&
          !query.has("cursor") &&
          [...query.keys()].every((key) => key === "state" || key === "limit") &&
          (query.get("state") ?? "pending") === "pending"
            ? "Nothing is waiting for your decision"
            : "No authorized approvals on this page match these filters."}
        </p>
      )}
      {result.value?.items.map((item) => (
        <article className="space-y-2 rounded border p-4" key={item.approval.id}>
          <h2 className="font-semibold">
            <Link className="underline" href={`/admin/agents/approvals/${item.approval.id}`}>
              Approval request · {item.intendedOperation ?? item.target.kind}
            </Link>
          </h2>
          <p>
            <Badge>{item.approval.state}</Badge> · Risk: {item.risk} · {item.target.kind}
          </p>
          <p>
            <Target item={item} />
          </p>
          <p>
            Requester: {item.requester.kind} · {item.requester.id ?? "Redacted"}
          </p>
          <p>
            Required staff capabilities:{" "}
            {item.approval.requiredHumanCapabilities.join(", ") || "None"}
          </p>
          <p>
            Requested <Time value={item.approval.requestedAt} /> · Expires{" "}
            <Time value={item.approval.expiresAt} />
          </p>
          <p>
            Operations: {item.reviewSummary.operationCount} · Targets:{" "}
            {item.reviewSummary.targetCount}
          </p>
          <p>
            Recorded preview state: {item.reviewSummary.previewState ?? "No preview recorded"}. This
            metadata does not verify live preview availability.
          </p>
          <p>
            Recorded check count: {item.reviewSummary.checksRun ?? "Unavailable"}. A count does not
            indicate passing checks.
          </p>
          <p>Rollback plan: {item.reviewSummary.rollbackPlan}.</p>
        </article>
      ))}
      {result.value?.nextCursor && (
        <Link className="underline" href={`/admin/agents/approvals?${next}`}>
          Next page
        </Link>
      )}
    </div>
  );
}

function ApprovalPreview({
  review,
  onLost,
}: {
  review: NpAgentChangeSetReviewV1;
  onLost: () => void;
}) {
  const changeSet = review.changeSet;
  const [preview, setPreview] = React.useState<NpAgentPreviewDetailWireV1 | null>(null);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    if (!changeSet.preview) return;
    const controller = new AbortController();
    void npFetch(
      `/api/admin/agents/changesets/${encodeURIComponent(changeSet.id)}/previews/${encodeURIComponent(changeSet.preview.previewId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw await responseError(response);
        const value = npRequireAgentPreviewDetailWireV1(await response.json(), changeSet.siteId);
        if (
          value.changeSetId !== changeSet.id ||
          value.planHash !== changeSet.planHash ||
          value.previewId !== changeSet.preview?.previewId
        )
          throw new Error("Preview mismatch");
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          onLost();
        }
      });
    return () => controller.abort();
  }, [changeSet, onLost]);
  if (!changeSet.preview)
    return (
      <p>
        No preview evidence is recorded. The server determines whether a fresh preview is required.
      </p>
    );
  if (error)
    return <p role="alert">Preview evidence is unavailable. Reload current approval facts.</p>;
  return preview ? (
    <AgentChangeSetPreview changeSet={changeSet} preview={preview} onLost={onLost} />
  ) : (
    <p role="status">Loading preview evidence…</p>
  );
}

function DecisionControls({
  detail,
  onChanged,
  onLost,
}: {
  detail: NpAgentApprovalDetailV1;
  onChanged: () => void;
  onLost: () => void;
}) {
  const item = detail.item;
  const [pending, setPending] = React.useState<{
    purpose: NpAgentApprovalDecisionPurposeV1;
    idempotencyKey: string;
  } | null>(null);
  const [challenge, setChallenge] = React.useState<NpAgentApprovalChallengeOutputV1 | null>(null);
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [submittedReason, setSubmittedReason] = React.useState<string | null | undefined>(
    undefined,
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [clock, setClock] = React.useState(0);
  React.useEffect(() => {
    if (!challenge) return;
    const tick = () => setClock(Date.now());
    const firstTick = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(firstTick);
      clearInterval(interval);
    };
  }, [challenge]);
  function close() {
    setPending(null);
    setChallenge(null);
    setTyped("");
    setReason("");
    setSubmittedReason(undefined);
  }
  function failed(caught: unknown, preserveDecision = false) {
    if (preserveDecision && (!(caught instanceof AgentStudioApiError) || caught.status >= 500)) {
      setError(
        "The decision response is uncertain. Retry this exact decision or close and reload its current state.",
      );
      return;
    }
    close();
    setError(approvalError(caught));
    if (caught instanceof AgentStudioApiError && caught.status === 409) onChanged();
    else if (caught instanceof AgentStudioApiError && [401, 403, 404].includes(caught.status))
      onLost();
  }
  async function start(purpose: NpAgentApprovalDecisionPurposeV1) {
    setBusy(true);
    setError(null);
    setChallenge(null);
    setTyped("");
    setReason("");
    setSubmittedReason(undefined);
    try {
      const response = await npFetch(`${base}/${item.approval.id}/decision-challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "np.agent-approval-challenge-request.v1",
          purpose,
          expectedApprovalVersion: item.version,
          statementHash: item.statementHash,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw await responseError(response);
      const value = npRequireAgentApprovalChallengeOutputV1(await response.json());
      if (value.approvalId !== item.approval.id || value.purpose !== purpose)
        throw new Error("Challenge mismatch");
      setPending({ purpose, idempotencyKey: crypto.randomUUID() });
      setChallenge(value);
    } catch (caught) {
      failed(caught);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !pending ||
      !challenge ||
      typed !== challenge.challenge ||
      Date.now() >= Date.parse(challenge.expiresAt)
    )
      return;
    setBusy(true);
    setError(null);
    const exactReason = submittedReason === undefined ? reason.trim() || null : submittedReason;
    setSubmittedReason(exactReason);
    try {
      const response = await npFetch(`${base}/${item.approval.id}/${pending.purpose}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "np.agent-approval-decision-input.v1",
          expectedApprovalVersion: challenge.approvalVersion,
          statementHash: item.statementHash,
          challengeGeneration: challenge.challengeGeneration,
          challenge: typed,
          idempotencyKey: pending.idempotencyKey,
          reason: exactReason,
        }),
      });
      if (!response.ok) throw await responseError(response);
      const result = npRequireAgentApprovalDetailV1(await response.json());
      if (result.item.approval.id !== item.approval.id) throw new Error("Decision mismatch");
      close();
      onChanged();
    } catch (caught) {
      failed(caught, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="Approval decision">
      {error && <p role="alert">{error}</p>}
      {!item.allowedDecisions.length && (
        <p>No decisions are currently available to this staff session.</p>
      )}
      <div className="flex gap-3">
        {item.allowedDecisions.map((purpose) => (
          <Button
            disabled={busy}
            key={purpose}
            variant={purpose === "approve" ? "default" : "outline"}
            onClick={() => {
              void start(purpose);
            }}
          >
            {labels[purpose]}
          </Button>
        ))}
      </div>
      <Dialog
        open={!!challenge}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? labels[pending.purpose] : "Decision"} approval</DialogTitle>
            <DialogDescription>
              Confirm the exact server statement. This decision does not execute content changes.
            </DialogDescription>
          </DialogHeader>
          {pending && challenge && (
            <form
              onSubmit={(event) => {
                void submit(event);
              }}
              className="space-y-3"
            >
              {error && <p role="alert">{error}</p>}
              <p className="break-all text-xs">Statement: {item.statementHash}</p>
              <p>
                Expires <Time value={challenge.expiresAt} />
              </p>
              {pending.purpose === "approve" && challenge.reauthentication.mode === "recent" && (
                <p>
                  Requires staff-primary reauthentication within{" "}
                  {challenge.reauthentication.maxAgeSeconds} seconds in this session.
                </p>
              )}
              <Label htmlFor="approval-challenge">Type this one-time confirmation value</Label>
              <code className="block break-all select-text">{challenge.challenge}</code>
              <Input
                id="approval-challenge"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                maxLength={43}
                onChange={(event) => setTyped(event.target.value)}
                disabled={busy}
              />
              <Label htmlFor="approval-reason">Human reason (optional)</Label>
              <Textarea
                id="approval-reason"
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy || submittedReason !== undefined}
              />
              {clock >= Date.parse(challenge.expiresAt) && (
                <p role="alert">This challenge expired. Close and start a new decision.</p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    typed !== challenge.challenge ||
                    clock >= Date.parse(challenge.expiresAt)
                  }
                >
                  Confirm {pending.purpose}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function AgentApprovalDetailView({ id }: { id: string }) {
  const parse = React.useCallback(
    (value: unknown) => {
      const detail = npRequireAgentApprovalDetailV1(value);
      if (detail.item.approval.id !== id) throw new Error("Approval identity mismatch");
      return detail;
    },
    [id],
  );
  const result = useAgentReviewRead(`${base}/${encodeURIComponent(id)}`, parse, approvalError);
  const [notice, setNotice] = React.useState<string | null>(null);
  const clear = result.clear;
  const onLost = React.useCallback(() => {
    clear();
    setNotice("Approval evidence is unavailable. Reload to check current authority.");
  }, [clear]);
  const detail = result.value;
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold">Approval review</h1>
      <Link className="underline" href="/admin/agents/approvals">
        Back to approvals
      </Link>
      <Button
        className="ml-3"
        variant="outline"
        onClick={() => {
          setNotice(null);
          result.refresh();
        }}
      >
        Refresh
      </Button>
      {result.loading && <p role="status">Loading approval…</p>}
      {result.error && <p role="alert">{result.error}</p>}
      {notice && <p role="alert">{notice}</p>}
      {detail && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Server approval facts</h2>
            <p>
              <Badge>{detail.item.approval.state}</Badge> · Risk: {detail.item.risk}
            </p>
            <dl className="grid gap-2 text-sm">
              <dt>Approval</dt>
              <dd>
                {detail.item.approval.id} · Version {detail.item.version} · Generation{" "}
                {detail.item.approval.generation}
              </dd>
              <dt>Target</dt>
              <dd>
                <Target item={detail.item} />
              </dd>
              <dt>Intended operation</dt>
              <dd>
                {detail.item.intendedOperation ?? detail.item.target.kind}
                {detail.item.scheduledFor && (
                  <>
                    {" "}
                    · <Time value={detail.item.scheduledFor} />
                  </>
                )}
              </dd>
              <dt>Statement hash</dt>
              <dd className="break-all">{detail.item.statementHash}</dd>
              <dt>Capability and scopes</dt>
              <dd>
                {detail.item.capabilityId} · {detail.item.requiredScopes.join(", ")}
              </dd>
              <dt>Capability contract</dt>
              <dd className="break-all">
                Version {detail.item.capabilityContractVersion} ·{" "}
                {detail.item.capabilityFingerprint}
              </dd>
              <dt>Bound policy hashes</dt>
              <dd className="break-all">
                {detail.item.policyHashes.join(", ") || "No additional policy hashes"}
              </dd>
              <dt>Live preview requirement</dt>
              <dd>
                {detail.item.requiresLivePreview
                  ? "Fresh bound preview required"
                  : "Not required by this statement"}
              </dd>
              <dt>Approve reauthentication</dt>
              <dd>
                {detail.item.reauthentication.mode === "recent"
                  ? `Staff-primary within ${detail.item.reauthentication.maxAgeSeconds} seconds`
                  : "No additional recent reauthentication required"}
              </dd>
              <dt>Required human capabilities</dt>
              <dd>{detail.item.approval.requiredHumanCapabilities.join(", ") || "None"}</dd>
              <dt>Additional human requirements</dt>
              <dd>{detail.item.approval.requiredHumanPredicates.join(", ") || "None"}</dd>
              <dt>Requester</dt>
              <dd>
                {detail.item.requester.kind} · {detail.item.requester.id ?? "Redacted"}
              </dd>
              <dt>Approval expires</dt>
              <dd>
                <Time value={detail.item.approval.expiresAt} />
              </dd>
            </dl>
            <p>
              Approval records a human decision. Apply, schedule execution and rollback are not
              available here.
            </p>
          </section>
          {detail.review ? (
            <>
              <AgentChangeSetReviewFacts review={detail.review} />
              <section className="space-y-2">
                <h2 className="text-lg font-semibold">Validation and preview</h2>
                <p>
                  Validation: {detail.review.changeSet.validation?.state ?? "Unavailable"} ·
                  Generation {detail.review.changeSet.validation?.generation ?? "Unavailable"}
                </p>
                <p>Operation count: {detail.review.changeSet.operations.length}</p>
                <p>
                  Rollback plan:{" "}
                  {detail.review.changeSet.rollback
                    ? "Recorded; review required"
                    : "No rollback plan recorded"}
                </p>
                <ApprovalPreview
                  key={`${id}:${detail.item.version}:${detail.review.changeSet.preview?.previewId ?? "none"}`}
                  review={detail.review}
                  onLost={onLost}
                />
              </section>
            </>
          ) : (
            <p>
              Target evidence is redacted or unavailable. No runtime or execution evidence is
              inferred.
            </p>
          )}
          <DecisionControls
            key={`${id}:${detail.item.version}:${detail.item.statementHash}`}
            detail={detail}
            onChanged={result.refresh}
            onLost={onLost}
          />
        </>
      )}
    </div>
  );
}
