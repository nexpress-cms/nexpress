"use client";

import { useCallback, useEffect, useState } from "react";

import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { PageHeader } from "../layout/page-header.js";

export interface AuditEventRow {
  id: string;
  actorKind: "staff" | "member" | "system";
  actorUserId: string | null;
  actorMemberId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

const ACTOR_BADGE: Record<AuditEventRow["actorKind"], string> = {
  staff: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  member: "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  system: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

const PAGE_SIZE = 50;

/**
 * Append-only audit log viewer. Filters by target / actor are exposed
 * because the typical investigation starts from "what happened to this
 * comment?" or "what has this mod done lately?".
 */
export function AuditLogView() {
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    targetType: "",
    targetId: "",
    actorUserId: "",
    actorMemberId: "",
    action: "",
    since: "",
    until: "",
  });
  const [pendingFilters, setPendingFilters] = useState(filters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(page),
      });
      if (filters.targetType) params.set("targetType", filters.targetType);
      if (filters.targetId) params.set("targetId", filters.targetId);
      if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
      if (filters.actorMemberId) params.set("actorMemberId", filters.actorMemberId);
      if (filters.action) params.set("action", filters.action);
      if (filters.since) {
        // datetime-local inputs return "YYYY-MM-DDTHH:mm" without
        // tz; coerce to ISO so the server's `new Date()` is
        // unambiguous.
        params.set("since", new Date(filters.since).toISOString());
      }
      if (filters.until) {
        params.set("until", new Date(filters.until).toISOString());
      }

      const res = await npFetch(`/api/admin/audit?${params.toString()}`);
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        const err =
          raw && typeof raw.error === "object" && raw.error
            ? (raw.error as { message?: unknown }).message
            : null;
        throw new Error(typeof err === "string" ? err : `HTTP ${res.status}`);
      }
      const docs = Array.isArray(raw.docs) ? (raw.docs as AuditEventRow[]) : [];
      setEvents(docs);
      setTotalDocs(typeof raw.totalDocs === "number" ? raw.totalDocs : docs.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / PAGE_SIZE);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="min-w-0">Audit log</span>
            <Badge variant="secondary">{totalDocs}</Badge>
          </span>
        }
        description="Append-only record of every moderation action — comment hide / restore / delete, member ban / unban, report file / resolve. Filter by target or actor when investigating an incident."
      />

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <form
            className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setFilters(pendingFilters);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="filter-targetType">Target type</Label>
              <Input
                id="filter-targetType"
                value={pendingFilters.targetType}
                onChange={(event) =>
                  setPendingFilters((prev) => ({ ...prev, targetType: event.target.value }))
                }
                placeholder="comment / member / …"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-targetId">Target id</Label>
              <Input
                id="filter-targetId"
                value={pendingFilters.targetId}
                onChange={(event) =>
                  setPendingFilters((prev) => ({ ...prev, targetId: event.target.value }))
                }
                placeholder="uuid"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-actorUserId">Actor user id (staff)</Label>
              <Input
                id="filter-actorUserId"
                value={pendingFilters.actorUserId}
                onChange={(event) =>
                  setPendingFilters((prev) => ({ ...prev, actorUserId: event.target.value }))
                }
                placeholder="uuid"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-actorMemberId">Actor member id</Label>
              <Input
                id="filter-actorMemberId"
                value={pendingFilters.actorMemberId}
                onChange={(event) =>
                  setPendingFilters((prev) => ({ ...prev, actorMemberId: event.target.value }))
                }
                placeholder="uuid"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-action">Action</Label>
              <Input
                id="filter-action"
                value={pendingFilters.action}
                onChange={(event) =>
                  setPendingFilters((prev) => ({ ...prev, action: event.target.value }))
                }
                placeholder="member.ban.issue / comment.hide / …"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-since">Since</Label>
              <Input
                id="filter-since"
                type="datetime-local"
                value={pendingFilters.since}
                onChange={(event) =>
                  setPendingFilters((prev) => ({ ...prev, since: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-until">Until</Label>
              <Input
                id="filter-until"
                type="datetime-local"
                value={pendingFilters.until}
                onChange={(event) =>
                  setPendingFilters((prev) => ({ ...prev, until: event.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2 md:col-span-2 sm:flex sm:flex-wrap lg:col-span-4">
              <Button type="submit" className="flex-1 sm:flex-none">
                Apply
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => {
                  const empty = {
                    targetType: "",
                    targetId: "",
                    actorUserId: "",
                    actorMemberId: "",
                    action: "",
                    since: "",
                    until: "",
                  };
                  setPendingFilters(empty);
                  setFilters(empty);
                  setPage(1);
                }}
              >
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Events</CardTitle>
          {totalPages > 1 ? (
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:flex">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <span className="min-w-16 text-center text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
                Page {page} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
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
            ) : events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                No audit events match these filters.
              </div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-xs font-medium">{event.action}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTOR_BADGE[event.actorKind]}`}
                    >
                      {event.actorKind}
                    </span>
                  </div>
                  <dl className="grid gap-2 text-sm">
                    <div className="grid gap-0.5">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Actor
                      </dt>
                      <dd className="break-all font-mono text-xs text-muted-foreground">
                        {event.actorUserId ?? event.actorMemberId ?? "—"}
                      </dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Target
                      </dt>
                      <dd>
                        <span>{event.targetType ?? "—"}</span>
                        {event.targetId ? (
                          <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">
                            {event.targetId}
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Payload
                    </summary>
                    <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[11px]">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </details>
                </div>
              ))
            )}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-border/60 md:block">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-neutral-50/60 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:bg-neutral-900/40 dark:text-neutral-400">
                <tr>
                  <th className="h-9 px-3.5 font-medium">When</th>
                  <th className="h-9 px-3.5 font-medium">Action</th>
                  <th className="h-9 px-3.5 font-medium">Actor</th>
                  <th className="h-9 px-3.5 font-medium">Target</th>
                  <th className="h-9 px-3.5 font-medium">Payload</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      No audit events match these filters.
                    </td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <tr key={event.id} className="border-t border-border/60 align-top">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {new Date(event.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 break-all font-mono text-xs">{event.action}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTOR_BADGE[event.actorKind]}`}
                        >
                          {event.actorKind}
                        </span>
                        <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                          {event.actorUserId ?? event.actorMemberId ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="break-words">{event.targetType ?? "—"}</div>
                        <div className="break-all font-mono text-xs text-muted-foreground">
                          {event.targetId ?? ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
