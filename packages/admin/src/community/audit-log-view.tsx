"use client";

import { useCallback, useEffect, useState } from "react";

import { nxFetch } from "../lib/api-client.js";
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

      const res = await nxFetch(`/api/admin/audit?${params.toString()}`);
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        const err = raw && typeof raw.error === "object" && raw.error
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            Audit log
            <Badge variant="secondary">{totalDocs}</Badge>
          </span>
        }
        description="Append-only record of every moderation action — comment hide / restore / delete, member ban / unban, report file / resolve. Filter by target or actor when investigating an incident."
      />

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
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
            <div className="md:col-span-2 lg:col-span-4 flex gap-2">
              <Button type="submit">Apply</Button>
              <Button
                type="button"
                variant="outline"
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

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Events</CardTitle>
          {totalPages > 1 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <span>
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
        <CardContent>
          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium">Payload</th>
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
                      <td className="px-4 py-3 font-mono text-xs">{event.action}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTOR_BADGE[event.actorKind]}`}
                        >
                          {event.actorKind}
                        </span>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          {event.actorUserId ?? event.actorMemberId ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{event.targetType ?? "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
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
