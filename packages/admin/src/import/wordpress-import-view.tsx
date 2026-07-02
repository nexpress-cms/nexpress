"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Eye,
  FileUp,
  History,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";

import { PageHeader } from "../layout/page-header.js";
import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Switch } from "../ui/switch.js";
import { cn } from "../ui/utils.js";

type ImportMode = "preview" | "apply";

interface ListResult<T> {
  total: number;
  items: T[];
  truncated: boolean;
}

interface AppliedRow {
  wpId: number;
  wpType: string;
  collection: string;
  slug: string;
  title: string;
}

interface SkippedRow {
  wpId: number;
  wpType: string;
  slug: string;
  reason: string;
}

interface ErrorRow {
  wpId: number;
  slug: string;
  message: string;
}

interface ImportResponse {
  mode: ImportMode;
  dryRun: boolean;
  sourceName: string;
  site: {
    title: string;
    link: string;
    language: string | null;
  };
  options: {
    update: boolean;
    strict: boolean;
    createAuthors: boolean;
    includeMedia: boolean;
  };
  counts: {
    records: number;
    authors: number;
    terms: number;
    comments: number;
    inlineMediaRefs: number;
    featuredImages: number;
    recordsByType: Record<string, number>;
    termsByTaxonomy: Record<string, number>;
    statuses: Record<string, number>;
  };
  report: {
    applied: ListResult<AppliedRow>;
    skipped: ListResult<SkippedRow>;
    errors: ListResult<ErrorRow>;
    notes: ListResult<string>;
    logs: ListResult<string>;
    attachments: { byId: number; byUrl: number };
    media: {
      status: "not-run" | "completed";
      uploaded: number;
      reused: number;
      skipped: number;
      resolvedUrls: number;
      resolvedAttachments: number;
      errors: ListResult<{ url: string; reason: string }>;
    };
    taxonomies: {
      status: "not-run" | "completed";
      resolved: number;
      skipped: ListResult<{ taxonomy: string; slug: string; name: string }>;
      errors: ListResult<{
        key: { taxonomy: string; slug: string; name: string };
        reason: string;
      }>;
    };
    comments: {
      status: "not-run" | "completed";
      applied: number;
      skippedUnapproved: number;
      skippedNoMember: number;
      skippedByResume: number;
      errors: ListResult<{ wpCommentId: number; reason: string }>;
    };
    authors: {
      status: "not-run" | "completed";
      resolved: number;
      skipped: ListResult<string>;
      errors: ListResult<{ login: string; reason: string }>;
    };
  };
}

type ImportRunStatus = "queued" | "running" | "succeeded" | "failed";

interface ImportRun {
  id: string;
  kind: string;
  mode: "apply";
  status: ImportRunStatus;
  sourceName: string;
  sourceSize: number;
  sourceMimeType: string | null;
  options: OptionsState;
  jobId: string | null;
  report: ImportResponse | null;
  logs: string[];
  error: string | null;
  createdBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface QueuedResponse {
  mode: "apply";
  queued: true;
  run: ImportRun;
}

type BackgroundState = "ready" | "disabled" | "paused" | "no-workers" | "stale-workers";

interface BackgroundStatus {
  jobsEnabled: boolean;
  paused: boolean;
  state: BackgroundState;
  workerAliveCount: number;
  workerTotalCount: number;
  newestHeartbeat: string | null;
  staleAfterSeconds: number;
}

interface RunsResponse {
  runs: ImportRun[];
  background: BackgroundStatus;
}

interface SweepResponse {
  failed: number;
  cutoff: string;
  staleAfterSeconds: number;
  runs: ImportRun[];
}

interface OptionsState {
  update: boolean;
  strict: boolean;
  createAuthors: boolean;
  includeMedia: boolean;
}

const DEFAULT_OPTIONS: OptionsState = {
  update: false,
  strict: false,
  createAuthors: true,
  includeMedia: true,
};

export function WordPressImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<OptionsState>(DEFAULT_OPTIONS);
  const [previewResult, setPreviewResult] = useState<ImportResponse | null>(null);
  const [activeRun, setActiveRun] = useState<ImportRun | null>(null);
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [background, setBackground] = useState<BackgroundStatus | null>(null);
  const [sweptCount, setSweptCount] = useState(0);
  const [runsLoading, setRunsLoading] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState<ImportMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentKey = file ? `${fileKey(file)}:${optionsKey(options)}` : null;
  const canPreview = !!file && loading === null;
  const canApply = !!file && loading === null && previewKey === currentKey;
  const displayedResult = activeRun?.report ?? previewResult;
  const statusTone: "destructive" | "brand" | "secondary" = activeRun
    ? statusVariant(activeRun.status)
    : displayedResult?.report.errors.total
      ? "destructive"
      : displayedResult
        ? "brand"
        : "secondary";

  const visibleApplied = useMemo(
    () => displayedResult?.report.applied.items ?? [],
    [displayedResult],
  );
  const visibleSkipped = useMemo(
    () => displayedResult?.report.skipped.items ?? [],
    [displayedResult],
  );
  const activeRunId = activeRun?.id ?? null;
  const activeRunStatus = activeRun?.status ?? null;

  const refreshRun = useCallback(async (id: string) => {
    try {
      const response = await npFetch(`/api/admin/import/wordpress/runs/${id}`);
      const body = (await response.json().catch(() => null)) as {
        run?: ImportRun;
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.run) return;

      const nextRun = body.run;
      setRuns((current) => upsertRun(current, nextRun));
      setActiveRun((current) => (current?.id === nextRun.id ? nextRun : current));
    } catch {
      /* polling retries on the next tick */
    }
  }, []);

  const refreshRuns = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setRunsLoading(true);
    try {
      const response = await npFetch("/api/admin/import/wordpress/runs?limit=12");
      const body = (await response.json().catch(() => null)) as
        (RunsResponse & { error?: { message?: string } }) | null;
      if (!response.ok || !body?.runs) return;

      setRuns(body.runs);
      if (body.background) setBackground(body.background);
      setActiveRun((current) => {
        if (current) return body.runs.find((run) => run.id === current.id) ?? current;
        return body.runs.find((run) => isLiveRun(run.status)) ?? body.runs[0] ?? null;
      });
    } catch {
      /* history refresh is best-effort */
    } finally {
      if (!options?.silent) setRunsLoading(false);
    }
  }, []);

  const sweepStaleRuns = useCallback(async () => {
    try {
      const response = await npFetch("/api/admin/import/wordpress/runs/sweep", {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as
        (SweepResponse & { error?: { message?: string } }) | null;
      if (!response.ok || !body) return;

      if (body.failed > 0) {
        setSweptCount((current) => current + body.failed);
        setRuns((current) => body.runs.reduce((next, run) => upsertRun(next, run), current));
        setActiveRun((current) => {
          if (!current) return current;
          return body.runs.find((run) => run.id === current.id) ?? current;
        });
      }
    } catch {
      /* stale sweep is best-effort; history refresh still runs */
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        await sweepStaleRuns();
        await refreshRuns({ silent: true });
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshRuns, sweepStaleRuns]);

  useEffect(() => {
    if (!activeRunId || !activeRunStatus || !isLiveRun(activeRunStatus)) return;
    const interval = window.setInterval(() => {
      void refreshRun(activeRunId);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [activeRunId, activeRunStatus, refreshRun]);

  async function submit(mode: ImportMode) {
    if (!file) {
      setError("Choose a WXR file first.");
      return;
    }
    if (mode === "apply" && previewKey !== currentKey) {
      setError("Preview this file and option set before applying it.");
      return;
    }
    if (mode === "apply" && !window.confirm("Apply this WordPress import now?")) {
      return;
    }

    setLoading(mode);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("mode", mode);
      formData.set("update", String(options.update));
      formData.set("strict", String(options.strict));
      formData.set("createAuthors", String(options.createAuthors));
      formData.set("includeMedia", String(options.includeMedia));

      const response = await npFetch("/api/admin/import/wordpress", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as
        ImportResponse | QueuedResponse | { error?: { message?: string } } | null;

      if (!response.ok) {
        setError(
          (body as { error?: { message?: string } } | null)?.error?.message ??
            "WordPress import failed.",
        );
        return;
      }

      if (mode === "preview") {
        const nextResult = body as ImportResponse;
        setPreviewResult(nextResult);
        setActiveRun(null);
        setPreviewKey(currentKey);
      } else {
        const queued = body as QueuedResponse;
        setActiveRun(queued.run);
        setRuns((current) => upsertRun(current, queued.run));
        setPreviewResult(null);
        setPreviewKey(null);
        void refreshRun(queued.run.id);
        void refreshRuns({ silent: true });
      }
    } catch {
      setError("WordPress import failed.");
    } finally {
      setLoading(null);
    }
  }

  function updateOption<K extends keyof OptionsState>(key: K, value: OptionsState[K]) {
    setOptions((current) => ({ ...current, [key]: value }));
    setPreviewKey(null);
    setPreviewResult(null);
    setActiveRun(null);
    setError(null);
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="WordPress import"
        description="Preview WXR exports and apply them into NexPress content."
        actions={
          activeRun ? (
            <Badge variant={statusTone}>
              {statusLabel(activeRun.status)}
              {activeRun.report ? ` · ${activeRun.report.report.errors.total} errors` : ""}
            </Badge>
          ) : displayedResult ? (
            <Badge variant={statusTone}>
              {displayedResult.mode === "preview" ? "Preview" : "Applied"} ·{" "}
              {displayedResult.report.errors.total} errors
            </Badge>
          ) : null
        }
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileUp className="size-4 text-[var(--np-color-brand)]" />
              <CardTitle>Source</CardTitle>
            </div>
            <CardDescription>WXR XML from Tools - Export in WordPress.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="wp-import-file">WXR file</Label>
              <Input
                id="wp-import-file"
                type="file"
                accept=".xml,.wxr,text/xml,application/xml"
                onChange={(event) => {
                  const nextFile = event.currentTarget.files?.[0] ?? null;
                  setFile(nextFile);
                  setPreviewKey(null);
                  setPreviewResult(null);
                  setActiveRun(null);
                  setError(null);
                }}
              />
              {file ? (
                <p className="truncate text-[12px] text-neutral-500 dark:text-neutral-400">
                  {file.name} · {formatBytes(file.size)}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <OptionSwitch
                checked={options.update}
                label="Update existing slugs"
                onCheckedChange={(checked) => updateOption("update", checked)}
              />
              <OptionSwitch
                checked={options.strict}
                label="Strict failures"
                onCheckedChange={(checked) => updateOption("strict", checked)}
              />
              <OptionSwitch
                checked={options.createAuthors}
                label="Create imported authors"
                onCheckedChange={(checked) => updateOption("createAuthors", checked)}
              />
              <OptionSwitch
                checked={options.includeMedia}
                label="Include media pipeline"
                onCheckedChange={(checked) => updateOption("includeMedia", checked)}
              />
            </div>

            {error ? (
              <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <BackgroundNotice background={background} sweptCount={sweptCount} />

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="brand"
                className="w-full sm:w-auto"
                disabled={!canPreview}
                onClick={() => void submit("preview")}
              >
                {loading === "preview" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Eye className="size-3.5" />
                )}
                Preview
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={!canApply}
                onClick={() => void submit("apply")}
              >
                {loading === "apply" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Apply
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={loading !== null}
                onClick={() => {
                  setOptions(DEFAULT_OPTIONS);
                  setPreviewResult(null);
                  setActiveRun(null);
                  setPreviewKey(null);
                  setError(null);
                }}
                aria-label="Reset import state"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>

            <RunHistory
              activeRunId={activeRun?.id ?? null}
              loading={runsLoading}
              runs={runs}
              onRefresh={() => void refreshRuns()}
              onSelect={(run) => {
                setActiveRun(run);
                setPreviewResult(null);
                setError(null);
                if (isLiveRun(run.status)) void refreshRun(run.id);
              }}
            />
          </CardContent>
        </Card>

        <ReportPanel
          activeRun={activeRun}
          result={displayedResult}
          visibleApplied={visibleApplied}
          visibleSkipped={visibleSkipped}
        />
      </div>
    </div>
  );
}

function BackgroundNotice({
  background,
  sweptCount,
}: {
  background: BackgroundStatus | null;
  sweptCount: number;
}) {
  const notice = background ? backgroundNotice(background) : null;
  if (!notice && sweptCount === 0) return null;

  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-[12.5px]",
        notice?.tone === "danger"
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        {notice ? <p className="font-medium">{notice.title}</p> : null}
        {notice ? <p className="mt-0.5 break-words">{notice.detail}</p> : null}
        {sweptCount > 0 ? (
          <p className={notice ? "mt-1 break-words" : "break-words"}>
            {sweptCount.toString()} stale background run{sweptCount === 1 ? "" : "s"} marked failed
            and cleared.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ReportPanel({
  activeRun,
  result,
  visibleApplied,
  visibleSkipped,
}: {
  activeRun: ImportRun | null;
  result: ImportResponse | null;
  visibleApplied: AppliedRow[];
  visibleSkipped: SkippedRow[];
}) {
  if (activeRun && (!activeRun.report || activeRun.status !== "succeeded")) {
    return <RunStatusCard run={activeRun} />;
  }

  if (!result) {
    return (
      <Card className="min-h-[360px]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <DatabaseZap className="size-4 text-neutral-500" />
            <CardTitle>Report</CardTitle>
          </div>
          <CardDescription>No import report yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {["Records", "Writes", "Skipped", "Errors"].map((label) => (
              <Metric key={label} label={label} value="-" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              {result.report.errors.total > 0 ? (
                <AlertTriangle className="size-4 text-red-500" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-500" />
              )}
              <CardTitle>{result.sourceName}</CardTitle>
            </div>
            <CardDescription>
              {result.site.title || "(untitled WordPress site)"}
              {result.site.link ? ` · ${result.site.link}` : ""}
            </CardDescription>
          </div>
          <Badge variant={result.dryRun ? "secondary" : "brand"}>
            {result.dryRun ? "Dry run" : "Database written"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Records" value={result.counts.records} />
          <Metric
            label={result.dryRun ? "Would write" : "Written"}
            value={result.report.applied.total}
          />
          <Metric label="Skipped" value={result.report.skipped.total} />
          <Metric label="Errors" value={result.report.errors.total} tone="danger" />
        </div>

        <ChipGroup title="Record types" values={result.counts.recordsByType} />
        <ChipGroup title="Statuses" values={result.counts.statuses} />

        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <RowsSection title={result.dryRun ? "Planned writes" : "Written rows"}>
            {visibleApplied.length > 0 ? (
              visibleApplied.map((row) => (
                <RowLine
                  key={`${row.collection}:${row.slug}:${row.wpId}`}
                  primary={`${row.collection}/${row.slug}`}
                  secondary={`${row.wpType} #${row.wpId} · ${row.title || "(untitled)"}`}
                />
              ))
            ) : (
              <EmptyLine>No rows.</EmptyLine>
            )}
          </RowsSection>

          <RowsSection title="Skipped">
            {visibleSkipped.length > 0 ? (
              visibleSkipped.map((row) => (
                <RowLine
                  key={`${row.wpType}:${row.slug}:${row.wpId}:${row.reason}`}
                  primary={row.slug || `(wp ${row.wpType} #${row.wpId})`}
                  secondary={row.reason}
                />
              ))
            ) : (
              <EmptyLine>No skips.</EmptyLine>
            )}
          </RowsSection>
        </div>

        {result.report.errors.total > 0 ? (
          <RowsSection title="Errors" tone="danger">
            {result.report.errors.items.map((row) => (
              <RowLine
                key={`${row.wpId}:${row.slug}:${row.message}`}
                primary={row.slug || `wp #${row.wpId}`}
                secondary={row.message}
              />
            ))}
          </RowsSection>
        ) : null}

        <PipelineSummary result={result} />

        {result.report.notes.total > 0 ? (
          <RowsSection title="Notes">
            {result.report.notes.items.map((note) => (
              <RowLine key={note} primary={note} />
            ))}
          </RowsSection>
        ) : null}

        {result.report.logs.total > 0 ? (
          <div className="min-w-0 rounded-lg border border-neutral-200/70 bg-neutral-950 px-3 py-2 text-[11.5px] text-neutral-200 dark:border-neutral-800">
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono">
              {result.report.logs.items.join("\n")}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RunStatusCard({ run }: { run: ImportRun }) {
  const tone =
    run.status === "failed" ? "destructive" : run.status === "succeeded" ? "brand" : "secondary";
  const live = isLiveRun(run.status);

  return (
    <Card className="min-h-[360px]">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              {run.status === "failed" ? (
                <AlertTriangle className="size-4 text-red-500" />
              ) : live ? (
                <Loader2 className="size-4 animate-spin text-[var(--np-color-brand)]" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-500" />
              )}
              <CardTitle>{run.sourceName}</CardTitle>
            </div>
            <CardDescription>
              {formatBytes(run.sourceSize)} · created {formatDateTime(run.createdAt)}
            </CardDescription>
          </div>
          <Badge variant={tone}>{statusLabel(run.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Status" value={statusLabel(run.status)} />
          <Metric label="Started" value={run.startedAt ? formatTime(run.startedAt) : "-"} />
          <Metric label="Finished" value={run.finishedAt ? formatTime(run.finishedAt) : "-"} />
          <Metric label="Job" value={run.jobId ? shortId(run.jobId) : "-"} />
        </div>

        {run.error ? (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{run.error}</span>
          </div>
        ) : null}

        <RowsSection title="Run log">
          {run.logs.length > 0 ? (
            run.logs.map((line) => <RowLine key={line} primary={line} />)
          ) : (
            <EmptyLine>No run log yet.</EmptyLine>
          )}
        </RowsSection>

        {live ? (
          <div className="flex items-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
            <Clock3 className="size-3.5" />
            <span>Polling for updates...</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RunHistory({
  activeRunId,
  loading,
  runs,
  onRefresh,
  onSelect,
}: {
  activeRunId: string | null;
  loading: boolean;
  runs: ImportRun[];
  onRefresh: () => void;
  onSelect: (run: ImportRun) => void;
}) {
  return (
    <div className="grid gap-2 border-t border-neutral-200/70 pt-4 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="size-4 text-neutral-500" />
          <p className="text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
            Recent runs
          </p>
        </div>
        <Button type="button" variant="outline" size="icon" disabled={loading} onClick={onRefresh}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          <span className="sr-only">Refresh import runs</span>
        </Button>
      </div>

      {runs.length > 0 ? (
        <div className="grid gap-2">
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className={cn(
                "flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                activeRunId === run.id
                  ? "border-[var(--np-color-brand)] bg-[var(--np-color-brand)]/5"
                  : "border-neutral-200/70 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900",
              )}
              onClick={() => onSelect(run)}
            >
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">
                  {run.sourceName}
                </span>
                <span className="block truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
                  {formatDateTime(run.createdAt)}
                  {run.jobId ? ` · ${shortId(run.jobId)}` : ""}
                </span>
              </span>
              <Badge variant={statusVariant(run.status)}>{statusLabel(run.status)}</Badge>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-200/80 px-3 py-3 text-[12px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          No background runs yet.
        </p>
      )}
    </div>
  );
}

function PipelineSummary({ result }: { result: ImportResponse }) {
  const rows = [
    {
      label: "Media",
      value:
        result.report.media.status === "completed"
          ? `${result.report.media.uploaded} uploaded, ${result.report.media.reused} reused, ${result.report.media.skipped} skipped`
          : "Not run",
      errorCount: result.report.media.errors.total,
    },
    {
      label: "Taxonomies",
      value:
        result.report.taxonomies.status === "completed"
          ? `${result.report.taxonomies.resolved} resolved`
          : "Not run",
      errorCount: result.report.taxonomies.errors.total,
    },
    {
      label: "Comments",
      value:
        result.report.comments.status === "completed"
          ? `${result.report.comments.applied} imported`
          : "Not run",
      errorCount: result.report.comments.errors.total,
    },
    {
      label: "Authors",
      value:
        result.report.authors.status === "completed"
          ? `${result.report.authors.resolved} resolved`
          : "Not run",
      errorCount: result.report.authors.errors.total,
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((row) => (
        <div
          key={row.label}
          className="min-w-0 rounded-lg border border-neutral-200/70 px-3 py-2 dark:border-neutral-800"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
              {row.label}
            </p>
            {row.errorCount > 0 ? (
              <Badge variant="destructive">{row.errorCount}</Badge>
            ) : (
              <Badge variant="secondary">OK</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-[12px] text-neutral-500 dark:text-neutral-400">
            {row.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function OptionSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-neutral-200/70 px-3 py-2 dark:border-neutral-800">
      <Label className="min-w-0 text-[13px] text-neutral-700 dark:text-neutral-300">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "danger";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-neutral-200/70 px-3 py-2 dark:border-neutral-800">
      <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-[22px] font-semibold leading-none tracking-[-0.02em]",
          tone === "danger" && Number(value) > 0
            ? "text-red-600 dark:text-red-300"
            : "text-neutral-950 dark:text-neutral-50",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ChipGroup({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
        {title}
      </span>
      {entries.map(([key, count]) => (
        <Badge key={key} variant="secondary">
          {key} {count}
        </Badge>
      ))}
    </div>
  );
}

function RowsSection({
  title,
  tone = "default",
  children,
}: {
  title: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-neutral-200/70 dark:border-neutral-800",
        tone === "danger" &&
          "border-red-200 bg-red-50/50 dark:border-red-500/30 dark:bg-red-500/10",
      )}
    >
      <div className="border-b border-neutral-200/70 px-3 py-2 dark:border-neutral-800">
        <p className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">{title}</p>
      </div>
      <div className="max-h-64 overflow-auto">{children}</div>
    </div>
  );
}

function RowLine({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <div className="min-w-0 border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-900">
      <p className="truncate text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">
        {primary}
      </p>
      {secondary ? (
        <p className="mt-0.5 break-words text-[12px] text-neutral-500 dark:text-neutral-400">
          {secondary}
        </p>
      ) : null}
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-3 py-3 text-[12px] text-neutral-500 dark:text-neutral-400">{children}</p>;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function optionsKey(options: OptionsState): string {
  return [
    options.update ? "update" : "no-update",
    options.strict ? "strict" : "soft",
    options.createAuthors ? "authors" : "no-authors",
    options.includeMedia ? "media" : "no-media",
  ].join(":");
}

function upsertRun(runs: ImportRun[], run: ImportRun): ImportRun[] {
  return [run, ...runs.filter((item) => item.id !== run.id)].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function isLiveRun(status: ImportRunStatus): boolean {
  return status === "queued" || status === "running";
}

function statusLabel(status: ImportRunStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
  }
}

function statusVariant(status: ImportRunStatus): "destructive" | "brand" | "secondary" {
  if (status === "failed") return "destructive";
  if (status === "succeeded") return "brand";
  return "secondary";
}

function backgroundNotice(background: BackgroundStatus): {
  title: string;
  detail: string;
  tone: "warn" | "danger";
} | null {
  switch (background.state) {
    case "ready":
      return null;
    case "disabled":
      return {
        title: "Background jobs are disabled",
        detail: "Set NP_ENABLE_JOBS=1 on the web runtime and run a worker before applying imports.",
        tone: "danger",
      };
    case "paused":
      return {
        title: "Background jobs are paused",
        detail: "Resume processing from /admin/jobs before applying imports.",
        tone: "danger",
      };
    case "no-workers":
      return {
        title: "No worker heartbeat yet",
        detail: "Start a worker with NP_ENABLE_JOBS=1 pnpm run worker so queued imports can drain.",
        tone: "warn",
      };
    case "stale-workers":
      return {
        title: "No live workers",
        detail: `${background.workerTotalCount.toString()} worker heartbeat${
          background.workerTotalCount === 1 ? " is" : "s are"
        } registered, but none are alive. Restart the worker process.`,
        tone: "danger",
      };
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
