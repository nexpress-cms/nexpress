"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  Clock,
  Code,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  npRequireCancelJobWire,
  npRequireEnqueueJobWire,
  npRequireJobListWire,
  npRequireJobsHealthWire,
  npRequireRetryAllJobsWire,
  npRequireRetryJobWire,
  npRequireScheduleListWire,
  type NpJobState,
  type NpJobSummary,
  type NpJobsHealthWire,
  type NpRecentJobFailure,
  type NpScheduleSummary,
} from "@nexpress/core/jobs-contract";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { PageHeader } from "../layout/page-header.js";
import { JobLogsSection } from "./job-logs-section.js";
import { JOB_STATE_BUCKETS, jobListUrls, type JobsStateTab } from "./jobs-query.js";

/**
 * Phase 13 — admin background-jobs view. One tab per state:
 * Pending (created+retry), Active, Completed, Failed.
 *
 * Phase 13.2 — added Scheduled tab (registered cron entries +
 * handler list) and a time-range toggle ("All time" / "Last
 * 24 h") on the state tabs so operators can spot recent
 * incidents without paging through history.
 *
 * Optional listing support is reported by the active adapter;
 * unsupported observations do not establish whether jobs are enabled.
 */

type WindowMode = "all" | "24h";

type ScheduleSummary = NpScheduleSummary;
type JobSummary = NpJobSummary;
type StuckJobsBlock = NonNullable<NpJobsHealthWire["stuck"]>;
type WorkerHealthResponse = NpJobsHealthWire;
type RecentJobFailure = NpRecentJobFailure;
type StateTab = JobsStateTab;
type Tab = StateTab | "scheduled";

const STATE_TABS: StateTab[] = ["pending", "active", "completed", "failed", "archive"];

function isStateTab(tab: Tab): tab is StateTab {
  return tab !== "scheduled";
}

export interface JobsViewProps {
  queueName?: string;
  searchCollections?: readonly { slug: string; label: string }[];
}

export function JobsView(props: JobsViewProps) {
  return <JobsViewContent key={props.queueName ?? ""} {...props} />;
}

function JobsViewContent({ searchCollections = [], queueName }: JobsViewProps) {
  const [tab, setTab] = useState<Tab>("pending");
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [reportedTotal, setReportedTotal] = useState(0);
  const [supported, setSupported] = useState<boolean>(true);
  const [failure, setFailure] = useState<{ context: string; message: string } | null>(null);
  const [loadedContext, setLoadedContext] = useState<string | null>(null);
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [windowMode, setWindowMode] = useState<WindowMode>("all");
  const [schedules, setSchedules] = useState<ScheduleSummary[] | null>(null);
  const [handlers, setHandlers] = useState<string[]>([]);
  const [schedulesSupported, setSchedulesSupported] = useState<boolean>(true);

  const [refreshKey, setRefreshKey] = useState(0);
  const filterContext = JSON.stringify([tab, windowMode, queueName ?? null]);
  const [navigation, setNavigation] = useState<{
    state: NpJobState | "all";
    offset: number;
    now: number;
  }>(() => ({ state: "all", offset: 0, now: Date.now() }));
  const states = isStateTab(tab) ? JOB_STATE_BUCKETS[tab] : [];
  const selectedState = states.length === 1 ? states[0] : navigation.state;
  const offset = navigation.offset;
  const pageState = selectedState === "all" ? undefined : selectedState;
  const refresh = () => {
    setNavigation((value) => ({ ...value, offset: 0, now: Date.now() }));
    setRefreshKey((value) => value + 1);
  };
  const retryPage = () => setRefreshKey((value) => value + 1);
  function changeWindow(mode: WindowMode) {
    setWindowMode(mode);
    setNavigation((value) => ({
      ...value,
      offset: 0,
      now: Date.now(),
    }));
  }
  const context = JSON.stringify([
    filterContext,
    selectedState,
    offset,
    navigation.now,
    refreshKey,
  ]);
  const activeContext = useRef<string | null>(context);
  useLayoutEffect(() => {
    activeContext.current = context;
    return () => {
      activeContext.current = null;
    };
  }, [context]);
  const currentSnapshot = loadedContext === context;
  const error = failure?.context === context ? failure.message : null;
  function setError(message: string | null) {
    if (activeContext.current === context) {
      setFailure(message === null ? null : { context, message });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const frame = window.requestAnimationFrame(() => {
      setRefreshing(true);
      setFailure(null);
      setJobs(null);
      setSchedules(null);
      setHandlers([]);
      void (async () => {
        try {
          if (tab === "scheduled") {
            const res = await npFetch("/api/admin/jobs/schedules", { signal });
            const body = await readResponseJson(res);
            if (!res.ok) throw new Error(readApiError(body, "Unable to load schedules."));
            const result = npRequireScheduleListWire(body);
            if (signal.aborted) return;
            setSchedulesSupported(result.supported);
            setSchedules(
              result.schedules.filter((entry) => !queueName || entry.name === queueName),
            );
            setHandlers(result.handlers.filter((name) => !queueName || name === queueName));
          } else {
            const results = await Promise.all(
              jobListUrls(
                tab,
                windowMode,
                queueName,
                navigation.now,
                pageState ? { state: pageState, offset } : undefined,
              ).map(async (url) => {
                const res = await npFetch(url, { signal });
                const body = await readResponseJson(res);
                if (!res.ok) throw new Error(readApiError(body, "Unable to load jobs."));
                const result = npRequireJobListWire(body);
                const requestedState = new URL(url, "https://jobs.invalid").searchParams.get(
                  "state",
                );
                if (
                  result.jobs.length > 100 ||
                  result.jobs.some(
                    (job) => job.state !== requestedState || (queueName && job.name !== queueName),
                  )
                ) {
                  throw new Error("Invalid job page");
                }
                return result;
              }),
            );
            if (signal.aborted) return;
            setSupported(results.every((result) => result.supported));
            const merged = results.flatMap((result) => result.jobs);
            merged.sort(
              (a, b) => new Date(b.createdOn).getTime() - new Date(a.createdOn).getTime(),
            );
            setJobs(merged);
            setReportedTotal(results.reduce((total, result) => total + result.total, 0));
          }
          setLoadedContext(context);
        } catch {
          if (!signal.aborted) {
            setFailure({
              context,
              message: tab === "scheduled" ? "Unable to load schedules." : "Unable to load jobs.",
            });
          }
        } finally {
          if (!signal.aborted) setRefreshing(false);
        }
      })();
    });
    return () => {
      controller.abort();
      window.cancelAnimationFrame(frame);
    };
  }, [tab, windowMode, queueName, refreshKey, context, navigation.now, pageState, offset]);

  async function retry(id: string) {
    setBusyJobId(id);
    setError(null);
    try {
      const res = await npFetch(`/api/admin/jobs/${encodeURIComponent(id)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await readResponseJson(res);
      if (!res.ok) {
        setError(readApiError(body, "Unable to retry job."));
        return;
      }
      npRequireRetryJobWire(body);
      refresh();
    } catch {
      setError("Unable to retry job.");
    } finally {
      setBusyJobId(null);
    }
  }

  async function cancel(id: string) {
    setBusyJobId(id);
    setError(null);
    try {
      const res = await npFetch(`/api/admin/jobs/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await readResponseJson(res);
      if (!res.ok) {
        setError(readApiError(body, "Unable to cancel job."));
        return;
      }
      npRequireCancelJobWire(body);
      refresh();
    } catch {
      setError("Unable to cancel job.");
    } finally {
      setBusyJobId(null);
    }
  }

  async function retryAllFailed() {
    setBulkRetrying(true);
    setError(null);
    try {
      const res = await npFetch("/api/admin/jobs/retry-all?state=failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await readResponseJson(res);
      if (!res.ok) {
        setError(readApiError(body, "Bulk retry failed."));
        return;
      }
      npRequireRetryAllJobsWire(body);
      refresh();
    } catch {
      setError("Bulk retry failed.");
    } finally {
      setBulkRetrying(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Background jobs"
        description="Inspect, retry, and cancel queued jobs. Failed jobs surface their last error inline so you can patch the upstream issue and re-run."
        actions={
          <div
            className={`grid min-w-0 w-full gap-2 sm:flex sm:w-auto sm:items-center ${
              isStateTab(tab) ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {isStateTab(tab) ? (
              <div className="col-span-2 inline-flex min-h-12 min-w-0 rounded-lg bg-neutral-100 p-1 text-[12.5px] dark:bg-neutral-900 sm:col-span-1 sm:min-h-0 sm:h-8">
                <button
                  type="button"
                  onClick={() => changeWindow("all")}
                  aria-pressed={windowMode === "all"}
                  className={`min-h-10 flex-1 rounded-md px-3 transition-colors sm:min-h-0 sm:flex-none sm:px-2.5 ${
                    windowMode === "all"
                      ? "bg-white font-medium text-neutral-950 shadow-sm dark:bg-neutral-950 dark:text-neutral-50"
                      : "text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
                  }`}
                >
                  All time
                </button>
                <button
                  type="button"
                  onClick={() => changeWindow("24h")}
                  aria-pressed={windowMode === "24h"}
                  className={`min-h-10 flex-1 rounded-md px-3 transition-colors sm:min-h-0 sm:flex-none sm:px-2.5 ${
                    windowMode === "24h"
                      ? "bg-white font-medium text-neutral-950 shadow-sm dark:bg-neutral-950 dark:text-neutral-50"
                      : "text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
                  }`}
                >
                  Last 24 h
                </button>
              </div>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 w-full sm:min-h-0 sm:w-auto"
              onClick={refresh}
              disabled={refreshing || bulkRetrying}
            >
              {refreshing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Refresh
            </Button>
          </div>
        }
      />

      {queueName ? (
        <p className="min-w-0 break-words text-sm text-muted-foreground">
          Queue: <code className="break-all">{queueName}</code>. Job lists and registered schedules
          are filtered to this queue.{" "}
          <a href="/admin/jobs" className="underline">
            Show all queues
          </a>
        </p>
      ) : null}

      {isStateTab(tab) && currentSnapshot && !supported ? (
        <Card className="min-w-0 border-amber-500/30/60 bg-amber-500/10">
          <CardContent className="break-words text-[13px] text-amber-900 dark:text-amber-100">
            <strong className="font-semibold">Job listing unavailable.</strong> The active queue
            adapter does not expose job listings.
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p role="alert">{error}</p>
          {!currentSnapshot && isStateTab(tab) ? (
            <Button variant="outline" size="sm" className="mt-2 min-h-10" onClick={retryPage}>
              Retry page
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="min-w-0 space-y-2">
        <p className="text-xs text-muted-foreground">
          Worker health covers all queues on this host.
        </p>
        <WorkerHealthCard />
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as Tab);
          setNavigation({ state: "all", offset: 0, now: Date.now() });
        }}
        className="min-w-0 space-y-6"
      >
        <TabsList className="grid h-auto w-full grid-cols-3 items-stretch gap-2 md:h-9 md:w-auto md:grid-cols-6 md:items-center">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
          <TabsTrigger value="archive">Archive</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
        </TabsList>

        {STATE_TABS.map((key) => (
          <TabsContent key={key} value={key} className="min-w-0 space-y-3">
            {JOB_STATE_BUCKETS[key].length > 1 ? (
              <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                Job state
                <select
                  className="min-h-10 max-w-full rounded-md border border-border bg-background px-3"
                  value={selectedState}
                  onChange={(event) => {
                    const state = event.target.value;
                    const selected =
                      state === "all"
                        ? "all"
                        : JOB_STATE_BUCKETS[key].find((entry) => entry === state);
                    if (selected) {
                      setNavigation((value) => ({
                        ...value,
                        state: selected,
                        offset: 0,
                        now: Date.now(),
                      }));
                    }
                  }}
                >
                  <option value="all">All states (latest)</option>
                  {JOB_STATE_BUCKETS[key].map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {pageState ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Job pages">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  disabled={
                    offset === 0 ||
                    (!currentSnapshot && !error) ||
                    bulkRetrying ||
                    busyJobId !== null
                  }
                  onClick={() =>
                    setNavigation((value) => ({
                      ...value,
                      offset: Math.max(0, value.offset - 100),
                    }))
                  }
                >
                  Previous jobs
                </Button>
                <span className="text-sm" role="status">
                  Page {offset / 100 + 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  disabled={
                    !currentSnapshot ||
                    !supported ||
                    jobs?.length !== 100 ||
                    offset + 100 >= reportedTotal ||
                    offset >= 100_000 ||
                    bulkRetrying ||
                    busyJobId !== null
                  }
                  onClick={() =>
                    setNavigation((value) => ({ ...value, offset: value.offset + 100 }))
                  }
                >
                  Next jobs
                </Button>
                {offset === 100_000 ? (
                  <p className="w-full text-xs text-muted-foreground">
                    The job navigation limit has been reached.
                  </p>
                ) : null}
              </div>
            ) : null}
            {key === "failed" && !queueName && currentSnapshot && jobs && jobs.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <p className="text-xs text-muted-foreground">
                  Bulk retry covers all failed jobs across queues and time ranges, including jobs
                  not shown here.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-10 w-full sm:min-h-0 sm:w-auto"
                  disabled={refreshing || bulkRetrying}
                  onClick={() => void retryAllFailed()}
                >
                  <Play className="size-3" />
                  Retry all failed
                </Button>
              </div>
            ) : null}
            {key === "archive" ? (
              <p className="break-words text-xs text-muted-foreground">
                Retained completed, failed, cancelled, and expired jobs. This tab is read-only; use
                Failed to retry eligible jobs.
              </p>
            ) : null}
            {!error && (!currentSnapshot || supported) ? (
              <JobList
                jobs={currentSnapshot ? jobs : null}
                reportedTotal={reportedTotal}
                paged={pageState !== undefined}
                tab={key}
                busyJobId={busyJobId}
                onRetry={(id) => void retry(id)}
                onCancel={(id) => void cancel(id)}
              />
            ) : null}
          </TabsContent>
        ))}

        <TabsContent value="scheduled" className="min-w-0 space-y-4">
          <SchedulesPanel
            supported={!currentSnapshot || schedulesSupported}
            schedules={currentSnapshot ? schedules : null}
            handlers={currentSnapshot ? handlers : []}
            searchCollections={searchCollections}
            onEnqueued={refresh}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Phase 20.4 — small worker liveness card surfaced above the
 * tabs. Polls `/api/admin/jobs/health` once on mount and on
 * Refresh; not a live socket because the heartbeat tick is
 * 30 s — refresh-on-demand is plenty.
 */
function WorkerHealthCard() {
  const [data, setData] = useState<WorkerHealthResponse | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [renderedAt, setRenderedAt] = useState<number>(() => Date.now());

  async function load() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await npFetch("/api/admin/jobs/health");
      if (!res.ok) {
        // editor-gated route; non-200 means no role or no queue.
        setError("Worker health unavailable.");
        setData(null);
        return;
      }
      setData(npRequireJobsHealthWire(await readResponseJson(res)));
      setRenderedAt(Date.now());
    } catch {
      setError("Worker health unavailable.");
    } finally {
      setRefreshing(false);
    }
  }

  // The lint rule wants external-system sync; this is a fetch-on-
  // mount → setState pattern, which is the canonical client-
  // component shape until we move to Suspense + a data layer.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  if (error || !data) {
    return null;
  }
  const alive = data.aliveCount;
  const total = data.totalCount;
  const newest = data.newestHeartbeat ? new Date(data.newestHeartbeat) : null;
  const ageMs = newest ? renderedAt - newest.getTime() : null;
  const paused = data.pause.paused;

  const stuck = data.stuck ?? null;
  const failedOverThreshold = stuck !== null && stuck.counts.failed > stuck.thresholds.failed;
  const expiredOverThreshold = stuck !== null && stuck.counts.expired > stuck.thresholds.expired;
  const showStuckWarning = failedOverThreshold || expiredOverThreshold;
  const recentFailures = data.recentFailures.slice(0, 3);

  return (
    <Card className="min-w-0">
      <CardContent className="min-w-0 p-4 text-sm">
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`inline-flex h-2.5 w-2.5 rounded-full ${
                alive > 0 ? "bg-emerald-500" : "bg-rose-500"
              }`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="break-words font-medium text-foreground">
                Workers: {alive} alive / {total} total
              </p>
              <p className="break-words text-xs text-muted-foreground">
                {newest
                  ? `Last heartbeat ${formatAge(ageMs ?? 0)} ago`
                  : "No heartbeats recorded yet."}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
            {paused ? (
              <span className="break-words rounded-md border border-amber-500/30/60 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-100">
                Queue paused
              </span>
            ) : null}
            {showStuckWarning && stuck ? (
              <span
                className="inline-flex min-w-0 items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300"
                title={stuckTooltip(stuck)}
              >
                <AlertTriangle className="h-3 w-3" aria-hidden />
                <span className="min-w-0 break-words">
                  {stuckLabel(stuck, failedOverThreshold, expiredOverThreshold)}
                </span>
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh worker health"
              className="min-h-10 min-w-10 sm:min-h-0 sm:min-w-0"
              onClick={() => void load()}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
        {recentFailures.length > 0 ? (
          <div className="mt-3 min-w-0 border-t border-border/60 pt-3">
            <p className="break-words text-xs font-medium text-muted-foreground">Recent failures</p>
            <ul className="mt-2 min-w-0 space-y-2">
              {recentFailures.map((failure) => (
                <li key={failure.id} className="min-w-0 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <StateBadge state={failure.state} />
                    <code className="min-w-0 break-all font-mono text-xs">{failure.name}</code>
                    <span className="break-words text-[11px] text-muted-foreground">
                      {failure.logCount.toString()} log{failure.logCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="min-w-0 break-words text-xs text-muted-foreground">
                    {recentFailureSummary(failure)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function recentFailureSummary(failure: RecentJobFailure): string {
  return failure.lastLog?.message ?? failure.output ?? "No job log captured.";
}

function stuckLabel(
  stuck: StuckJobsBlock,
  failedOverThreshold: boolean,
  expiredOverThreshold: boolean,
): string {
  const parts: string[] = [];
  if (failedOverThreshold) parts.push(`${stuck.counts.failed} failed`);
  if (expiredOverThreshold) parts.push(`${stuck.counts.expired} expired`);
  return parts.join(" · ");
}

function stuckTooltip(stuck: StuckJobsBlock): string {
  return (
    `Failed jobs: ${stuck.counts.failed} (threshold ${stuck.thresholds.failed}). ` +
    `Expired jobs: ${stuck.counts.expired} (threshold ${stuck.thresholds.expired}). ` +
    `Configure under \`jobs.stuckThreshold\` in nexpress.config.ts.`
  );
}

function formatAge(ms: number): string {
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function SchedulesPanel({
  supported,
  schedules,
  handlers,
  onEnqueued,
  searchCollections,
}: {
  supported: boolean;
  schedules: ScheduleSummary[] | null;
  handlers: string[];
  onEnqueued: () => void;
  searchCollections: readonly { slug: string; label: string }[];
}) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader className="border-b-0 pb-0">
            <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <CalendarClock className="h-4 w-4 shrink-0" />{" "}
              <span className="min-w-0 break-words">Cron schedules</span>
            </CardTitle>
            <p className="break-words text-xs text-muted-foreground">
              Recurring jobs registered via <code>boss.schedule()</code>. Reads from{" "}
              <code>pgboss.schedule</code>.
            </p>
          </CardHeader>
          <CardContent className="min-w-0 p-0">
            {!supported ? (
              <p className="break-words px-5 pb-5 text-sm text-muted-foreground">
                The active queue adapter doesn't expose schedules.
              </p>
            ) : schedules === null ? (
              <p className="break-words px-5 pb-5 text-sm text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Loading…
              </p>
            ) : schedules.length === 0 ? (
              <p className="break-words px-5 pb-5 text-sm text-muted-foreground">
                No schedules registered.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {schedules.map((schedule) => {
                  const kind = scheduleKind(schedule);
                  return (
                    <li
                      key={`${schedule.name}#${schedule.key}`}
                      className="min-w-0 space-y-1 px-5 py-3"
                    >
                      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${kind.className}`}
                        >
                          {kind.label}
                        </span>
                        <code className="break-all font-mono text-xs">{schedule.name}</code>
                        {schedule.key ? (
                          <code className="break-all rounded bg-muted px-1.5 py-0.5 text-[11px]">
                            {schedule.key}
                          </code>
                        ) : null}
                        <code className="break-all rounded bg-muted px-1.5 py-0.5 text-[11px]">
                          {schedule.cron}
                        </code>
                        {schedule.timezone ? (
                          <span className="break-all text-[10px] text-muted-foreground">
                            {schedule.timezone}
                          </span>
                        ) : null}
                      </div>
                      {kind.detail ? (
                        <p className="break-words text-[11px] text-muted-foreground">
                          {kind.detail}
                        </p>
                      ) : null}
                      <p className="break-words text-[11px] text-muted-foreground">
                        Registered {new Date(schedule.createdOn).toLocaleString()}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="border-b-0 pb-0">
            <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <Code className="h-4 w-4 shrink-0" />{" "}
              <span className="min-w-0 break-words">Known handler contracts</span>
            </CardTitle>
            <p className="break-words text-xs text-muted-foreground">
              Built-in job types plus application handlers registered at bootstrap. Manual enqueues
              accept only this inventory.
            </p>
          </CardHeader>
          <CardContent className="min-w-0 p-0">
            {handlers.length === 0 ? (
              <p className="break-words px-5 pb-5 text-sm text-muted-foreground">
                No handlers registered yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {handlers.map((name) => (
                  <li key={name} className="break-all px-5 py-2 font-mono text-xs text-foreground">
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <EnqueuePanel
        handlers={handlers}
        onEnqueued={onEnqueued}
        searchCollections={searchCollections}
      />
    </div>
  );
}

function scheduleKind(schedule: ScheduleSummary): {
  label: "plugin" | "framework" | "custom";
  className: string;
  detail: string | null;
} {
  if (schedule.name.startsWith("plugin.scheduledTask.")) {
    const pluginId = typeof schedule.data.pluginId === "string" ? schedule.data.pluginId : null;
    const taskId = typeof schedule.data.taskId === "string" ? schedule.data.taskId : null;
    return {
      label: "plugin",
      className: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
      detail: pluginId && taskId ? `Plugin task: ${pluginId} / ${taskId}` : "Plugin task",
    };
  }
  if (schedule.name.startsWith("system.") || schedule.name.startsWith("notifications.")) {
    return {
      label: "framework",
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      detail: null,
    };
  }
  return {
    label: "custom",
    className: "bg-muted text-muted-foreground",
    detail: null,
  };
}

function EnqueuePanel({
  handlers,
  onEnqueued,
  searchCollections,
}: {
  handlers: string[];
  onEnqueued: () => void;
  searchCollections: readonly { slug: string; label: string }[];
}) {
  const [type, setType] = useState<string>("");
  const [dataText, setDataText] = useState<string>("{}");
  const [searchCollection, setSearchCollection] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSearchReindex = type === "search:reindex";

  async function submit() {
    setBusy(true);
    setMessage(null);
    setError(null);
    let data: unknown = isSearchReindex ? { collection: searchCollection } : {};
    if (!isSearchReindex && dataText.trim().length > 0) {
      try {
        data = JSON.parse(dataText);
      } catch {
        setError("Payload is not valid JSON.");
        setBusy(false);
        return;
      }
    }
    try {
      const res = await npFetch("/api/admin/jobs/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, data }),
      });
      const body = await readResponseJson(res);
      if (!res.ok) {
        setError(readApiError(body, "Enqueue failed."));
        return;
      }
      const result = npRequireEnqueueJobWire(body);
      setMessage(`Enqueued (job id ${result.id}).`);
      onEnqueued();
    } catch {
      setError("Enqueue failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b-0 pb-0">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Play className="h-4 w-4 shrink-0" />{" "}
          <span className="min-w-0 break-words">Run a handler</span>
        </CardTitle>
        <p className="break-words text-xs text-muted-foreground">
          Enqueue a one-off job for any registered handler. Useful for ad-hoc re-runs (e.g.{" "}
          <code>media:cleanup</code>) without dropping into a shell.
        </p>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        <div className="grid min-w-0 gap-3 md:grid-cols-[1fr_2fr]">
          <div className="min-w-0 space-y-1">
            <label
              htmlFor="np-job-enqueue-type"
              className="text-xs font-medium text-muted-foreground"
            >
              Handler
            </label>
            <select
              id="np-job-enqueue-type"
              value={type}
              onChange={(event) => {
                const nextType = event.target.value;
                setType(nextType);
                setMessage(null);
                setError(null);
                if (
                  nextType === "search:reindex" &&
                  searchCollection.length === 0 &&
                  searchCollections.length === 1
                ) {
                  setSearchCollection(searchCollections[0]?.slug ?? "");
                }
              }}
              className="flex h-10 w-full min-w-0 rounded-lg border border-neutral-200/80 bg-white px-3 text-[13px] outline-none transition-colors focus-visible:border-[var(--np-color-brand)] focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] dark:border-neutral-800 dark:bg-neutral-950 sm:h-8 sm:px-2.5"
            >
              <option value="">Select…</option>
              {handlers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {isSearchReindex ? (
            <div className="min-w-0 space-y-1">
              <label
                htmlFor="np-job-reindex-collection"
                className="text-xs font-medium text-muted-foreground"
              >
                Searchable collection
              </label>
              <select
                id="np-job-reindex-collection"
                value={searchCollection}
                onChange={(event) => setSearchCollection(event.target.value)}
                className="flex h-10 w-full min-w-0 rounded-lg border border-neutral-200/80 bg-white px-3 text-[13px] outline-none transition-colors focus-visible:border-[var(--np-color-brand)] focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] dark:border-neutral-800 dark:bg-neutral-950 sm:h-8 sm:px-2.5"
              >
                <option value="">
                  {searchCollections.length === 0 ? "No searchable collections" : "Select…"}
                </option>
                {searchCollections.map((collection) => (
                  <option key={collection.slug} value={collection.slug}>
                    {collection.label} ({collection.slug})
                  </option>
                ))}
              </select>
              <p className="break-words text-[11px] text-muted-foreground">
                {searchCollections.length === 0
                  ? "Register a collection with search enabled before running this handler."
                  : "Rebuilds Postgres search vectors and any configured external index in a durable, retryable job."}
              </p>
            </div>
          ) : (
            <div className="min-w-0 space-y-1">
              <label
                htmlFor="np-job-enqueue-data"
                className="text-xs font-medium text-muted-foreground"
              >
                Payload (JSON)
              </label>
              <textarea
                id="np-job-enqueue-data"
                value={dataText}
                onChange={(event) => setDataText(event.target.value)}
                rows={3}
                spellCheck={false}
                className="min-h-28 w-full min-w-0 rounded-lg border border-neutral-200/80 bg-white px-3 py-2.5 font-mono text-[12px] outline-none transition-colors focus-visible:border-[var(--np-color-brand)] focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] dark:border-neutral-800 dark:bg-neutral-950 sm:min-h-0 sm:px-2.5 sm:py-2"
                placeholder='{"docId": "..."}'
              />
            </div>
          )}
        </div>
        {error ? <p className="break-words text-xs text-destructive">{error}</p> : null}
        {message ? (
          <p className="break-words text-xs text-emerald-700 dark:text-emerald-400">{message}</p>
        ) : null}
        <div className="flex min-w-0 justify-end">
          <Button
            size="sm"
            className="min-h-10 w-full sm:min-h-0 sm:w-auto"
            disabled={busy || !type || (isSearchReindex && !searchCollection)}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Enqueue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function JobList({
  jobs,
  reportedTotal,
  paged,
  tab,
  busyJobId,
  onRetry,
  onCancel,
}: {
  jobs: JobSummary[] | null;
  reportedTotal: number;
  paged: boolean;
  tab: StateTab;
  busyJobId: string | null;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (jobs === null) {
    return (
      <Card className="min-w-0 border-border/60 bg-card/60">
        <CardContent className="break-words text-[13px] text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading jobs…
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b-0 pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Showing {jobs.length} of {reportedTotal} reported matches
        </CardTitle>
        <p className="break-words text-xs text-muted-foreground">
          {paged
            ? "Up to 100 jobs per page, newest first, for the selected state, queue and creation-time window."
            : "Up to 100 newest jobs per state for the selected queue and creation-time window. Select a job state to browse older jobs."}{" "}
          Counts and rows are sampled separately. New jobs, state changes and retention can shift
          pages. Refresh returns to the first page and renews the time window.
        </p>
      </CardHeader>
      <CardContent className="min-w-0 divide-y divide-border/60 p-0">
        {jobs.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            {reportedTotal === 0 ? "No jobs in this bucket." : "No rows returned in this response."}
          </p>
        ) : null}
        {jobs.map((job) => (
          <div key={job.id} className="min-w-0 space-y-2 px-5 py-4">
            <div className="grid min-w-0 gap-3 sm:flex sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StateBadge state={job.state} />
                  <code className="min-w-0 break-all font-mono text-xs">{job.name}</code>
                  {typeof job.retryCount === "number" && job.retryCount > 0 ? (
                    <span className="break-words rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-100">
                      {job.retryCount} retries
                    </span>
                  ) : null}
                </div>
                <p className="break-all font-mono text-[11px] text-muted-foreground">{job.id}</p>
                <p className="break-words text-[11px] text-muted-foreground">
                  Created {new Date(job.createdOn).toLocaleString()}
                  {job.state === "created" || job.state === "retry" ? (
                    <span className="block">
                      {job.state === "retry" ? "Retry not before" : "Scheduled not before"}{" "}
                      {job.startAfter ? new Date(job.startAfter).toLocaleString() : "Unknown"}
                    </span>
                  ) : null}
                  <span className="block">
                    Last started{" "}
                    {job.startedOn ? new Date(job.startedOn).toLocaleString() : "Not recorded"}
                  </span>
                  {job.completedOn ? (
                    <span className="block">
                      Finished {new Date(job.completedOn).toLocaleString()}
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:items-center">
                {tab === "failed" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-10 w-full sm:min-h-0 sm:w-auto"
                    disabled={busyJobId === job.id}
                    onClick={() => onRetry(job.id)}
                  >
                    {busyJobId === job.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Play className="size-3" />
                    )}
                    Retry
                  </Button>
                ) : null}
                {tab === "pending" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-10 w-full sm:min-h-0 sm:w-auto"
                    disabled={busyJobId === job.id}
                    onClick={() => onCancel(job.id)}
                  >
                    {busyJobId === job.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Ban className="size-3" />
                    )}
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
            {job.output ? (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-destructive/30 bg-destructive/5 p-3 font-mono text-[11px] text-destructive">
                {job.output}
              </pre>
            ) : null}
            <details className="min-w-0 text-[11px]">
              <summary className="inline-flex min-h-10 cursor-pointer items-center text-muted-foreground hover:text-foreground sm:min-h-0">
                Payload
              </summary>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/20 p-3 font-mono text-[11px]">
                {JSON.stringify(job.data, null, 2)}
              </pre>
            </details>
            <JobLogsSection key={job.id} jobId={job.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function readApiError(value: unknown, fallback: string): string {
  if (typeof value !== "object" || value === null || !("error" in value)) return fallback;
  const error = value.error;
  if (typeof error !== "object" || error === null || !("message" in error)) return fallback;
  return typeof error.message === "string" && error.message.length > 0 ? error.message : fallback;
}

function StateBadge({ state }: { state: JobSummary["state"] }) {
  const map: Record<JobSummary["state"], { label: string; cls: string; Icon: typeof Check }> = {
    created: {
      label: "Pending",
      cls: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
      Icon: Clock,
    },
    retry: {
      label: "Retrying",
      cls: "bg-amber-500/15 text-amber-900 dark:text-amber-100",
      Icon: RefreshCw,
    },
    active: {
      label: "Running",
      cls: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100",
      Icon: Loader2,
    },
    completed: {
      label: "Done",
      cls: "bg-emerald-500/15 text-emerald-900 dark:text-emerald-100",
      Icon: Check,
    },
    failed: {
      label: "Failed",
      cls: "bg-destructive/10 text-destructive",
      Icon: AlertTriangle,
    },
    cancelled: {
      label: "Cancelled",
      cls: "bg-muted text-muted-foreground",
      Icon: XCircle,
    },
    expired: {
      label: "Expired",
      cls: "bg-muted text-muted-foreground",
      Icon: Clock,
    },
  };
  const { label, cls, Icon } = map[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
