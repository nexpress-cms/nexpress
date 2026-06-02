"use client";

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
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

export interface ReportRow {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolvedByMemberId: string | null;
  resolution: string | null;
  createdAt: string;
}

type StatusFilter = "unresolved" | "resolved" | "all";

const STATUS_LABELS: Record<StatusFilter, string> = {
  unresolved: "Unresolved",
  resolved: "Resolved",
  all: "All",
};

/**
 * Mod-side report queue. Read-only on first paint then mutates via the
 * staff-CSRF-protected resolve endpoint. The actual moderation action
 * (hide / ban / etc.) is a separate call — `resolve` only marks the
 * report row and writes an audit entry.
 */
export function ReportsQueueView() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("unresolved");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<ReportRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, limit: "50" });
      const res = await npFetch(`/api/admin/community/reports?${params.toString()}`);
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        const message = extractErrorMessage(raw) ?? `HTTP ${res.status}`;
        throw new Error(message);
      }
      const docs = Array.isArray(raw.docs) ? (raw.docs as ReportRow[]) : [];
      setReports(docs);
      setTotalDocs(typeof raw.totalDocs === "number" ? raw.totalDocs : docs.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
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
        description="Member-filed reports against comments, members, and other community content. Resolving a report flips its row and writes an audit entry — take any follow-up action (hide / ban) separately."
      />

      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Queue</CardTitle>
          <div className="grid min-w-0 gap-1 sm:flex sm:items-center sm:gap-2">
            <Label className="min-w-0 text-xs uppercase tracking-wide text-muted-foreground">
              Status
            </Label>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
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
                      <p className="break-words font-medium">{report.targetType}</p>
                      <p className="break-all font-mono text-xs text-muted-foreground">
                        {report.targetId}
                      </p>
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
                        <div className="break-words font-medium">{report.targetType}</div>
                        <div className="break-all font-mono text-xs text-muted-foreground">
                          {report.targetId}
                        </div>
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
  const [resolution, setResolution] = useState("dismissed");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!resolution.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await npFetch(`/api/admin/community/reports/${report.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
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
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="min-w-0" data-np-report-resolve-dialog>
        <DialogHeader>
          <DialogTitle>Resolve report</DialogTitle>
          <DialogDescription className="break-words">
            Free-form label that tells future moderators what action you took. Common values:{" "}
            <code>hidden</code>, <code>banned</code>, <code>dismissed</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Reason</div>
            <div className="mt-1 whitespace-pre-wrap break-words">{report.reason}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="resolution">Resolution label</Label>
            <Input
              id="resolution"
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="hidden / banned / dismissed"
              maxLength={120}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || !resolution.trim()}>
            {submitting ? "Resolving…" : "Resolve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
