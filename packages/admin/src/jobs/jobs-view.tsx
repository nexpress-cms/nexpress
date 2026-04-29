"use client";

import { useEffect, useState } from "react";
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

import { nxFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";

/**
 * Phase 13 — admin background-jobs view. One tab per state:
 * Pending (created+retry), Active, Completed, Failed.
 *
 * Phase 13.2 — added Scheduled tab (registered cron entries +
 * handler list) and a time-range toggle ("All time" / "Last
 * 24 h") on the state tabs so operators can spot recent
 * incidents without paging through history.
 *
 * The endpoint reports a `supported: false` flag when the
 * site runs without pg-boss (NX_ENABLE_JOBS=0); the UI shows
 * an empty-state in that case rather than 500ing on every
 * tab fetch.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
type WindowMode = "all" | "24h";

interface ScheduleSummary {
  name: string;
  /**
   * Issue #217 — second half of pgboss.schedule's primary key.
   * Empty for single-cadence schedules; non-empty for cron rows
   * that share a queue name (e.g. daily / weekly digest).
   */
  key: string;
  cron: string;
  timezone: string | null;
  data: unknown;
  createdOn: string;
  updatedOn?: string | null;
}

interface ScheduleListResponse {
  supported: boolean;
  schedules?: ScheduleSummary[];
  handlers?: string[];
}

interface JobSummary {
  id: string;
  name: string;
  state: "created" | "active" | "completed" | "failed" | "retry" | "cancelled" | "expired";
  data: unknown;
  retryCount?: number;
  output?: string | null;
  createdOn: string;
  startedOn?: string | null;
  completedOn?: string | null;
  /** Phase 20.4 — `live` (pgboss.job) or `archive` (pgboss.archive). */
  source?: "live" | "archive";
}

/** Phase 20.4 — `/api/admin/jobs/health` payload. */
interface WorkerHealthResponse {
  workers?: Array<{
    id: string;
    status: string;
    lastSeenAt: string;
    alive: boolean;
    lastSeenAgoMs: number;
  }>;
  aliveCount?: number;
  totalCount?: number;
  newestHeartbeat?: string | null;
  pause?: { paused: boolean; pausedAt?: string | null };
}

interface JobListResponse {
  supported: boolean;
  jobs?: JobSummary[];
  total?: number;
}

interface JobLogEntry {
  id: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context: Record<string, unknown> | null;
  createdAt: string;
}

interface JobLogsResponse {
  jobId: string;
  total: number;
  entries: JobLogEntry[];
}

type StateTab = "pending" | "active" | "completed" | "failed" | "archive";
type Tab = StateTab | "scheduled";

const STATE_BUCKETS: Record<StateTab, JobSummary["state"][]> = {
  pending: ["created", "retry"],
  active: ["active"],
  completed: ["completed"],
  failed: ["failed", "cancelled", "expired"],
  // Phase 20.4 — Archive: rolled-out rows in pgboss.archive. The
  // bucket spans every state because pg-boss archives completed
  // jobs alongside failed ones; the `source=archive` query
  // narrows to the `pgboss.archive` table.
  archive: ["completed", "failed", "cancelled", "expired"],
};

const STATE_TABS: StateTab[] = ["pending", "active", "completed", "failed", "archive"];

function isStateTab(tab: Tab): tab is StateTab {
  return tab !== "scheduled";
}

export function JobsView() {
  const [tab, setTab] = useState<Tab>("pending");
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [supported, setSupported] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [windowMode, setWindowMode] = useState<WindowMode>("all");
  const [schedules, setSchedules] = useState<ScheduleSummary[] | null>(null);
  const [handlers, setHandlers] = useState<string[]>([]);
  const [schedulesSupported, setSchedulesSupported] = useState<boolean>(true);

  useEffect(() => {
    if (tab === "scheduled") {
      void loadSchedules();
    } else {
      void load(tab, windowMode);
    }
  }, [tab, windowMode]);

  async function load(activeTab: StateTab, mode: WindowMode) {
    setRefreshing(true);
    setError(null);
    try {
      const states = STATE_BUCKETS[activeTab];
      const sinceParam =
        mode === "24h"
          ? `&since=${encodeURIComponent(new Date(Date.now() - ONE_DAY_MS).toISOString())}`
          : "";
      // Phase 20.4 — Archive tab pins `source=archive`; other tabs
      // pin `source=live` so finished rows that pg-boss has
      // already rolled out of `pgboss.job` don't double up under
      // both Failed (live) and Archive.
      const sourceParam = activeTab === "archive" ? "&source=archive" : "&source=live";
      // Fetch each state in this bucket and merge — pg-boss
      // doesn't have a single "any-of-these-states" filter, so
      // we round-trip per state. Buckets have 1-3 states max.
      const results = await Promise.all(
        states.map(async (state) => {
          const res = await nxFetch(
            `/api/admin/jobs?state=${encodeURIComponent(state)}&limit=100${sinceParam}${sourceParam}`,
          );
          return (await res.json().catch(() => null)) as JobListResponse | null;
        }),
      );
      const supportedFlags = results.map((r) => r?.supported ?? true);
      setSupported(supportedFlags.every(Boolean));
      const merged = results.flatMap((r) => r?.jobs ?? []);
      // Sort newest first across the merged buckets.
      merged.sort((a, b) => new Date(b.createdOn).getTime() - new Date(a.createdOn).getTime());
      setJobs(merged);
    } catch {
      setError("Unable to load jobs.");
    } finally {
      setRefreshing(false);
    }
  }

  async function loadSchedules() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await nxFetch("/api/admin/jobs/schedules");
      const body = (await res.json().catch(() => null)) as ScheduleListResponse | null;
      setSchedulesSupported(body?.supported ?? false);
      setSchedules(body?.schedules ?? []);
      setHandlers(body?.handlers ?? []);
    } catch {
      setError("Unable to load schedules.");
    } finally {
      setRefreshing(false);
    }
  }

  async function retry(id: string) {
    setBusyJobId(id);
    setError(null);
    try {
      const res = await nxFetch(`/api/admin/jobs/${encodeURIComponent(id)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => null)) as {
        id?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Unable to retry job.");
        return;
      }
      if (isStateTab(tab)) await load(tab, windowMode);
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
      const res = await nxFetch(`/api/admin/jobs/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Unable to cancel job.");
        return;
      }
      if (isStateTab(tab)) await load(tab, windowMode);
    } catch {
      setError("Unable to cancel job.");
    } finally {
      setBusyJobId(null);
    }
  }

  async function retryAllFailed() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await nxFetch("/api/admin/jobs/retry-all?state=failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => null)) as {
        retried?: number;
        failed?: number;
        remaining?: number;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Bulk retry failed.");
        return;
      }
      if (isStateTab(tab)) await load(tab, windowMode);
    } catch {
      setError("Bulk retry failed.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Operations
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Background jobs</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Inspect, retry, and cancel queued jobs. Failed jobs surface their last error inline so
            you can patch the upstream issue and re-run.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isStateTab(tab) ? (
            <div className="inline-flex rounded-md border border-border/70 bg-background p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setWindowMode("all")}
                className={`rounded px-2 py-1 transition ${
                  windowMode === "all"
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All time
              </button>
              <button
                type="button"
                onClick={() => setWindowMode("24h")}
                className={`rounded px-2 py-1 transition ${
                  windowMode === "24h"
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Last 24 h
              </button>
            </div>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (tab === "scheduled") {
                void loadSchedules();
              } else {
                void load(tab, windowMode);
              }
            }}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {!supported ? (
        <Card className="border-amber-300/60 bg-amber-50">
          <CardContent className="pt-6 text-sm text-amber-900">
            <strong className="font-semibold">Background jobs disabled.</strong> This site is
            running without pg-boss. Set <code>NX_ENABLE_JOBS=1</code> and restart the worker to
            surface queued jobs here.
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <WorkerHealthCard />

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 gap-2 md:w-auto md:grid-cols-6">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
          <TabsTrigger value="archive">Archive</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
        </TabsList>

        {STATE_TABS.map((key) => (
          <TabsContent key={key} value={key} className="space-y-3">
            {key === "failed" && jobs && jobs.length > 0 ? (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={refreshing}
                  onClick={() => void retryAllFailed()}
                >
                  <Play className="mr-1.5 h-3 w-3" />
                  Retry all failed
                </Button>
              </div>
            ) : null}
            {key === "archive" ? (
              <p className="text-xs text-muted-foreground">
                Rows pg-boss has rolled out of <code>pgboss.job</code> after their{" "}
                <code>keepUntil</code> window. Read-only — retrying an archived job re-enqueues a
                fresh row in <code>pgboss.job</code>.
              </p>
            ) : null}
            <JobList
              jobs={jobs}
              tab={key}
              busyJobId={busyJobId}
              onRetry={(id) => void retry(id)}
              onCancel={(id) => void cancel(id)}
            />
          </TabsContent>
        ))}

        <TabsContent value="scheduled" className="space-y-4">
          <SchedulesPanel
            supported={schedulesSupported}
            schedules={schedules}
            handlers={handlers}
            onEnqueued={() => {
              void loadSchedules();
            }}
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

  async function load() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await nxFetch("/api/admin/jobs/health");
      if (!res.ok) {
        // editor-gated route; non-200 means no role or no queue.
        setError("Worker health unavailable.");
        setData(null);
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        data?: WorkerHealthResponse;
      } | null;
      setData(body?.data ?? null);
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

  // The "first heartbeat age" is computed once per render — using
  // `Date.now()` directly trips the impure-call rule, but the value
  // is intentionally point-in-time (it ticks with the `refresh`
  // button, which is what operators expect).
  const [renderedAt] = useState<number>(() => Date.now());

  if (error || !data) {
    return null;
  }
  const alive = data.aliveCount ?? 0;
  const total = data.totalCount ?? 0;
  const newest = data.newestHeartbeat ? new Date(data.newestHeartbeat) : null;
  const ageMs = newest ? renderedAt - newest.getTime() : null;
  const paused = data.pause?.paused === true;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4 text-sm md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${
              alive > 0 ? "bg-emerald-500" : "bg-rose-500"
            }`}
            aria-hidden
          />
          <div>
            <p className="font-medium text-foreground">
              Workers: {alive} alive / {total} total
            </p>
            <p className="text-xs text-muted-foreground">
              {newest
                ? `Last heartbeat ${formatAge(ageMs ?? 0)} ago`
                : "No heartbeats recorded yet."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {paused ? (
            <span className="rounded-md border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
              Queue paused
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
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
}: {
  supported: boolean;
  schedules: ScheduleSummary[] | null;
  handlers: string[];
  onEnqueued: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="h-4 w-4" /> Cron schedules
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Recurring jobs registered via <code>boss.schedule()</code>. Reads from{" "}
              <code>pgboss.schedule</code>.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {!supported ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">
                The active queue adapter doesn't expose schedules.
              </p>
            ) : schedules === null ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">
                <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin" />
                Loading…
              </p>
            ) : schedules.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">No schedules registered.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {schedules.map((schedule) => (
                  <li
                    key={`${schedule.name}#${schedule.key}`}
                    className="space-y-1 px-5 py-3"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <code className="font-mono text-xs">{schedule.name}</code>
                      {schedule.key ? (
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                          {schedule.key}
                        </code>
                      ) : null}
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        {schedule.cron}
                      </code>
                      {schedule.timezone ? (
                        <span className="text-[10px] text-muted-foreground">
                          {schedule.timezone}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Registered {new Date(schedule.createdOn).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Code className="h-4 w-4" /> Registered handlers
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Job types that have a worker handler registered. Enqueues to other types will sit in
              the queue with no consumer.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {handlers.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">No handlers registered yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {handlers.map((name) => (
                  <li key={name} className="px-5 py-2 font-mono text-xs text-foreground">
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <EnqueuePanel handlers={handlers} onEnqueued={onEnqueued} />
    </div>
  );
}

function EnqueuePanel({ handlers, onEnqueued }: { handlers: string[]; onEnqueued: () => void }) {
  const [type, setType] = useState<string>("");
  const [dataText, setDataText] = useState<string>("{}");
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    setError(null);
    let data: unknown = {};
    if (dataText.trim().length > 0) {
      try {
        data = JSON.parse(dataText);
      } catch {
        setError("Payload is not valid JSON.");
        setBusy(false);
        return;
      }
    }
    try {
      const res = await nxFetch("/api/admin/jobs/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, data }),
      });
      const body = (await res.json().catch(() => null)) as {
        id?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Enqueue failed.");
        return;
      }
      setMessage(`Enqueued (job id ${body?.id ?? "unknown"}).`);
      onEnqueued();
    } catch {
      setError("Enqueue failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Play className="h-4 w-4" /> Run a handler
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Enqueue a one-off job for any registered handler. Useful for ad-hoc re-runs (e.g.{" "}
          <code>media:cleanup</code>) without dropping into a shell.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
          <div className="space-y-1">
            <label
              htmlFor="nx-job-enqueue-type"
              className="text-xs font-medium text-muted-foreground"
            >
              Handler
            </label>
            <select
              id="nx-job-enqueue-type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Select…</option>
              {handlers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label
              htmlFor="nx-job-enqueue-data"
              className="text-xs font-medium text-muted-foreground"
            >
              Payload (JSON)
            </label>
            <textarea
              id="nx-job-enqueue-data"
              value={dataText}
              onChange={(event) => setDataText(event.target.value)}
              rows={3}
              spellCheck={false}
              className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 font-mono text-xs"
              placeholder='{"docId": "..."}'
            />
          </div>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {message ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">{message}</p>
        ) : null}
        <div className="flex justify-end">
          <Button size="sm" disabled={busy || !type} onClick={() => void submit()}>
            {busy ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3 w-3" />
            )}
            Enqueue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function JobList({
  jobs,
  tab,
  busyJobId,
  onRetry,
  onCancel,
}: {
  jobs: JobSummary[] | null;
  tab: keyof typeof STATE_BUCKETS;
  busyJobId: string | null;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (jobs === null) {
    return (
      <Card className="border-border/60 bg-card/60">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading jobs…
        </CardContent>
      </Card>
    );
  }
  if (jobs.length === 0) {
    return (
      <Card className="border-dashed border-border/60 bg-muted/20">
        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
          No jobs in this bucket.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {jobs.length} job{jobs.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border/60 p-0">
        {jobs.map((job) => (
          <div key={job.id} className="space-y-2 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StateBadge state={job.state} />
                  <code className="font-mono text-xs">{job.name}</code>
                  {typeof job.retryCount === "number" && job.retryCount > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                      {job.retryCount} retries
                    </span>
                  ) : null}
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">{job.id}</p>
                <p className="text-[11px] text-muted-foreground">
                  Created {new Date(job.createdOn).toLocaleString()}
                  {job.completedOn
                    ? ` · Finished ${new Date(job.completedOn).toLocaleString()}`
                    : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {tab === "failed" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyJobId === job.id}
                    onClick={() => onRetry(job.id)}
                  >
                    {busyJobId === job.id ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-3 w-3" />
                    )}
                    Retry
                  </Button>
                ) : null}
                {tab === "pending" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyJobId === job.id}
                    onClick={() => onCancel(job.id)}
                  >
                    {busyJobId === job.id ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <Ban className="mr-1.5 h-3 w-3" />
                    )}
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
            {job.output ? (
              <pre className="max-h-32 overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 font-mono text-[11px] text-destructive whitespace-pre-wrap">
                {job.output}
              </pre>
            ) : null}
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Payload
              </summary>
              <pre className="mt-1 max-h-32 overflow-auto rounded-lg border border-border/60 bg-muted/20 p-3 font-mono text-[11px]">
                {JSON.stringify(job.data, null, 2)}
              </pre>
            </details>
            <JobLogsSection jobId={job.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Phase 20.3b — collapsible logs panel per job. Lazy-fetches
 * `/api/admin/jobs/{id}/logs` only when the operator expands the
 * row, so the jobs list itself stays cheap. Reuses the pattern of
 * the existing "Payload" details element above so the row's
 * visual weight stays consistent.
 *
 * Each entry renders as `[HH:mm:ss.SSS] [level] message`. Context
 * payloads (when present) collapse into a nested `<details>`
 * summary so wide objects don't blow out the row's width.
 */
function JobLogsSection({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "loaded"; total: number; entries: JobLogEntry[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    if (!open || state.kind !== "idle") return;
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const res = await nxFetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/logs?limit=500`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as JobLogsResponse;
        if (!cancelled) {
          setState({ kind: "loaded", total: data.total, entries: data.entries });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Failed to load logs",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, jobId, state.kind]);

  return (
    <details
      className="text-[11px]"
      open={open}
      onToggle={(event) => {
        const nowOpen = (event.currentTarget as HTMLDetailsElement).open;
        setOpen(nowOpen);
        // Self-review fix — reset to idle on collapse so the next
        // expand re-fetches. Without this, a still-running job's
        // log stream stays frozen at the first-expand snapshot.
        if (!nowOpen && state.kind !== "idle") {
          setState({ kind: "idle" });
        }
      }}
    >
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Logs
        {state.kind === "loaded" ? (
          <span className="ml-2 text-[10px] opacity-70">
            ({state.total}
            {state.entries.length < state.total ? ` · showing ${state.entries.length}` : ""})
          </span>
        ) : null}
      </summary>
      <div className="mt-1">
        {state.kind === "loading" ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/10 p-3 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading logs…
          </div>
        ) : state.kind === "error" ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            {state.message}
          </div>
        ) : state.kind === "loaded" ? (
          state.entries.length === 0 ? (
            <div className="rounded-lg border border-border/60 bg-muted/10 p-3 text-muted-foreground">
              No log entries for this job.
            </div>
          ) : (
            <ol className="max-h-64 space-y-1 overflow-auto rounded-lg border border-border/60 bg-muted/10 p-3 font-mono text-[11px]">
              {state.entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="opacity-60">{formatLogTime(entry.createdAt)}</span>
                  <LogLevelBadge level={entry.level} />
                  <span className="break-words whitespace-pre-wrap">{entry.message}</span>
                  {entry.context && Object.keys(entry.context).length > 0 ? (
                    <details className="ml-6 w-full">
                      <summary className="cursor-pointer opacity-70 hover:opacity-100">
                        context
                      </summary>
                      <pre className="mt-1 overflow-auto rounded border border-border/40 bg-background/40 p-2 text-[10px]">
                        {JSON.stringify(entry.context, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
          )
        ) : null}
      </div>
    </details>
  );
}

const LOG_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hour12: false,
});

function formatLogTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return LOG_TIME_FORMATTER.format(date);
}

function LogLevelBadge({ level }: { level: JobLogEntry["level"] }) {
  const tone =
    level === "error"
      ? "bg-destructive/10 text-destructive"
      : level === "warn"
        ? "bg-amber-100 text-amber-900"
        : level === "debug"
          ? "bg-muted text-muted-foreground"
          : "bg-blue-50 text-blue-900";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
      {level}
    </span>
  );
}

function StateBadge({ state }: { state: JobSummary["state"] }) {
  const map: Record<JobSummary["state"], { label: string; cls: string; Icon: typeof Check }> = {
    created: {
      label: "Pending",
      cls: "bg-blue-100 text-blue-900",
      Icon: Clock,
    },
    retry: {
      label: "Retrying",
      cls: "bg-amber-100 text-amber-900",
      Icon: RefreshCw,
    },
    active: {
      label: "Running",
      cls: "bg-indigo-100 text-indigo-900",
      Icon: Loader2,
    },
    completed: {
      label: "Done",
      cls: "bg-emerald-100 text-emerald-900",
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
