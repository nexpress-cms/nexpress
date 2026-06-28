"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, RotateCcw } from "lucide-react";

import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { npFetch } from "../lib/api-client.js";
import {
  diffSnapshotFields,
  formatRevisionDate,
  summarizeSnapshotValue,
  type RevisionDetail,
  type RevisionSummary,
} from "./revision-utils.js";

interface RevisionsPanelProps {
  collectionSlug: string;
  documentId: string;
  currentSnapshot?: Record<string, unknown>;
  hasUnsavedChanges?: boolean;
  formatFieldLabel?: (path: string) => string;
}

type PanelState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; revisions: RevisionSummary[]; total: number }
  | { kind: "error"; message: string };

type ToastState = { type: "success" | "error"; message: string } | null;

const statusBadgeClass: Record<RevisionSummary["status"], string> = {
  published: "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  draft: "bg-amber-500/15 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  autosave: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

export function RevisionsPanel({
  collectionSlug,
  documentId,
  currentSnapshot,
  hasUnsavedChanges = false,
  formatFieldLabel = (path) => path,
}: RevisionsPanelProps) {
  const router = useRouter();
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [selected, setSelected] = useState<RevisionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const selectedDiffFields = useMemo(() => {
    if (!selected || !currentSnapshot || loadingDetail) return [];
    return diffSnapshotFields(currentSnapshot, selected.snapshot);
  }, [currentSnapshot, loadingDetail, selected]);
  const selectedSnapshotEntries = useMemo(() => {
    if (!selected || loadingDetail) return [];
    return Object.entries(selected.snapshot).sort(([a], [b]) => a.localeCompare(b));
  }, [loadingDetail, selected]);

  const loadRevisions = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await npFetch(
        `/api/collections/${collectionSlug}/${documentId}/revisions?limit=50`,
      );
      if (!response.ok) {
        throw new Error("Failed to load revisions.");
      }
      const payload = (await response.json()) as {
        revisions: RevisionSummary[];
        total: number;
      };
      setState({
        kind: "ready",
        revisions: payload.revisions ?? [],
        total: payload.total ?? 0,
      });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [collectionSlug, documentId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadRevisions();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadRevisions]);

  const handleOpenDetail = async (revision: RevisionSummary) => {
    setLoadingDetail(true);
    setSelected({ ...revision, snapshot: {} });
    try {
      const response = await npFetch(
        `/api/collections/${collectionSlug}/${documentId}/revisions/${revision.id}`,
      );
      if (!response.ok) {
        throw new Error("Failed to load revision details.");
      }
      const detail = (await response.json()) as RevisionDetail;
      setSelected(detail);
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRestore = async (revision: RevisionSummary) => {
    const message = hasUnsavedChanges
      ? `Restore version ${revision.version}? This creates a new revision and replaces unsaved edits in the form.`
      : `Restore version ${revision.version}? This creates a new revision.`;
    if (!window.confirm(message)) {
      return;
    }

    setRestoringId(revision.id);
    setToast(null);

    try {
      const response = await npFetch(
        `/api/collections/${collectionSlug}/${documentId}/revisions/${revision.id}/restore`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error("Failed to restore revision.");
      }

      setToast({ type: "success", message: `Restored version ${revision.version}.` });
      setSelected(null);
      await loadRevisions();
      router.refresh();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Card className="min-w-0" data-np-revisions-panel>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-center gap-2">
          <History className="h-5 w-5 shrink-0 text-muted-foreground" />
          <CardTitle className="break-words">Revision history</CardTitle>
        </div>
        {state.kind === "ready" ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {state.total} {state.total === 1 ? "version" : "versions"}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {toast ? (
          <div
            className={
              toast.type === "success"
                ? "break-words rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-200"
                : "break-words rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-700 dark:text-rose-200"
            }
          >
            {toast.message}
          </div>
        ) : null}

        {state.kind === "loading" || state.kind === "idle" ? (
          <div className="flex min-w-0 items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            Loading revisions…
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="break-words rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            {state.message}
          </div>
        ) : null}

        {state.kind === "ready" && state.revisions.length === 0 ? (
          <p className="break-words py-6 text-sm text-muted-foreground">
            No revisions yet. Saves to this document will appear here.
          </p>
        ) : null}

        {state.kind === "ready" && state.revisions.length > 0 ? (
          <ScrollArea className="max-h-96 pr-2">
            <ul className="min-w-0 space-y-2">
              {state.revisions.map((revision) => (
                <li
                  key={revision.id}
                  className="flex flex-col gap-2 rounded-xl border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <button
                    type="button"
                    onClick={() => {
                      void handleOpenDetail(revision);
                    }}
                    className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="break-words font-medium">v{revision.version}</span>
                      <Badge className={statusBadgeClass[revision.status]} variant="secondary">
                        {revision.status}
                      </Badge>
                    </div>
                    <span className="max-w-full break-words text-xs text-muted-foreground">
                      {formatRevisionDate(revision.createdAt)}
                      {revision.changedFields.length > 0 ? (
                        <>
                          {" · "}
                          {revision.changedFields.slice(0, 4).map(formatFieldLabel).join(", ")}
                          {revision.changedFields.length > 4 ? "…" : ""}
                        </>
                      ) : null}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      void handleRestore(revision);
                    }}
                    disabled={restoringId !== null}
                  >
                    {restoringId === revision.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : null}
      </CardContent>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="min-w-0 max-w-3xl">
          <DialogHeader>
            <DialogTitle className="break-words">
              {selected ? `Version ${selected.version}` : "Revision"}
            </DialogTitle>
            <DialogDescription className="break-words">
              {selected ? formatRevisionDate(selected.createdAt) : null}
              {selected && selected.changedFields.length > 0 ? (
                <>
                  {" · Changed: "}
                  {selected.changedFields.map(formatFieldLabel).join(", ")}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {!loadingDetail && selected && currentSnapshot ? (
            <div
              className="min-w-0 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm"
              data-np-revision-diff
            >
              <p className="break-words font-medium text-foreground">Compared with current form</p>
              {selectedDiffFields.length > 0 ? (
                <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                  {selectedDiffFields.slice(0, 12).map((field) => (
                    <Badge
                      key={field}
                      variant="secondary"
                      className="max-w-full break-words"
                      title={field}
                    >
                      {formatFieldLabel(field)}
                    </Badge>
                  ))}
                  {selectedDiffFields.length > 12 ? (
                    <Badge variant="secondary">+{selectedDiffFields.length - 12} more</Badge>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 break-words text-muted-foreground">
                  This revision matches the current form values.
                </p>
              )}
            </div>
          ) : null}
          <div
            className="min-w-0 rounded-xl border border-border/70 bg-background px-4 py-3 text-sm"
            data-np-revision-snapshot-summary
          >
            {loadingDetail ? (
              <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Loading snapshot…
              </div>
            ) : selected ? (
              <>
                <p className="break-words font-medium text-foreground">Snapshot summary</p>
                <dl className="mt-3 grid min-w-0 gap-2">
                  {selectedSnapshotEntries.slice(0, 16).map(([field, value]) => (
                    <div
                      key={field}
                      className="grid min-w-0 gap-1 rounded-lg bg-muted/40 px-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]"
                    >
                      <dt className="break-words text-xs font-medium text-muted-foreground">
                        {formatFieldLabel(field)}
                      </dt>
                      <dd className="min-w-0 break-words text-xs text-foreground">
                        {summarizeSnapshotValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {selectedSnapshotEntries.length > 16 ? (
                  <p className="mt-2 break-words text-xs text-muted-foreground">
                    +{(selectedSnapshotEntries.length - 16).toString()} more fields in raw snapshot.
                  </p>
                ) : null}
                <details className="mt-3 min-w-0">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Raw snapshot
                  </summary>
                  <div className="mt-2 max-h-[36vh] min-w-0 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                    <pre className="whitespace-pre-wrap break-words font-mono">
                      {JSON.stringify(selected.snapshot, null, 2)}
                    </pre>
                  </div>
                </details>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setSelected(null)}
            >
              Close
            </Button>
            {selected ? (
              <Button
                type="button"
                onClick={() => {
                  void handleRestore(selected);
                }}
                disabled={restoringId !== null}
                className="w-full sm:w-auto"
              >
                {restoringId === selected.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                Restore this version
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
