"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  npRequireJobLogsWire,
  type NpJobLogsWire,
  type NpJobLogWireEntry,
} from "@nexpress/core/jobs-contract";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";

const PAGE_SIZE = 500;
const MAX_OFFSET = 100_000;
type JobLogEntry = NpJobLogWireEntry;
type LogResult = { key: string } & (
  { kind: "loaded"; data: NpJobLogsWire } | { kind: "error"; message: string }
);

/** One bounded page, fetched only on explicit open, navigation, or refresh. */
export function JobLogsSection({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState({ offset: 0, revision: 0 });
  const [result, setResult] = useState<LogResult | null>(null);
  const { offset, revision } = request;
  const key = JSON.stringify([jobId, offset, revision]);
  const current = open && result?.key === key ? result : null;
  const loading = open && current === null;
  const data = current?.kind === "loaded" ? current.data : null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const response = await npFetch(
          `/api/admin/jobs/${encodeURIComponent(jobId)}/logs?limit=${PAGE_SIZE}&offset=${offset}`,
          { signal },
        );
        if (!response.ok) {
          if (!signal.aborted)
            setResult({
              key,
              kind: "error",
              message:
                response.status === 401 || response.status === 403
                  ? "Access to these logs is unavailable."
                  : "Unable to load logs.",
            });
          return;
        }
        const data = npRequireJobLogsWire(await response.json());
        if (data.jobId !== jobId || data.entries.length > PAGE_SIZE) {
          throw new Error("Invalid job log page");
        }
        if (!signal.aborted) setResult({ key, kind: "loaded", data });
      } catch {
        if (!signal.aborted) setResult({ key, kind: "error", message: "Unable to load logs." });
      }
    })();
    return () => controller.abort();
  }, [open, jobId, offset, revision, key]);

  function requestPage(nextOffset: number) {
    setRequest((previous) => ({ offset: nextOffset, revision: previous.revision + 1 }));
  }

  return (
    <details
      className="min-w-0 text-[11px]"
      open={open}
      onToggle={(event) => {
        const nowOpen = event.currentTarget.open;
        if (nowOpen === open) return;
        setOpen(nowOpen);
        if (!nowOpen) requestPage(0);
      }}
    >
      <summary className="inline-flex min-h-10 cursor-pointer items-center break-words text-muted-foreground hover:text-foreground sm:min-h-0">
        Logs
      </summary>
      {open ? (
        <div className="mt-1 min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-10"
              disabled={loading}
              onClick={() => requestPage(0)}
            >
              Refresh logs
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-10"
              disabled={loading || offset === 0}
              onClick={() => requestPage(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous logs
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-10"
              disabled={
                loading ||
                !data ||
                data.entries.length < PAGE_SIZE ||
                offset + PAGE_SIZE >= data.total ||
                offset >= MAX_OFFSET
              }
              onClick={() => requestPage(offset + PAGE_SIZE)}
            >
              Next logs
            </Button>
          </div>
          {loading ? (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/10 p-3 text-muted-foreground"
            >
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              Loading logs…
            </div>
          ) : current?.kind === "error" ? (
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p role="alert" className="break-words text-destructive">
                {current.message}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="min-h-10"
                onClick={() => requestPage(offset)}
              >
                Retry logs
              </Button>
            </div>
          ) : data ? (
            <>
              <p role="status" className="break-words text-muted-foreground">
                {data.entries.length > 0
                  ? `Entries ${offset + 1}–${offset + data.entries.length} · ${data.total} reported total`
                  : `No entries returned on this page · ${data.total} reported total`}
              </p>
              <p className="break-words text-muted-foreground">
                Oldest first, up to 500 per page. New logs and retention can change pages and
                counts. Refresh logs returns to the first page.
              </p>
              {offset === MAX_OFFSET && offset + data.entries.length < data.total ? (
                <p className="break-words text-muted-foreground">
                  The log navigation limit has been reached.
                </p>
              ) : null}
              {data.entries.length === 0 ? (
                <p className="rounded-lg border border-border/60 bg-muted/10 p-3 text-muted-foreground">
                  {data.total === 0
                    ? "No log entries for this job."
                    : "Refresh logs or go to the previous page."}
                </p>
              ) : (
                <ol className="max-h-64 min-w-0 space-y-1 overflow-auto rounded-lg border border-border/60 bg-muted/10 p-3 font-mono text-[11px]">
                  {data.entries.map((entry) => (
                    <li key={entry.id} className="flex min-w-0 flex-wrap items-baseline gap-2">
                      <time dateTime={entry.createdAt} className="opacity-60">
                        {formatLogTime(entry.createdAt)}
                      </time>
                      <LogLevelBadge level={entry.level} />
                      <span className="min-w-0 whitespace-pre-wrap break-words">
                        {entry.message}
                      </span>
                      {entry.context && Object.keys(entry.context).length > 0 ? (
                        <details className="ml-0 min-w-0 w-full sm:ml-6">
                          <summary className="inline-flex min-h-10 cursor-pointer items-center opacity-70 hover:opacity-100 sm:min-h-0">
                            context
                          </summary>
                          <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words rounded border border-border/40 bg-background/40 p-2 text-[10px]">
                            {JSON.stringify(entry.context, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

const LOG_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
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
        ? "bg-amber-500/15 text-amber-900 dark:text-amber-100"
        : level === "debug"
          ? "bg-muted text-muted-foreground"
          : "bg-blue-50 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
      {level}
    </span>
  );
}
