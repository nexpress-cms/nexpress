"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  npRequireAgentChangeSetWire,
  npRequireAgentChangeSetReviewV1,
  npRequireAgentPreviewDetailWireV1,
  npRequireAgentPreviewReportPartsV1,
  npRequireAgentContractResult,
  npAnalyzeAgentCursorPageV1,
  npAnalyzeAgentChangeSetWire,
  npAgentChangeSetLimits,
  npAgentChangeSetStates,
  npBuildAgentChangeSetDraftInputJsonV1,
  npDigestAgentChangeSetDraftInputV1,
  type NpAgentChangeSetWire,
  type NpAgentChangeSetReviewV1,
  type NpAgentPreviewDetailWireV1,
  type NpAgentChangeSetReviewValueV1,
} from "@nexpress/core/agent-contract";
import { npFetch } from "../lib/api-client.js";
import { AgentApprovalRequest } from "./agent-approval-request.js";
import { AgentStudioApiError, responseError } from "./agent-studio-api.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

const base = "/api/admin/agents/changesets";
function parsePage(value: unknown) {
  return npRequireAgentContractResult(
    npAnalyzeAgentCursorPageV1(value, {
      schemaVersion: "np.agent-changesets.v1",
      analyzeItem: npAnalyzeAgentChangeSetWire,
      itemIssueRoot: "agent.changeset.wire",
      maximumBytes: npAgentChangeSetLimits.wireBytes,
      maximumDepth: 64,
    }),
  );
}
async function read<T>(
  path: string,
  parse: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const response = await npFetch(path, { cache: "no-store", signal });
  if (!response.ok) throw await responseError(response);
  return parse(await response.json());
}
function errorMessage(error: unknown): string {
  if (error instanceof AgentStudioApiError) {
    if ([401, 403, 404].includes(error.status))
      return "This ChangeSet is unavailable or you no longer have access.";
    if (error.status === 409)
      return "The proposal changed. Reload and review the current facts before trying again.";
    if (error.code === "RECENT_REAUTHENTICATION_REQUIRED")
      return "Reauthenticate and reload before continuing.";
  }
  return "The ChangeSet response could not be loaded or validated.";
}
export function useAgentReviewRead<T>(
  path: string,
  parse: (value: unknown) => T,
  formatError: (error: unknown) => string = errorMessage,
) {
  const [revision, refresh] = React.useReducer((n: number) => n + 1, 0);
  const [stored, setStored] = React.useState<{
    path: string;
    revision: number;
    value: T | null;
    error: string | null;
  } | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void read(path, parse, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setStored({ path, revision, value, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setStored({ path, revision, value: null, error: formatError(error) });
      });
    return () => controller.abort();
  }, [path, parse, revision, formatError]);
  const clear = React.useCallback(
    () => setStored({ path, revision, value: null, error: null }),
    [path, revision],
  );
  const current = stored?.path === path && stored.revision === revision ? stored : null;
  return {
    value: current?.value ?? null,
    error: current?.error ?? null,
    loading: current === null,
    refresh,
    clear,
  };
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold">Agent ChangeSets</h1>
        <p className="text-sm text-neutral-500">
          Review proposals, validation evidence, semantic diffs and isolated previews for the
          current site.
        </p>
      </header>
      {children}
    </div>
  );
}
function Time({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}
function JsonValue({ item }: { item: NpAgentChangeSetReviewValueV1 }) {
  return item.presence === "present" ? (
    <pre className="whitespace-pre-wrap break-all text-xs">
      {JSON.stringify(item.value, null, 2)}
    </pre>
  ) : (
    <span className="text-sm text-neutral-500">
      {item.presence === "absent" ? "Absent" : "Redacted"}
    </span>
  );
}
function ProposalEditor({
  changeSet,
  onSaved,
  onLost,
}: {
  changeSet?: NpAgentChangeSetWire;
  onSaved: (value: NpAgentChangeSetWire) => void;
  onLost?: () => void;
}) {
  const initial = changeSet
    ? {
        title: changeSet.title,
        summary: changeSet.summary,
        operations: changeSet.operations.map((op) => op.operation),
      }
    : { title: "", summary: null, operations: [] };
  const [source, setSource] = React.useState(() => JSON.stringify(initial, null, 2));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const requestKey = React.useRef<{ source: string; key: string } | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const draft: unknown = JSON.parse(source);
      const proposalJson = npBuildAgentChangeSetDraftInputJsonV1(draft);
      if (requestKey.current?.source !== proposalJson)
        requestKey.current = { source: proposalJson, key: crypto.randomUUID() };
      const response = await npFetch(changeSet ? `${base}/${changeSet.id}` : base, {
        method: changeSet ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: requestKey.current.key,
          proposalJson,
          proposalHash: await npDigestAgentChangeSetDraftInputV1(draft),
          ...(changeSet ? { expectedVersion: changeSet.draftVersion } : {}),
        }),
      });
      if (!response.ok) throw await responseError(response);
      onSaved(npRequireAgentChangeSetWire(await response.json()));
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof AgentStudioApiError && [401, 403, 404, 409].includes(error.status)) {
        setSource("");
        onLost?.();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary className="cursor-pointer font-medium">
        {changeSet ? "Edit draft proposal" : "Create a draft proposal"}
      </summary>
      <p className="my-2 text-sm">
        Structured proposal JSON uses the existing ChangeSet operation contract. Saving a proposal
        does not write target content.
      </p>
      <label className="block" htmlFor="changeset-proposal">
        Proposal JSON
      </label>
      <textarea
        id="changeset-proposal"
        value={source}
        onChange={(event) => setSource(event.target.value)}
        maxLength={npAgentChangeSetLimits.adminProposalCharacters}
        rows={16}
        className="w-full rounded border bg-transparent p-3 font-mono text-xs"
        disabled={busy}
      />
      <Button
        onClick={() => {
          void save();
        }}
        disabled={busy}
      >
        {busy ? "Saving…" : "Save draft"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
export function AgentChangeSetListView({ queryString = "" }: { queryString?: string }) {
  const router = useRouter();
  const result = useAgentReviewRead(`${base}${queryString ? `?${queryString}` : ""}`, parsePage);
  const filters = new URLSearchParams(queryString);
  const nextPage = new URLSearchParams(queryString);
  nextPage.set("cursor", result.value?.nextCursor ?? "");
  function filter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const key of new Set(data.keys())) {
      const values = data
        .getAll(key)
        .filter((value): value is string => typeof value === "string" && Boolean(value));
      if (values.length)
        query.set(
          key,
          ["states", "actorKinds"].includes(key) ? values.sort().join(",") : values[0],
        );
    }
    router.push(`/admin/agents/changesets${query.size ? `?${query.toString()}` : ""}`);
  }
  return (
    <Frame>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={result.refresh}>
          Refresh
        </Button>
        <span className="text-sm">Newest first · bounded authorized history</span>
      </div>
      <form key={queryString} onSubmit={filter} className="flex flex-wrap items-end gap-3">
        <label>
          State
          <select
            name="states"
            multiple
            defaultValue={filters.get("states")?.split(",") ?? []}
            className="ml-2 rounded border bg-transparent p-2"
          >
            {npAgentChangeSetStates.map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
        </label>
        <label>
          Requester
          <select
            name="actorKinds"
            multiple
            defaultValue={filters.get("actorKinds")?.split(",") ?? []}
            className="ml-2 rounded border bg-transparent p-2"
          >
            {["external", "runtime", "staff"].map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </label>
        <label>
          Created after (UTC)
          <input
            name="createdAfter"
            placeholder="2026-09-01T00:00:00.000Z"
            defaultValue={filters.get("createdAfter") ?? ""}
            className="block rounded border bg-transparent p-2"
          />
        </label>
        <label>
          Created before (UTC)
          <input
            name="createdBefore"
            placeholder="2026-09-30T00:00:00.000Z"
            defaultValue={filters.get("createdBefore") ?? ""}
            className="block rounded border bg-transparent p-2"
          />
        </label>
        <Button type="submit">Apply filters</Button>
      </form>
      {result.loading && <p role="status">Loading ChangeSets…</p>}
      {result.error && <p role="status">ChangeSet history is unavailable. {result.error}</p>}
      {result.value && (
        <>
          <div className="space-y-3">
            {result.value.items.map((item) => (
              <Card key={item.id}>
                <CardContent className="space-y-2 p-4">
                  <Link
                    href={`/admin/agents/changesets/${item.id}`}
                    className="font-medium underline"
                  >
                    {item.title}
                  </Link>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <Badge>{item.state}</Badge>
                    <span>{item.operations.length} operations</span>
                    <span>{item.actor.name}</span>
                    <Time value={item.createdAt} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {result.value.items.length === 0 && (
            <p role="status">No authorized ChangeSets on this page.</p>
          )}
          {result.value.nextCursor && (
            <Link className="underline" href={`/admin/agents/changesets?${nextPage.toString()}`}>
              Next page
            </Link>
          )}
        </>
      )}
      <ProposalEditor onSaved={(item) => router.push(`/admin/agents/changesets/${item.id}`)} />
    </Frame>
  );
}
export function AgentChangeSetPreview({
  changeSet,
  preview,
  onLost,
}: {
  changeSet: NpAgentChangeSetWire;
  preview: NpAgentPreviewDetailWireV1;
  onLost: () => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [selectedRoute, setSelectedRoute] = React.useState(0);
  const [reports, setReports] = React.useState<ReturnType<
    typeof npRequireAgentPreviewReportPartsV1
  > | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    if (preview.state === "ready")
      void Promise.all(
        preview.artifactRefs
          .filter((a) => a.kind === "report")
          .map((artifact) =>
            read(
              `${base}/${changeSet.id}/previews/${preview.previewId}/artifacts/${artifact.artifactId}`,
              (v) => v,
              controller.signal,
            ),
          ),
      )
        .then((parts) => {
          if (!controller.signal.aborted) {
            const checked = npRequireAgentPreviewReportPartsV1(parts);
            if (
              checked.some(
                (part) =>
                  part.siteId !== changeSet.siteId ||
                  part.changeSetId !== changeSet.id ||
                  part.previewId !== preview.previewId ||
                  part.generation !== preview.generation ||
                  part.planHash !== preview.planHash ||
                  part.previewContractFingerprint !== preview.previewContractFingerprint,
              )
            )
              throw new Error("Mismatched preview report");
            setReports(checked);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setError(errorMessage(error));
            onLost();
          }
        });
    return () => controller.abort();
  }, [changeSet.id, changeSet.siteId, preview, onLost]);
  function launch() {
    const route = preview.allowedRoutes[selectedRoute];
    const csrfToken = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("np-csrf="))
      ?.slice("np-csrf=".length);
    if (!route || !csrfToken) {
      setError("Reload your staff session before opening a preview.");
      return;
    }
    const form = document.createElement("form");
    form.method = "post";
    form.action = `${base}/${changeSet.id}/previews/${preview.previewId}/launch`;
    form.target = "_blank";
    form.rel = "noopener";
    const command = {
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: changeSet.draftVersion,
      expectedPlanHash: changeSet.planHash,
      route: route.route,
    };
    for (const [name, value] of Object.entries({
      command: JSON.stringify(command),
      csrfToken: decodeURIComponent(csrfToken),
    })) {
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = name;
      field.value = value;
      form.append(field);
    }
    document.body.append(form);
    form.submit();
    form.remove();
  }

  return (
    <div className="space-y-3">
      <Badge>{preview.state}</Badge>
      <p>
        Generated <Time value={preview.createdAt} /> · Expires{" "}
        {preview.expiresAt ? <Time value={preview.expiresAt} /> : "Not set"}
      </p>
      <label className="block">
        Preview route
        <select
          className="ml-2 rounded border bg-transparent p-2"
          value={selectedRoute}
          onChange={(event) => setSelectedRoute(Number(event.target.value))}
        >
          {preview.allowedRoutes.map((route, index) => (
            <option key={`${route.route}:${route.locale ?? ""}`} value={index}>
              {route.route} {route.locale ?? ""}
            </option>
          ))}
        </select>
      </label>
      <Button
        onClick={() => {
          void launch();
        }}
        disabled={
          !preview.interactiveLaunch ||
          preview.state !== "ready" ||
          Date.parse(preview.expiresAt ?? "") <= now
        }
      >
        Open isolated preview in new window
      </Button>
      {preview.safeErrorCode && <p role="alert">Preview failed: {preview.safeErrorCode}</p>}
      <details>
        <summary>Check posture</summary>
        <pre className="whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(preview.checkSummary, null, 2)}
        </pre>
      </details>
      {preview.artifactRefs.every((artifact) => artifact.kind !== "screenshot") && (
        <p>No screenshot evidence is available.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <ul className="space-y-3">
        {preview.artifactRefs.map((artifact) => (
          <li key={artifact.artifactId}>
            <span>
              {artifact.kind} {artifact.viewport?.name ?? ""} {artifact.route ?? ""}
            </span>
            <p className="break-all text-xs">Digest: {artifact.contentDigest}</p>
            {preview.state === "ready" && artifact.kind === "screenshot" && (
              <a
                href={`${base}/${changeSet.id}/previews/${preview.previewId}/artifacts/${artifact.artifactId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open {artifact.viewport?.name ?? "preview"} screenshot ({artifact.viewport?.width} ×{" "}
                {artifact.viewport?.height})
              </a>
            )}
          </li>
        ))}
      </ul>
      {reports
        ?.flatMap((part) => part.results)
        .map((check) => (
          <div key={check.id}>
            <Badge>{check.status}</Badge> {check.checkId} {check.route?.route}
          </div>
        ))}
      {reports
        ?.flatMap((part) => part.issues)
        .map((issue) => (
          <p key={issue.id}>
            {issue.severity}: {issue.safeMessage}
          </p>
        ))}
    </div>
  );
}
export function AgentChangeSetReviewFacts({ review }: { review: NpAgentChangeSetReviewV1 }) {
  const changeSet = review.changeSet;
  return (
    <section id="proposal" className="space-y-4">
      <h2 className="text-lg font-semibold">Server facts</h2>
      <Badge>{changeSet.state}</Badge>
      <dl className="grid gap-2 text-sm">
        <dt>ChangeSet</dt>
        <dd className="break-all">{changeSet.id}</dd>
        <dt>Site</dt>
        <dd>{changeSet.siteId}</dd>
        <dt>Plan hash</dt>
        <dd className="break-all">{changeSet.planHash ?? "Not sealed"}</dd>
        <dt>Base fingerprint</dt>
        <dd className="break-all">{changeSet.baseFingerprint ?? "Not validated"}</dd>
        <dt>Required staff capabilities</dt>
        <dd>{review.requiredStaffCapabilities.join(", ")}</dd>
        <dt>Expires</dt>
        <dd>
          <Time value={changeSet.expiresAt} />
        </dd>
      </dl>
      <aside className="rounded border p-3">
        <h3 className="font-medium">Proposal text (untrusted)</h3>
        <p>{changeSet.title}</p>
        {changeSet.summary && <p className="whitespace-pre-wrap">{changeSet.summary}</p>}
      </aside>
      <h3 className="font-semibold">Semantic field diff</h3>
      {review.operations.map((operation) => (
        <Card key={operation.ordinal}>
          <CardHeader>
            <CardTitle>
              Operation {operation.ordinal}:{" "}
              {changeSet.operations[operation.ordinal - 1]?.operation.kind}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {operation.evidence !== "available" && (
              <p>Diff evidence: {operation.evidence.replaceAll("_", " ")}</p>
            )}
            {operation.fields.map((field) => (
              <div key={field.path} className="mb-4">
                <h4 className="break-all font-medium">{field.path}</h4>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded border p-3">
                    <p className="font-medium">Before</p>
                    <JsonValue item={field.before} />
                  </div>
                  <div className="rounded border p-3">
                    <p className="font-medium">After</p>
                    <JsonValue item={field.after} />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

export function AgentChangeSetDetailView({ id }: { id: string }) {
  const result = useAgentReviewRead(`${base}/${id}`, npRequireAgentChangeSetReviewV1);
  const [busy, setBusy] = React.useState(false);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<NpAgentPreviewDetailWireV1 | null>(null);
  const changeSet = result.value?.changeSet;
  const clear = result.clear;
  const clearEvidence = React.useCallback(() => {
    setPreview(null);
    clear();
  }, [clear]);
  React.useEffect(() => {
    if (!changeSet?.preview) return;
    const controller = new AbortController();
    void read(
      `${base}/${id}/previews/${changeSet.preview.previewId}`,
      (value) => npRequireAgentPreviewDetailWireV1(value, changeSet.siteId),
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMutationError(errorMessage(error));
          clear();
        }
      });
    return () => controller.abort();
  }, [changeSet, id, clear]);
  const keys = React.useRef<Record<string, string>>({});
  async function mutate(operation: "validate" | "preview") {
    if (!changeSet) return;
    setBusy(true);
    setMutationError(null);
    setPreview(null);
    const binding = `${operation}:${changeSet.draftVersion}:${changeSet.planHash ?? ""}`;
    keys.current[binding] ??= crypto.randomUUID();
    try {
      const response = await npFetch(`${base}/${id}/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: keys.current[binding],
          expectedVersion: changeSet.draftVersion,
          ...(operation === "preview" ? { expectedPlanHash: changeSet.planHash } : {}),
        }),
      });
      if (!response.ok) throw await responseError(response);
      if (operation === "preview")
        npRequireAgentPreviewDetailWireV1(await response.json(), changeSet.siteId);
      else npRequireAgentChangeSetWire(await response.json());
      result.refresh();
    } catch (error) {
      result.clear();
      setMutationError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame>
      <Link className="underline" href="/admin/agents/changesets">
        Back to ChangeSets
      </Link>
      <Button
        className="ml-3"
        variant="outline"
        onClick={() => {
          setPreview(null);
          setMutationError(null);
          result.refresh();
        }}
      >
        Refresh
      </Button>
      {result.loading && <p role="status">Loading ChangeSet…</p>}
      {result.error && <p role="alert">{result.error}</p>}
      {mutationError && <p role="alert">{mutationError}</p>}
      {result.value && changeSet && (
        <>
          <nav aria-label="ChangeSet stages" className="flex flex-wrap gap-4">
            <a href="#proposal">Proposal</a>
            <a href="#validation">Validation</a>
            <a href="#preview">Preview</a>
          </nav>
          <AgentChangeSetReviewFacts review={result.value} />
          <section id="validation" className="space-y-3">
            <h2 className="text-lg font-semibold">Validation</h2>
            <p>
              {changeSet.validation?.state ?? "Not validated"}
              {changeSet.validation ? ` · Generation ${changeSet.validation.generation}` : ""}
            </p>
            {changeSet.operations
              .flatMap((operation) => operation.issues)
              .map((issue, index) => (
                <p key={`${issue.code}:${index}`}>
                  {issue.severity}: {issue.message} · Operation {issue.operationOrdinal ?? "all"} ·{" "}
                  {issue.path}
                </p>
              ))}
            <Button
              disabled={busy || !["draft", "invalid"].includes(changeSet.state)}
              onClick={() => {
                void mutate("validate");
              }}
            >
              Validate proposal
            </Button>
          </section>
          <section id="preview" className="space-y-3">
            <h2 className="text-lg font-semibold">Preview</h2>
            <Button
              disabled={busy || changeSet.state !== "ready" || !changeSet.planHash}
              onClick={() => {
                void mutate("preview");
              }}
            >
              Generate preview
            </Button>
            {preview &&
            preview.changeSetId === changeSet.id &&
            preview.previewId === changeSet.preview?.previewId &&
            preview.planHash === changeSet.planHash ? (
              <AgentChangeSetPreview
                key={`${preview.previewId}:${preview.generation}:${preview.state}`}
                changeSet={changeSet}
                preview={preview}
                onLost={clearEvidence}
              />
            ) : (
              <p>No current preview evidence is loaded.</p>
            )}
          </section>
          {["draft", "invalid"].includes(changeSet.state) && (
            <ProposalEditor
              key={changeSet.draftVersion}
              changeSet={changeSet}
              onSaved={result.refresh}
              onLost={() => {
                setMutationError("Reload to review current authorized facts.");
                clear();
              }}
            />
          )}
          <AgentApprovalRequest
            key={`${changeSet.id}:${changeSet.draftVersion}`}
            changeSet={changeSet}
            onChanged={result.refresh}
            onLost={clearEvidence}
          />
          <p className="text-sm text-neutral-500">
            Content application and schedule execution are not available in this release.
          </p>
        </>
      )}
    </Frame>
  );
}
