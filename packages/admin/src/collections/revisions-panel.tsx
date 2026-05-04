"use client";

import { useCallback, useEffect, useState } from "react";
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
import { nxFetch } from "../lib/api-client.js";

interface RevisionsPanelProps {
  collectionSlug: string;
  documentId: string;
}

interface RevisionSummary {
  id: string;
  version: number;
  status: "draft" | "published" | "autosave";
  changedFields: string[];
  authorId: string | null;
  createdAt: string;
}

interface RevisionDetail extends RevisionSummary {
  snapshot: Record<string, unknown>;
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

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function RevisionsPanel({ collectionSlug, documentId }: RevisionsPanelProps) {
  const router = useRouter();
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [selected, setSelected] = useState<RevisionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const loadRevisions = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await nxFetch(
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
    void loadRevisions();
  }, [loadRevisions]);

  const handleOpenDetail = async (revision: RevisionSummary) => {
    setLoadingDetail(true);
    setSelected({ ...revision, snapshot: {} });
    try {
      const response = await nxFetch(
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
    if (!window.confirm(`Restore version ${revision.version}? This creates a new revision.`)) {
      return;
    }

    setRestoringId(revision.id);
    setToast(null);

    try {
      const response = await nxFetch(
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Revision history</CardTitle>
        </div>
        {state.kind === "ready" ? (
          <span className="text-xs text-muted-foreground">
            {state.total} {state.total === 1 ? "version" : "versions"}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {toast ? (
          <div
            className={
              toast.type === "success"
                ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-200"
                : "rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-700 dark:text-rose-200"
            }
          >
            {toast.message}
          </div>
        ) : null}

        {state.kind === "loading" || state.kind === "idle" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading revisions…
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            {state.message}
          </div>
        ) : null}

        {state.kind === "ready" && state.revisions.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No revisions yet. Saves to this document will appear here.
          </p>
        ) : null}

        {state.kind === "ready" && state.revisions.length > 0 ? (
          <ScrollArea className="max-h-96 pr-2">
            <ul className="space-y-2">
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
                    className="flex flex-1 flex-col items-start gap-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">v{revision.version}</span>
                      <Badge className={statusBadgeClass[revision.status]} variant="secondary">
                        {revision.status}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(revision.createdAt)}
                      {revision.changedFields.length > 0 ? (
                        <>
                          {" · "}
                          {revision.changedFields.slice(0, 4).join(", ")}
                          {revision.changedFields.length > 4 ? "…" : ""}
                        </>
                      ) : null}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void handleRestore(revision);
                    }}
                    disabled={restoringId !== null}
                  >
                    {restoringId === revision.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-2 h-4 w-4" />
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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selected ? `Version ${selected.version}` : "Revision"}
            </DialogTitle>
            <DialogDescription>
              {selected ? formatDate(selected.createdAt) : null}
              {selected && selected.changedFields.length > 0 ? (
                <>
                  {" · Changed: "}
                  {selected.changedFields.join(", ")}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading snapshot…
              </div>
            ) : selected ? (
              <pre className="whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(selected.snapshot, null, 2)}
              </pre>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
            {selected ? (
              <Button
                type="button"
                onClick={() => {
                  void handleRestore(selected);
                }}
                disabled={restoringId !== null}
              >
                {restoringId === selected.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
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
