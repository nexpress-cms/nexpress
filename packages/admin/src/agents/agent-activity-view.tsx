"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  npAgentActionStates,
  npAgentCapabilityIds,
  npAgentPrincipalStatusesV1,
  npAgentRunStates,
  npAnalyzeAgentActivityActionsPageV1,
  npAnalyzeAgentActivityPrincipalsPageV1,
  npAnalyzeAgentActivityRunsPageV1,
  npRequireAgentActivityActionDetailV1,
  npRequireAgentActivityRunDetailV1,
  npRequireAgentContractResult,
  type NpAgentActivityActionDetailV1,
  type NpAgentActivityActionsPageV1,
  type NpAgentActivityKindV1,
  type NpAgentActivityPrincipalsPageV1,
  type NpAgentActivityRunDetailV1,
  type NpAgentActivityRunsPageV1,
} from "@nexpress/core/agent-contract";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";

import { AgentStudioApiError, responseError } from "./agent-studio-api.js";
import { AgentStudioFrame } from "./agent-studio-frame.js";
import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { cn } from "../ui/utils.js";

type ActivityPage =
  NpAgentActivityRunsPageV1 | NpAgentActivityActionsPageV1 | NpAgentActivityPrincipalsPageV1;
const apiPaths = {
  runs: "/api/admin/agents/activity",
  actions: "/api/admin/agents/activity/actions",
  principals: "/api/admin/agents/gateway/principals",
} as const;

function activityHref(section: NpAgentActivityKindV1, query = ""): string {
  const params = new URLSearchParams(query);
  if (section === "principals") params.set("view", "principals");
  const suffix = params.toString();
  return `${section === "actions" ? "/admin/agents/activity/actions" : "/admin/agents/activity"}${suffix ? `?${suffix}` : ""}`;
}

function parseActionsPage(value: unknown): NpAgentActivityActionsPageV1 {
  return npRequireAgentContractResult(npAnalyzeAgentActivityActionsPageV1(value));
}

function parseActivityPage(value: unknown): ActivityPage {
  if (typeof value === "object" && value !== null && "schemaVersion" in value) {
    if (value.schemaVersion === "np.agent-activity-principals.v1")
      return npRequireAgentContractResult(npAnalyzeAgentActivityPrincipalsPageV1(value));
    if (value.schemaVersion === "np.agent-activity-actions.v1")
      return npRequireAgentContractResult(npAnalyzeAgentActivityActionsPageV1(value));
    if (value.schemaVersion === "np.agent-activity-runs.v1")
      return npRequireAgentContractResult(npAnalyzeAgentActivityRunsPageV1(value));
  }
  throw new Error("Invalid Activity page.");
}

async function readActivity<T>(
  path: string,
  parse: (value: unknown) => T,
  signal: AbortSignal,
): Promise<T> {
  const response = await npFetch(path, { cache: "no-store", signal });
  if (!response.ok) throw await responseError(response);
  try {
    return parse(await response.json());
  } catch {
    throw new AgentStudioApiError(
      "The Activity response could not be validated.",
      502,
      "ACTIVITY_CONTRACT_ERROR",
    );
  }
}

function useActivity<T>(path: string, parse: (value: unknown) => T) {
  const [result, setResult] = React.useState<{
    path: string;
    parse: (value: unknown) => T;
    value: T | null;
    error: AgentStudioApiError | null;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void readActivity(path, parse, controller.signal)
      .then((value) => {
        if (current) {
          setResult({ path, parse, value, error: null });
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (!current) return;
        setResult({
          path,
          parse,
          value: null,
          error:
            caught instanceof AgentStudioApiError
              ? caught
              : new AgentStudioApiError(
                  "Could not load Activity. Try refreshing.",
                  0,
                  "ACTIVITY_REQUEST_FAILED",
                ),
        });
        setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, parse, revision]);
  const refresh = () => {
    setLoading(true);
    setRevision((current) => current + 1);
  };
  // A route/filter change must never borrow another request's visible record or error.
  const matches = result?.path === path && result.parse === parse;
  return {
    value: matches ? result.value : null,
    error: matches && !loading ? result.error : null,
    loading: loading || !matches,
    refresh,
  };
}

function ActivityNavigation({ section }: { section: NpAgentActivityKindV1 }) {
  return (
    <nav aria-label="Activity views" className="flex gap-2 overflow-x-auto">
      {(["runs", "actions", "principals"] as const).map((item) => (
        <Link
          key={item}
          href={activityHref(item)}
          aria-current={item === section ? "page" : undefined}
          className={cn(
            "rounded-lg px-3 py-2 text-[13px] capitalize",
            item === section
              ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-950"
              : "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300",
          )}
        >
          {item.charAt(0).toUpperCase() + item.slice(1)}
        </Link>
      ))}
    </nav>
  );
}

function ActivityError({ error, retry }: { error: AgentStudioApiError; retry: () => void }) {
  const denied = [401, 403, 404].includes(error.status);
  const title =
    error.status === 401
      ? "Sign in to view Activity."
      : error.status === 403
        ? "You do not have access to this Activity."
        : error.status === 404
          ? "This Activity record is unavailable."
          : error.status === 503
            ? "Agent Activity is unavailable."
            : error.message;
  return (
    <div
      role={error.status === 503 ? "status" : "alert"}
      className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <p className="font-medium">{title}</p>
      {error.status === 503 ? (
        <p>The host Activity service is not available. No run or action history can be loaded.</p>
      ) : null}
      <p className="font-mono text-[11px]">{error.code}</p>
      {error.status === 401 ? (
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/login">Sign in</Link>
        </Button>
      ) : !denied ? (
        <Button type="button" size="sm" variant="outline" onClick={retry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

function ActivityTime({ value }: { value: string | null }) {
  return value ? (
    <time dateTime={value} title={value}>
      {new Date(value).toLocaleString()}
    </time>
  ) : (
    <span>—</span>
  );
}

function StateBadge({ state }: { state: string }) {
  return (
    <Badge
      variant={
        ["failed", "policy_blocked", "budget_blocked", "revoked"].includes(state)
          ? "destructive"
          : ["active", "succeeded"].includes(state)
            ? "brand"
            : "secondary"
      }
    >
      {state}
    </Badge>
  );
}

function EvidenceNotice({ evidence }: { evidence: "redacted" | "expired" }) {
  return (
    <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[12.5px] text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
      {evidence === "expired"
        ? "Evidence has expired. Retained identities, hashes, and safe metadata remain visible."
        : "Evidence is redacted. This view contains server-projected metadata; raw requests, content, and credentials are excluded."}
    </p>
  );
}

function EmptyActivity({ section }: { section: NpAgentActivityKindV1 }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
      <p className="text-[14px] font-medium">
        {section === "runs"
          ? "No Agent runs match these filters."
          : section === "actions"
            ? "No Agent actions match these filters."
            : "No principals match these filters."}
      </p>
      {section === "runs" ? (
        <p className="mt-2 text-[12.5px] text-neutral-500">
          Current read capabilities execute inline. Their activity appears under Actions without
          creating a run.
        </p>
      ) : null}
      <Button asChild size="sm" variant="ghost" className="mt-3">
        <Link href={activityHref(section)}>Clear filters</Link>
      </Button>
    </div>
  );
}

function localDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function ActivityFilters({
  section,
  queryString,
}: {
  section: NpAgentActivityKindV1;
  queryString: string;
}) {
  const router = useRouter();
  const query = new URLSearchParams(queryString);
  const states =
    section === "principals"
      ? npAgentPrincipalStatusesV1
      : section === "runs"
        ? npAgentRunStates
        : npAgentActionStates;
  const selectClass =
    "h-10 min-w-0 rounded-lg border border-neutral-200 bg-transparent px-2 text-[13px] sm:h-8 dark:border-neutral-800";
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [name, raw] of new FormData(event.currentTarget)) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      next.set(name, name === "from" || name === "to" ? new Date(raw).toISOString() : raw.trim());
    }
    router.push(activityHref(section, next.toString()));
  };
  return (
    <form
      aria-label="Activity filters"
      className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
      onSubmit={submit}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="activity-state">State</Label>
          <select
            id="activity-state"
            name="state"
            defaultValue={query.get("state") ?? ""}
            className={selectClass}
          >
            <option value="">All states</option>
            {states.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
        {section === "runs" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="activity-origin">Origin</Label>
            <select
              id="activity-origin"
              name="origin"
              defaultValue={query.get("origin") ?? ""}
              className={selectClass}
            >
              <option value="">All origins</option>
              <option value="gateway">Gateway</option>
              <option value="runtime">Runtime</option>
            </select>
          </div>
        ) : null}
        {section === "principals" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="activity-kind">Principal kind</Label>
            <select
              id="activity-kind"
              name="kind"
              defaultValue={query.get("kind") ?? ""}
              className={selectClass}
            >
              <option value="">All kinds</option>
              <option value="external">External</option>
              <option value="runtime">Runtime</option>
            </select>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="activity-principal">Principal ID</Label>
            <Input
              id="activity-principal"
              name="principalId"
              maxLength={36}
              defaultValue={query.get("principalId") ?? ""}
            />
          </div>
        )}
        {section === "actions" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="activity-run">Run ID</Label>
            <Input
              id="activity-run"
              name="runId"
              maxLength={36}
              defaultValue={query.get("runId") ?? ""}
            />
          </div>
        ) : null}
        {section !== "principals" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="activity-capability">Capability</Label>
            <select
              id="activity-capability"
              name="capabilityId"
              defaultValue={query.get("capabilityId") ?? ""}
              className={selectClass}
            >
              <option value="">All capabilities</option>
              {npAgentCapabilityIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="activity-from">From</Label>
          <Input
            id="activity-from"
            name="from"
            type="datetime-local"
            defaultValue={localDate(query.get("from"))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="activity-to">To</Label>
          <Input
            id="activity-to"
            name="to"
            type="datetime-local"
            defaultValue={localDate(query.get("to"))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="activity-limit">Page size</Label>
          <select
            id="activity-limit"
            name="limit"
            defaultValue={query.get("limit") ?? "25"}
            className={selectClass}
          >
            {[25, 50, 100].map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={activityHref(section)}>Clear filters</Link>
        </Button>
        <p className="text-[11.5px] text-neutral-500">
          Newest first · Dates use your local time zone
        </p>
      </div>
    </form>
  );
}

function ActionRows({ items }: { items: NpAgentActivityActionDetailV1[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Link
          key={item.action.id}
          href={`/admin/agents/activity/actions/${encodeURIComponent(item.action.id)}`}
          className="block rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14px] font-medium">{item.action.capabilityId}</span>
            <StateBadge state={item.action.state} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-500">
            <span>
              {item.action.runId ? "Run action" : "Inline invocation"} · sequence{" "}
              {item.action.sequence}
            </span>
            <ActivityTime value={item.action.createdAt} />
            <span>{item.evidence === "expired" ? "Evidence expired" : "Redacted evidence"}</span>
          </div>
          <p className="mt-1 break-all font-mono text-[10.5px] text-neutral-500">
            {item.action.id}
          </p>
        </Link>
      ))}
    </div>
  );
}

function PageRows({ page }: { page: ActivityPage }) {
  if (page.schemaVersion === "np.agent-activity-actions.v1")
    return <ActionRows items={page.items} />;
  if (page.schemaVersion === "np.agent-activity-principals.v1")
    return (
      <div className="space-y-2">
        {page.items.map((principal) => (
          <Link
            key={principal.id}
            href={`/admin/agents/gateway/${encodeURIComponent(principal.id)}`}
            className="block rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px] font-medium">{principal.name}</span>
              <StateBadge state={principal.status} />
            </div>
            <p className="mt-1 text-[12px] text-neutral-500">
              {principal.kind} · <ActivityTime value={principal.createdAt} />
            </p>
            <p className="mt-1 break-words text-[12px] text-neutral-500">
              {principal.scopes.join(", ")}
            </p>
          </Link>
        ))}
      </div>
    );
  return (
    <div className="space-y-2">
      {page.items.map(({ run, evidence }) => (
        <Link
          key={run.id}
          href={`/admin/agents/activity/${encodeURIComponent(run.id)}`}
          className="block rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14px] font-medium">{run.goal}</span>
            <StateBadge state={run.state} />
          </div>
          <p className="mt-1 text-[12px] text-neutral-500">
            {run.origin === "gateway" ? "Gateway" : "Runtime"} · {run.usage.capabilityCalls}{" "}
            capability calls · <ActivityTime value={run.startedAt ?? run.queuedAt} />
          </p>
          <p className="mt-1 break-all font-mono text-[10.5px] text-neutral-500">{run.id}</p>
          {evidence === "expired" ? (
            <p className="mt-1 text-[12px] text-neutral-500">Evidence expired</p>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

function Pagination({
  section,
  queryString,
  nextCursor,
}: {
  section: NpAgentActivityKindV1;
  queryString: string;
  nextCursor: string | null;
}) {
  const next = new URLSearchParams(queryString);
  if (nextCursor) next.set("cursor", nextCursor);
  const first = new URLSearchParams(queryString);
  first.delete("cursor");
  return (
    <div className="flex justify-between gap-3">
      {new URLSearchParams(queryString).has("cursor") ? (
        <Button asChild variant="outline" size="sm">
          <Link href={activityHref(section, first.toString())}>
            <ArrowLeft className="size-3.5" />
            First page
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {nextCursor ? (
        <Button asChild variant="outline" size="sm">
          <Link href={activityHref(section, next.toString())}>
            Next page
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

export function AgentActivityView({
  section,
  queryString,
}: {
  section: NpAgentActivityKindV1;
  queryString: string;
}) {
  const resource = useActivity(
    `${apiPaths[section]}${queryString ? `?${queryString}` : ""}`,
    parseActivityPage,
  );
  const expectedSchema = `np.agent-activity-${section}.v1`;
  const page = resource.value?.schemaVersion === expectedSchema ? resource.value : null;
  return (
    <AgentStudioFrame active="activity">
      <ActivityNavigation section={section} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold capitalize">{section}</h2>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            Authorized activity for the current site. Runtime identities appear only when stored
            evidence exists.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={resource.loading}
          onClick={resource.refresh}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>
      <ActivityFilters key={queryString} section={section} queryString={queryString} />
      {resource.loading ? (
        <p role="status" className="text-[13px] text-neutral-500">
          {resource.value ? "Refreshing Activity…" : "Loading Activity…"}
        </p>
      ) : null}
      {resource.error ? <ActivityError error={resource.error} retry={resource.refresh} /> : null}
      {resource.value && !page ? (
        <ActivityError
          error={
            new AgentStudioApiError(
              "Unexpected Activity page contract.",
              502,
              "ACTIVITY_CONTRACT_ERROR",
            )
          }
          retry={resource.refresh}
        />
      ) : null}
      {page ? (
        page.items.length ? (
          <>
            <PageRows page={page} />
            <Pagination section={section} queryString={queryString} nextCursor={page.nextCursor} />
          </>
        ) : (
          <EmptyActivity section={section} />
        )
      ) : null}
    </AgentStudioFrame>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-neutral-500">{label}</dt>
      <dd className="mt-1 break-words text-[13px] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function RunActions({ runId }: { runId: string }) {
  const query = `runId=${encodeURIComponent(runId)}&limit=25`;
  const resource = useActivity(`${apiPaths.actions}?${query}`, parseActionsPage);
  const page =
    resource.value?.schemaVersion === "np.agent-activity-actions.v1" ? resource.value : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {resource.loading ? (
          <p role="status" className="text-[13px] text-neutral-500">
            Loading run actions…
          </p>
        ) : null}
        {resource.error ? <ActivityError error={resource.error} retry={resource.refresh} /> : null}
        {page ? (
          page.items.length ? (
            <>
              <ActionRows items={page.items} />
              <Pagination section="actions" queryString={query} nextCursor={page.nextCursor} />
            </>
          ) : (
            <p className="text-[13px] text-neutral-500">No visible actions for this run.</p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AgentActivityRunDetailView({ runId }: { runId: string }) {
  const resource = useActivity(
    `${apiPaths.runs}/${encodeURIComponent(runId)}`,
    npRequireAgentActivityRunDetailV1,
  );
  const detail: NpAgentActivityRunDetailV1 | null = resource.value;
  const run = detail?.run;
  return (
    <AgentStudioFrame active="activity">
      <ActivityNavigation section="runs" />
      <Button asChild variant="ghost" size="sm">
        <Link href={activityHref("runs")}>
          <ArrowLeft className="size-3.5" />
          Back to runs
        </Link>
      </Button>
      {resource.loading ? (
        <p role="status" className="text-[13px]">
          Loading run…
        </p>
      ) : null}
      {resource.error ? <ActivityError error={resource.error} retry={resource.refresh} /> : null}
      {detail && run ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold">{run.goal}</h2>
              <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">{run.id}</p>
            </div>
            <div className="flex items-center gap-2">
              <StateBadge state={run.state} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resource.loading}
                onClick={resource.refresh}
              >
                Refresh
              </Button>
            </div>
          </div>
          <EvidenceNotice evidence={detail.evidence} />
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Run identity</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Site">{run.siteId}</Fact>
                <Fact label="Origin">{run.origin === "gateway" ? "Gateway" : "Runtime"}</Fact>
                <Fact label="Principal">
                  <Link
                    className="underline"
                    href={`/admin/agents/gateway/${encodeURIComponent(run.principalId)}`}
                  >
                    {run.principalId}
                  </Link>
                </Fact>
                <Fact label="Invocation">{detail.invocationId ?? "Not recorded"}</Fact>
                <Fact label="Root run">{run.rootRunId}</Fact>
                <Fact label="Attempt">{run.attempt}</Fact>
                {run.origin === "runtime" && run.agent ? (
                  <>
                    <Fact label="Agent">{run.agent.id}</Fact>
                    <Fact label="Agent version">{run.agent.versionId}</Fact>
                  </>
                ) : null}
                <Fact label="Parent run">{run.parentRunId ?? "None"}</Fact>
                <Fact label="Deadline">
                  <ActivityTime value={run.deadlineAt} />
                </Fact>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Recorded timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-[13px]">
                <li>
                  <span className="font-medium">Queued</span> ·{" "}
                  <ActivityTime value={run.queuedAt} />
                </li>
                {run.startedAt ? (
                  <li>
                    <span className="font-medium">Started</span> ·{" "}
                    <ActivityTime value={run.startedAt} />
                  </li>
                ) : null}
                {run.finishedAt ? (
                  <li>
                    <span className="font-medium">{run.state}</span> ·{" "}
                    <ActivityTime value={run.finishedAt} />
                  </li>
                ) : null}
              </ol>
              {run.errorCode ? <p className="mt-3 font-mono text-[12px]">{run.errorCode}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Recorded usage</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Fact label="Capability calls">{run.usage.capabilityCalls}</Fact>
                {run.origin === "runtime" ? (
                  <>
                    <Fact label="Provider calls">{run.usage.providerCalls}</Fact>
                    <Fact label="Input tokens">{run.usage.inputTokens}</Fact>
                    <Fact label="Cached input tokens">{run.usage.cachedInputTokens}</Fact>
                    <Fact label="Output tokens">{run.usage.outputTokens}</Fact>
                    <Fact label="Cost (micros)">{run.usage.costMicros}</Fact>
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>
          {detail.auditEventIds.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Audit references</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 break-all font-mono text-[11px]">
                  {detail.auditEventIds.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          <RunActions key={run.id} runId={run.id} />
        </>
      ) : null}
    </AgentStudioFrame>
  );
}

export function AgentActivityActionDetailView({ actionId }: { actionId: string }) {
  const resource = useActivity(
    `${apiPaths.actions}/${encodeURIComponent(actionId)}`,
    npRequireAgentActivityActionDetailV1,
  );
  const detail: NpAgentActivityActionDetailV1 | null = resource.value;
  const action = detail?.action;
  return (
    <AgentStudioFrame active="activity">
      <ActivityNavigation section="actions" />
      <Button asChild variant="ghost" size="sm">
        <Link href={activityHref("actions")}>
          <ArrowLeft className="size-3.5" />
          Back to actions
        </Link>
      </Button>
      {resource.loading ? (
        <p role="status" className="text-[13px]">
          Loading action…
        </p>
      ) : null}
      {resource.error ? <ActivityError error={resource.error} retry={resource.refresh} /> : null}
      {detail && action ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold">{action.capabilityId}</h2>
              <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">{action.id}</p>
            </div>
            <div className="flex items-center gap-2">
              <StateBadge state={action.state} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resource.loading}
                onClick={resource.refresh}
              >
                Refresh
              </Button>
            </div>
          </div>
          <EvidenceNotice evidence={detail.evidence} />
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Action facts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Site">{action.siteId}</Fact>
                <Fact label="Principal">
                  <Link
                    className="underline"
                    href={`/admin/agents/gateway/${encodeURIComponent(detail.principalId)}`}
                  >
                    {detail.principalId}
                  </Link>
                </Fact>
                <Fact label="Run">
                  {action.runId ? (
                    <Link
                      className="underline"
                      href={`/admin/agents/activity/${encodeURIComponent(action.runId)}`}
                    >
                      {action.runId}
                    </Link>
                  ) : (
                    "Inline invocation · no run was created"
                  )}
                </Fact>
                <Fact label="Invocation">{detail.invocationId ?? "Not recorded"}</Fact>
                <Fact label="Sequence">{action.sequence}</Fact>
                <Fact label="Capability version">{action.capabilityContractVersion}</Fact>
                <Fact label="Risk">{action.risk}</Fact>
                <Fact label="Effect">
                  {action.effectProfile.id} v{action.effectProfile.contractVersion}
                </Fact>
                <Fact label="Verification">{action.verificationState ?? "Not applicable"}</Fact>
                <Fact label="Created">
                  <ActivityTime value={action.createdAt} />
                </Fact>
                <Fact label="Started">
                  <ActivityTime value={action.startedAt} />
                </Fact>
                <Fact label="Finished">
                  <ActivityTime value={action.finishedAt} />
                </Fact>
                <Fact label="Required scopes">{action.requiredScopes.join(", ")}</Fact>
                <Fact label="Approval">{action.approvalId ?? "None recorded"}</Fact>
                <Fact label="Safe error">{action.errorCode ?? "None"}</Fact>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Retained hashes and audit</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Fact label="Input hash">{detail.inputHash}</Fact>
                <Fact label="Output hash">{detail.outputHash ?? "Not recorded"}</Fact>
                <Fact label="Proposal hash">{action.proposalHash}</Fact>
                <Fact label="Capability fingerprint">{action.capabilityFingerprint}</Fact>
                <Fact label="Audit reference">{detail.auditEventId ?? "Not recorded"}</Fact>
              </dl>
            </CardContent>
          </Card>
          {detail.evidence === "redacted" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Safe evidence projection</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-[12px] font-medium">Input metadata</h3>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-3 text-[11px] dark:bg-neutral-900">
                    {JSON.stringify(action.inputRedacted, null, 2)}
                  </pre>
                </div>
                <div>
                  <h3 className="mb-2 text-[12px] font-medium">Output metadata</h3>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-3 text-[11px] dark:bg-neutral-900">
                    {action.outputRedacted === null
                      ? "No output recorded"
                      : JSON.stringify(action.outputRedacted, null, 2)}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </AgentStudioFrame>
  );
}
