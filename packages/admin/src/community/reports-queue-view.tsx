"use client";

import {
  npRequireModerationReportPageWire,
  type NpModerationReportWireRow,
  type NpReportResolutionAction,
  type NpReportStatus,
} from "@nexpress/core/community-contract";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { PageHeader } from "../layout/page-header.js";
import { StatusBadge } from "../ui/status-badge.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Label } from "../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

export type ReportRow = NpModerationReportWireRow;
type StatusFilter = NpReportStatus;

const STATUS_LABELS: Record<StatusFilter, string> = {
  unresolved: "Unresolved",
  resolved: "Resolved",
  all: "All",
};

/**
 * Mod-side report queue with validated target context and one closed action
 * contract. Resolving can dismiss, hide a comment, or unpublish a document;
 * the server rejects actions that do not match the target kind.
 */
export function ReportsQueueView() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("unresolved");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<ReportRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, limit: "50", page: page.toString() });
      const res = await npFetch(`/api/admin/community/reports?${params.toString()}`);
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        const message = extractErrorMessage(raw) ?? `HTTP ${res.status}`;
        throw new Error(message);
      }
      const pageResult = npRequireModerationReportPageWire(raw);
      if (page > 1 && pageResult.docs.length === 0 && page > pageResult.totalPages) {
        setPage(Math.max(1, pageResult.totalPages));
        return;
      }
      setReports(pageResult.docs);
      setTotalDocs(pageResult.totalDocs);
      setTotalPages(pageResult.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void refresh();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [refresh]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="min-w-0">Reports</span>
            <Badge variant="secondary">{totalDocs}</Badge>
          </span>
        }
        description="Review the reported target in context, then dismiss it or apply the target's supported moderation action. Every resolution is validated and audited by the server."
      />

      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Queue</CardTitle>
          <div className="grid min-w-0 gap-1 sm:flex sm:items-center sm:gap-2">
            <Label className="min-w-0 text-xs uppercase tracking-wide text-muted-foreground">
              Status
            </Label>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as StatusFilter);
                setPage(1);
              }}
            >
              <SelectTrigger className="min-w-0 sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {STATUS_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3">
          {error ? (
            <div className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="space-y-3 md:hidden">
            {loading ? (
              <div className="rounded-xl border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : reports.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                No reports.
              </div>
            ) : (
              reports.map((report) => (
                <div
                  key={report.id}
                  className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <ReportTarget report={report} />
                    </div>
                    {report.resolvedAt ? (
                      <span className="shrink-0">
                        <StatusBadge status={report.resolution ?? "resolved"} />
                      </span>
                    ) : (
                      <span className="shrink-0">
                        <StatusBadge status="open" />
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Reason
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm">{report.reason}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Filed {new Date(report.createdAt).toLocaleString()}
                  </p>
                  {report.resolvedAt ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-10 w-full sm:min-h-0"
                      onClick={() => setResolving(report)}
                    >
                      Resolve
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-border/60 md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-neutral-50/60 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:bg-neutral-900/40 dark:text-neutral-400">
                <tr>
                  <th className="h-9 px-3.5 font-medium">Target</th>
                  <th className="h-9 px-3.5 font-medium">Reason</th>
                  <th className="h-9 px-3.5 font-medium">Filed</th>
                  <th className="h-9 px-3.5 font-medium">Status</th>
                  <th className="h-9 px-3.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : reports.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      No reports.
                    </td>
                  </tr>
                ) : (
                  reports.map((report) => (
                    <tr key={report.id} className="border-t border-border/60 align-top">
                      <td className="px-4 py-3">
                        <ReportTarget report={report} />
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <span className="line-clamp-3 whitespace-pre-wrap break-words">
                          {report.reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(report.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {report.resolvedAt ? (
                          <StatusBadge status={report.resolution ?? "resolved"} />
                        ) : (
                          <StatusBadge status="open" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {report.resolvedAt ? null : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-10 sm:min-h-0"
                            onClick={() => setResolving(report)}
                          >
                            Resolve
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading || page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading || page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {resolving ? (
        <ResolveDialog
          report={resolving}
          onClose={() => setResolving(null)}
          onResolved={() => {
            setResolving(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

interface ResolveDialogProps {
  report: ReportRow;
  onClose: () => void;
  onResolved: () => void;
}

function ResolveDialog({ report, onClose, onResolved }: ResolveDialogProps) {
  const [action, setAction] = useState<NpReportResolutionAction>("dismiss");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await npFetch(`/api/admin/community/reports/${report.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        throw new Error(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
      }
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !submitting ? onClose() : undefined)}>
      <DialogContent className="min-w-0" data-np-report-resolve-dialog>
        <DialogHeader>
          <DialogTitle>Resolve report</DialogTitle>
          <DialogDescription className="break-words">
            Choose one supported action. The target change and report resolution are handled by the
            same server contract.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Reason</div>
            <div className="mt-1 whitespace-pre-wrap break-words">{report.reason}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-action">Action</Label>
            <Select
              value={action}
              onValueChange={(value) => setAction(value as NpReportResolutionAction)}
              disabled={submitting}
            >
              <SelectTrigger id="report-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dismiss">Dismiss without changing the target</SelectItem>
                {report.target.kind === "comment" ? (
                  <SelectItem value="hide-comment">Hide comment</SelectItem>
                ) : null}
                {report.target.kind === "document" &&
                (report.target.status === "published" || report.target.status === "pending") ? (
                  <SelectItem value="unpublish-document">Unpublish document for review</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Resolving…" : "Resolve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportTarget({ report }: { report: ReportRow }) {
  const content = (
    <>
      <span className="block break-words font-medium">{report.target.label}</span>
      <span className="block break-words text-xs text-muted-foreground">
        {report.target.kind === "missing"
          ? "Target no longer resolves"
          : `${report.targetType} · ${report.target.status ?? "unknown status"}`}
      </span>
      {report.target.excerpt ? (
        <span className="mt-1 block line-clamp-2 break-words text-xs text-muted-foreground">
          {report.target.excerpt}
        </span>
      ) : null}
    </>
  );
  return report.target.href ? (
    <Link
      className="block rounded-sm hover:underline focus-visible:outline-none"
      href={report.target.href}
    >
      {content}
    </Link>
  ) : (
    <div>{content}</div>
  );
}

function extractErrorMessage(raw: Record<string, unknown> | null): string | null {
  if (!raw || typeof raw !== "object") return null;
  const err = (raw as { error?: unknown }).error;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    return typeof msg === "string" ? msg : null;
  }
  return null;
}
