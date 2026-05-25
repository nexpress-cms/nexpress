"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { PageHeader } from "../layout/page-header.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";

export interface PendingDocRow {
  id: string;
  collectionSlug: string;
  title: string;
  slug: string | null;
  status: "pending";
  createdAt: string;
  memberAuthor: {
    id: string;
    handle: string;
    displayName: string;
  } | null;
}

/**
 * Cross-collection moderation queue for `pending` member-authored
 * docs. Approve flips the row to `published` (calls the 9.7d
 * `/promote` endpoint). Reject deletes the row (DELETE on the
 * existing per-doc endpoint). Both actions refresh the list and
 * record audit events server-side.
 */
export function PendingQueueView() {
  const [rows, setRows] = useState<PendingDocRow[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<{
    row: PendingDocRow;
    verb: "approve" | "reject";
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Phase: bulk approve / reject. Selection is keyed by
  // `${collectionSlug}:${id}` because the queue is cross-
  // collection — a `discussions` row and a `pages` row could
  // share an id by coincidence.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<"approve" | "reject" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await npFetch("/api/admin/collections/pending?limit=100");
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
        return;
      }
      const data = (raw.data ?? raw) as { docs?: unknown; totalDocs?: number };
      const docs = Array.isArray(data.docs) ? (data.docs as PendingDocRow[]) : [];
      setRows(docs);
      setTotalDocs(typeof data.totalDocs === "number" ? data.totalDocs : docs.length);
    } catch {
      setError("Unable to load pending queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function handleAction() {
    if (!actingOn) return;
    setSubmitting(true);
    setError(null);
    try {
      const { row, verb } = actingOn;
      const url =
        verb === "approve"
          ? `/api/admin/collections/${row.collectionSlug}/${row.id}/promote`
          : `/api/collections/${row.collectionSlug}/${row.id}`;
      const method = verb === "approve" ? "POST" : "DELETE";
      const res = await npFetch(url, { method });
      if (!res.ok) {
        const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
        return;
      }
      setMessage(verb === "approve" ? "Approved." : "Rejected.");
      setActingOn(null);
      await refresh();
    } catch {
      setError("Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function rowKey(row: PendingDocRow): string {
    return `${row.collectionSlug}:${row.id}`;
  }

  function toggleOne(row: PendingDocRow): void {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll(): void {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map(rowKey)));
    }
  }

  async function runBulk(verb: "approve" | "reject"): Promise<void> {
    if (selected.size === 0) return;
    setBulkBusy(verb);
    setError(null);
    setMessage(null);

    // Fan out per-row. The existing per-doc endpoints
    // already record audit events, fire reputation deltas,
    // and revalidate caches; running them in a loop preserves
    // every side-effect a single-row click would trigger.
    // Sequenced (not Promise.all) so a failure halfway
    // through doesn't cascade — each row's outcome is
    // independent.
    const targets = rows.filter((r) => selected.has(rowKey(r)));
    let ok = 0;
    let fail = 0;
    for (const row of targets) {
      const url =
        verb === "approve"
          ? `/api/admin/collections/${row.collectionSlug}/${row.id}/promote`
          : `/api/collections/${row.collectionSlug}/${row.id}`;
      const method = verb === "approve" ? "POST" : "DELETE";
      try {
        const res = await npFetch(url, { method });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }

    setMessage(
      fail === 0
        ? `${verb === "approve" ? "Approved" : "Rejected"} ${ok} item${ok === 1 ? "" : "s"}.`
        : `${ok} ${verb}d, ${fail} failed.`,
    );
    setSelected(new Set());
    setBulkBusy(null);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            Pending review
            <Badge variant="secondary">{totalDocs}</Badge>
          </span>
        }
        description={
          <>
            Member-authored documents that landed in the moderation queue — either because the
            collection sets{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              defaultStatus: &quot;pending&quot;
            </code>{" "}
            or because the spam adapter flagged them. Approve to publish; reject to delete.
          </>
        }
      />

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm sm:flex sm:items-center sm:justify-between">
          <span>
            <strong>{selected.size}</strong> selected
          </span>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => void runBulk("approve")}
              disabled={bulkBusy !== null}
            >
              {bulkBusy === "approve" ? "Approving…" : "Approve all"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-destructive hover:text-destructive sm:w-auto"
              onClick={() => void runBulk("reject")}
              disabled={bulkBusy !== null}
            >
              {bulkBusy === "reject" ? "Rejecting…" : "Reject all"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="col-span-2 w-full sm:col-span-1 sm:w-auto"
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy !== null}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
            {loading ? (
              <div className="rounded-xl border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing pending review.
              </div>
            ) : (
              rows.map((row) => (
                <div
                  key={rowKey(row)}
                  className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.title}`}
                      checked={selected.has(rowKey(row))}
                      onChange={() => toggleOne(row)}
                      disabled={bulkBusy !== null}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link
                        href={`/admin/collections/${row.collectionSlug}/${row.id}`}
                        className="block truncate font-medium underline-offset-4 hover:underline"
                      >
                        {row.title}
                      </Link>
                      {row.slug ? (
                        <p className="break-all font-mono text-xs text-muted-foreground">
                          /{row.slug}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant="secondary" className="max-w-[7rem] shrink-0 truncate font-mono">
                      {row.collectionSlug}
                    </Badge>
                  </div>
                  <dl className="grid gap-2 text-sm">
                    <div className="grid gap-0.5">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Author
                      </dt>
                      <dd>
                        {row.memberAuthor ? (
                          <>
                            <Link
                              href={`/admin/members/${row.memberAuthor.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              @{row.memberAuthor.handle}
                            </Link>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {row.memberAuthor.displayName}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground italic">deleted member</span>
                        )}
                      </dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Submitted
                      </dt>
                      <dd className="text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString()}
                      </dd>
                    </div>
                  </dl>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActingOn({ row, verb: "approve" })}
                      disabled={submitting}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setActingOn({ row, verb: "reject" })}
                      disabled={submitting}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-border/60 md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-neutral-50/60 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:bg-neutral-900/40 dark:text-neutral-400">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={rows.length > 0 && selected.size === rows.length}
                      onChange={toggleAll}
                      disabled={loading || rows.length === 0}
                    />
                  </th>
                  <th className="h-9 px-3.5 font-medium">Title</th>
                  <th className="h-9 px-3.5 font-medium">Collection</th>
                  <th className="h-9 px-3.5 font-medium">Author</th>
                  <th className="h-9 px-3.5 font-medium">Submitted</th>
                  <th className="h-9 px-3.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      Nothing pending review.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={rowKey(row)} className="border-t border-border/60 align-top">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.title}`}
                          checked={selected.has(rowKey(row))}
                          onChange={() => toggleOne(row)}
                          disabled={bulkBusy !== null}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/collections/${row.collectionSlug}/${row.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {row.title}
                        </Link>
                        {row.slug ? (
                          <div className="mt-1 font-mono text-xs text-muted-foreground">
                            /{row.slug}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="font-mono">
                          {row.collectionSlug}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {row.memberAuthor ? (
                          <Link
                            href={`/admin/members/${row.memberAuthor.id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            @{row.memberAuthor.handle}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground italic">deleted member</span>
                        )}
                        {row.memberAuthor ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.memberAuthor.displayName}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActingOn({ row, verb: "approve" })}
                            disabled={submitting}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setActingOn({ row, verb: "reject" })}
                            disabled={submitting}
                          >
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {actingOn ? (
        <Dialog open onOpenChange={(open) => !open && setActingOn(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {actingOn.verb === "approve" ? "Approve" : "Reject"}
                {": "}
                {actingOn.row.title}
              </DialogTitle>
              <DialogDescription>
                {actingOn.verb === "approve"
                  ? "Publish this thread and credit the author's reputation. The doc becomes visible on the public site immediately."
                  : "Delete this thread. The author can re-create with a fresh submission. This action is recorded in the audit log."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setActingOn(null)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={actingOn.verb === "reject" ? "destructive" : "default"}
                onClick={() => void handleAction()}
                disabled={submitting}
              >
                {submitting
                  ? actingOn.verb === "approve"
                    ? "Approving…"
                    : "Rejecting…"
                  : actingOn.verb === "approve"
                    ? "Approve"
                    : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function extractErrorMessage(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const err = raw.error as Record<string, unknown> | undefined;
  if (!err) return typeof raw.message === "string" ? raw.message : null;
  return typeof err.message === "string" ? err.message : null;
}
