"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { NpCollectionConfig, NpFieldConfig } from "@nexpress/core";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "../ui/badge.js";
import { StatusBadge } from "../ui/status-badge.js";
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
import { Input } from "../ui/input.js";
import { npFetch } from "../lib/api-client.js";
import { cn } from "../ui/utils.js";
import { PageHeader } from "../layout/page-header.js";

interface CollectionListViewProps {
  config: NpCollectionConfig;
  // Same id-narrowing rationale as collection-edit-view: pipeline emits
  // string ids; typing it here lets the row keys / link hrefs interpolate
  // without no-base-to-string lint errors.
  docs: (Record<string, unknown> & { id?: string })[];
  totalDocs: number;
  totalPages: number;
  currentPage: number;
}

const getNamedFields = (fields: NpFieldConfig[]): Array<Extract<NpFieldConfig, { name: string }>> => {
  const result: Array<Extract<NpFieldConfig, { name: string }>> = [];

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      result.push(...getNamedFields(field.fields));
      continue;
    }

    result.push(field);
  }

  return result;
};

const formatCellValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (value instanceof Date) {
    return value.toLocaleString("en-US");
  }

  if (Array.isArray(value)) {
    const preview = value
      .map((item) => formatCellValue(item))
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");

    return preview || `${value.length} items`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = record.title ?? record.name ?? record.label ?? record.filename ?? record.id;

    return preferred !== undefined && preferred !== null ? formatCellValue(preferred) : "Object";
  }

  // symbol, function, or any other oddity — render a placeholder rather
  // than risk `String(symbol)` throwing.
  return "—";
};

const createQueryString = (
  searchParams: URLSearchParams,
  updates: Record<string, string | null>,
): string => {
  const params = new URLSearchParams(searchParams.toString());

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") {
      params.delete(key);
      continue;
    }

    params.set(key, value);
  }

  return params.toString();
};

export function CollectionListView({
  config,
  docs,
  totalDocs,
  totalPages,
  currentPage,
}: CollectionListViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("search") ?? "");

  // First-time UX: distinguish "no docs because the operator hasn't
  // created any yet" from "no docs match the current search / filter".
  // The latter keeps the table-with-search shell (so they can clear
  // the filter); the former replaces the page body with a focused
  // "create your first <singular>" card. URL params that should not
  // count as "filtered" (`page`, `sort`) are excluded — being on
  // page 2 of an empty collection isn't an active filter, just an
  // unusual landing page.
  const hasActiveFilters = useMemo(() => {
    const search = searchParams.get("search");
    if (search && search.trim() !== "") return true;
    const status = searchParams.get("status");
    if (status && status !== "all") return true;
    return false;
  }, [searchParams]);
  const isPristineEmpty = totalDocs === 0 && !hasActiveFilters;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<null | "publish" | "unpublish" | "delete">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkToast, setBulkToast] = useState<
    | { type: "success" | "error"; message: string }
    | null
  >(null);

  // Reset selection whenever the underlying page changes — stale ids from a
  // prior page would silently target docs the user can't see anymore.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [docs]);

  useEffect(() => {
    setSearchValue(searchParams.get("search") ?? "");
  }, [searchParams]);

  useEffect(() => {
    // Sync the local search box back to the URL — but ONLY when it
    // actually differs from what the URL currently carries. The
    // earlier version fired on every mount (and on every other
    // searchParams change) and called `router.replace(samePathname)`
    // even when there was nothing to sync. That triggers an RSC
    // refetch for the SAME page, and any click on the Create link
    // landing inside the 250 ms debounce window OR the in-flight
    // replace gets swallowed by the racing transition. Operators
    // saw this as "Create button does nothing the first time."
    const currentSearch = searchParams.get("search") ?? "";
    if (currentSearch === searchValue) return;

    const timeout = globalThis.setTimeout(() => {
      // Search changed → always reset to page 1; the prior page
      // index is meaningless against a different result set.
      const query = createQueryString(
        new URLSearchParams(searchParams.toString()),
        { search: searchValue || null, page: "1" },
      );
      const nextUrl = query ? `${pathname}?${query}` : pathname;
      router.replace(nextUrl);
    }, 250);

    return () => globalThis.clearTimeout(timeout);
  }, [pathname, router, searchParams, searchValue]);

  const columns = useMemo(() => {
    const configured = config.admin?.listColumns;
    if (configured && configured.length > 0) {
      return configured;
    }

    return getNamedFields(config.fields)
      .slice(0, 4)
      .map((field) => field.name);
  }, [config.admin?.listColumns, config.fields]);

  const docIds = useMemo(
    () =>
      docs
        .map((doc) => (doc.id !== undefined && doc.id !== null ? String(doc.id) : null))
        .filter((id): id is string => id !== null),
    [docs],
  );
  const allSelected = docIds.length > 0 && selectedIds.size === docIds.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    setSelectedIds((current) => {
      if (current.size === docIds.length) return new Set();
      return new Set(docIds);
    });
  }, [docIds]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runBulk = useCallback(
    async (action: "publish" | "unpublish" | "delete") => {
      if (selectedIds.size === 0) return;
      setBulkBusy(action);
      setBulkToast(null);
      try {
        const response = await npFetch(`/api/collections/${config.slug}/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ids: [...selectedIds] }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(payload?.error?.message ?? `Bulk ${action} failed`);
        }
        const payload = (await response.json()) as {
          succeeded: string[];
          failed: Array<{ id: string; error: string }>;
        };
        const okCount = payload.succeeded.length;
        const failCount = payload.failed.length;
        setBulkToast({
          type: failCount === 0 ? "success" : "error",
          message:
            failCount === 0
              ? `${action === "delete" ? "Deleted" : action === "publish" ? "Published" : "Unpublished"} ${okCount} item${okCount === 1 ? "" : "s"}.`
              : `${okCount} ${action}d, ${failCount} failed.`,
        });
        setSelectedIds(new Set());
        setConfirmDelete(false);
        router.refresh();
      } catch (error) {
        setBulkToast({
          type: "error",
          message: error instanceof Error ? error.message : `Bulk ${action} failed`,
        });
      } finally {
        setBulkBusy(null);
      }
    },
    [config.slug, router, selectedIds],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            {config.labels.plural}
            <Badge variant="secondary">{totalDocs}</Badge>
          </span>
        }
        description={config.admin?.description}
        actions={
          <Button asChild>
            <Link href={`/admin/collections/${config.slug}/create`}>
              <Plus />
              Create
            </Link>
          </Button>
        }
      />

      {isPristineEmpty ? (
        <Card className="border-[var(--np-color-brand)]/30 bg-[var(--np-color-brand)]/5">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="rounded-full bg-[var(--np-color-brand)]/10 p-3 text-[var(--np-color-brand)]">
              <Sparkles className="size-5" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-neutral-950 dark:text-neutral-50">
                Create your first {config.labels.singular.toLowerCase()}
              </h2>
              <p className="max-w-md text-[13px] text-neutral-500 dark:text-neutral-400">
                {config.admin?.description ??
                  `No ${config.labels.plural.toLowerCase()} yet — add one to see it here.`}
              </p>
            </div>
            <Button asChild>
              <Link href={`/admin/collections/${config.slug}/create`}>
                <Plus />
                New {config.labels.singular.toLowerCase()}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle>All entries</CardTitle>
          <div className="relative w-full md:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
            <Input
              value={searchValue}
              onChange={(event: { target: { value: string } }) => setSearchValue(event.target.value)}
              placeholder={`Search ${config.labels.plural.toLowerCase()}...`}
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {bulkToast ? (
            <div
              className={
                bulkToast.type === "success"
                  ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200"
                  : "rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200"
              }
            >
              {bulkToast.message}
            </div>
          ) : null}

          {selectedIds.size > 0 ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium">
                {selectedIds.size} selected
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runBulk("publish")}
                  disabled={bulkBusy !== null}
                >
                  {bulkBusy === "publish" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Publish
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runBulk("unpublish")}
                  disabled={bulkBusy !== null}
                >
                  {bulkBusy === "unpublish" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CircleX className="size-3.5" />
                  )}
                  Unpublish
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-rose-600 dark:text-rose-300"
                  onClick={() => setConfirmDelete(true)}
                  disabled={bulkBusy !== null}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                  disabled={bulkBusy !== null}
                >
                  Clear
                </Button>
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-border/60">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someSelected;
                        }}
                        onChange={toggleAll}
                        disabled={docIds.length === 0}
                      />
                    </th>
                    {columns.map((column) => (
                      <th key={column} className="px-4 py-3 font-medium capitalize">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {docs.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-muted-foreground">
                        No documents found.
                      </td>
                    </tr>
                  ) : (
                    docs.map((doc, index) => {
                      const href = `/admin/collections/${config.slug}/${String(doc.id ?? "")}`;
                      const docIdStr = doc.id !== undefined && doc.id !== null ? String(doc.id) : null;
                      const isSelected = docIdStr ? selectedIds.has(docIdStr) : false;

                      return (
                        <tr
                          key={String(doc.id ?? index)}
                          className={cn(
                            "border-t border-border/60 transition-colors hover:bg-muted/30",
                            isSelected && "bg-muted/40",
                            "cursor-pointer",
                          )}
                          onClick={(event) => {
                            // Don't trigger navigation when the user clicks the
                            // checkbox cell or anything inside it.
                            const target = event.target as HTMLElement;
                            if (target.closest('[data-row-checkbox="1"]')) return;
                            if (doc.id !== undefined && doc.id !== null) {
                              router.push(href);
                            }
                          }}
                        >
                          <td
                            data-row-checkbox="1"
                            className="w-10 px-4 py-3 align-middle"
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select row ${docIdStr ?? index}`}
                              checked={isSelected}
                              onChange={() => {
                                if (docIdStr) toggleOne(docIdStr);
                              }}
                              disabled={!docIdStr}
                            />
                          </td>
                          {columns.map((column) => {
                            const rawValue = doc[column];
                            const isFirst = column === columns[0];
                            const isStatus = column === "status" && typeof rawValue === "string";
                            return (
                              <td key={column} className="px-4 py-3 align-middle">
                                {isFirst && doc.id !== undefined && doc.id !== null ? (
                                  <Link href={href} className="block font-medium text-foreground underline-offset-4 hover:underline">
                                    {formatCellValue(rawValue)}
                                  </Link>
                                ) : isStatus ? (
                                  <StatusBadge status={rawValue} />
                                ) : (
                                  <span className="text-muted-foreground">{formatCellValue(rawValue)}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-neutral-100 pt-3.5 dark:border-neutral-900 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12.5px] tabular-nums text-neutral-500 dark:text-neutral-400">
              Page {currentPage} of {Math.max(totalPages, 1)}
            </p>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => {
                  const query = createQueryString(new URLSearchParams(searchParams.toString()), {
                    page: String(Math.max(currentPage - 1, 1)),
                  });

                  router.push(query ? `${pathname}?${query}` : pathname);
                }}
              >
                <ChevronLeft className="size-3.5" />
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => {
                  const query = createQueryString(new URLSearchParams(searchParams.toString()), {
                    page: String(Math.min(currentPage + 1, totalPages || currentPage + 1)),
                  });

                  router.push(query ? `${pathname}?${query}` : pathname);
                }}
              >
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} {config.labels.singular.toLowerCase()}{selectedIds.size === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              This permanently removes the selected entries. Hooks fire and any
              media references release.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={bulkBusy !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-rose-600 dark:text-rose-300"
              onClick={() => void runBulk("delete")}
              disabled={bulkBusy !== null}
            >
              {bulkBusy === "delete" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Delete {selectedIds.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
