"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui/tabs.js";

/**
 * Phase 13 — admin background-jobs view. One tab per state:
 * Pending (created+retry), Active, Completed, Failed.
 *
 * The endpoint reports a `supported: false` flag when the
 * site runs without pg-boss (NX_ENABLE_JOBS=0); the UI shows
 * an empty-state in that case rather than 500ing on every
 * tab fetch.
 */

interface JobSummary {
  id: string;
  name: string;
  state:
    | "created"
    | "active"
    | "completed"
    | "failed"
    | "retry"
    | "cancelled"
    | "expired";
  data: unknown;
  retryCount?: number;
  output?: string | null;
  createdOn: string;
  startedOn?: string | null;
  completedOn?: string | null;
}

interface JobListResponse {
  supported: boolean;
  jobs?: JobSummary[];
  total?: number;
}

const STATE_BUCKETS: Record<string, JobSummary["state"][]> = {
  pending: ["created", "retry"],
  active: ["active"],
  completed: ["completed"],
  failed: ["failed", "cancelled", "expired"],
};

export function JobsView() {
  const [tab, setTab] = useState<keyof typeof STATE_BUCKETS>("pending");
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [supported, setSupported] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  useEffect(() => {
    void load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function load(activeTab: keyof typeof STATE_BUCKETS) {
    setRefreshing(true);
    setError(null);
    try {
      const states = STATE_BUCKETS[activeTab];
      // Fetch each state in this bucket and merge — pg-boss
      // doesn't have a single "any-of-these-states" filter, so
      // we round-trip per state. Buckets have 1-3 states max.
      const results = await Promise.all(
        states.map(async (state) => {
          const res = await nxFetch(
            `/api/admin/jobs?state=${encodeURIComponent(state)}&limit=100`,
          );
          return (await res.json().catch(() => null)) as JobListResponse | null;
        }),
      );
      const supportedFlags = results.map((r) => r?.supported ?? true);
      setSupported(supportedFlags.every(Boolean));
      const merged = results.flatMap((r) => r?.jobs ?? []);
      // Sort newest first across the merged buckets.
      merged.sort(
        (a, b) =>
          new Date(b.createdOn).getTime() - new Date(a.createdOn).getTime(),
      );
      setJobs(merged);
    } catch {
      setError("Unable to load jobs.");
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
      const body = (await res.json().catch(() => null)) as
        | { id?: string; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Unable to retry job.");
        return;
      }
      await load(tab);
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
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Unable to cancel job.");
        return;
      }
      await load(tab);
    } catch {
      setError("Unable to cancel job.");
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Operations
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Background jobs
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Inspect, retry, and cancel queued jobs. Failed jobs surface their
            last error inline so you can patch the upstream issue and re-run.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(tab)}
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

      {!supported ? (
        <Card className="border-amber-300/60 bg-amber-50">
          <CardContent className="pt-6 text-sm text-amber-900">
            <strong className="font-semibold">Background jobs disabled.</strong>{" "}
            This site is running without pg-boss. Set{" "}
            <code>NX_ENABLE_JOBS=1</code> and restart the worker to surface
            queued jobs here.
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as keyof typeof STATE_BUCKETS)}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-2 gap-2 md:w-auto md:grid-cols-4">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
        </TabsList>

        {(Object.keys(STATE_BUCKETS) as Array<keyof typeof STATE_BUCKETS>).map(
          (key) => (
            <TabsContent key={key} value={key} className="space-y-3">
              <JobList
                jobs={jobs}
                tab={key}
                busyJobId={busyJobId}
                onRetry={retry}
                onCancel={cancel}
              />
            </TabsContent>
          ),
        )}
      </Tabs>
    </div>
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
                <p className="font-mono text-[11px] text-muted-foreground">
                  {job.id}
                </p>
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
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StateBadge({ state }: { state: JobSummary["state"] }) {
  const map: Record<
    JobSummary["state"],
    { label: string; cls: string; Icon: typeof Check }
  > = {
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
