"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { NxCollectionConfig, NxFieldConfig } from "@nexpress/core";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";

import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { cn } from "../ui/utils.js";

interface CollectionListViewProps {
  config: NxCollectionConfig;
  docs: Record<string, unknown>[];
  totalDocs: number;
  totalPages: number;
  currentPage: number;
}

const getNamedFields = (fields: NxFieldConfig[]): Array<Extract<NxFieldConfig, { name: string }>> => {
  const result: Array<Extract<NxFieldConfig, { name: string }>> = [];

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

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  if (Array.isArray(value)) {
    const preview = value
      .map((item) => (typeof item === "object" && item !== null ? formatCellValue(item) : String(item)))
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");

    return preview || `${value.length} items`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = record.title ?? record.name ?? record.label ?? record.filename ?? record.id;

    return preferred ? formatCellValue(preferred) : "Object";
  }

  return String(value);
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

  useEffect(() => {
    setSearchValue(searchParams.get("search") ?? "");
  }, [searchParams]);

  useEffect(() => {
    const timeout = globalThis.setTimeout(() => {
      const query = createQueryString(new URLSearchParams(searchParams.toString()), {
        search: searchValue || null,
        page: searchValue !== searchParams.get("search") ? "1" : searchParams.get("page"),
      });

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{config.labels.plural}</h1>
            <Badge variant="secondary">{totalDocs}</Badge>
          </div>
          {config.admin?.description ? <p className="text-sm text-muted-foreground">{config.admin.description}</p> : null}
        </div>

        <Button asChild>
          <Link href={`/admin/collections/${config.slug}/create`}>
            <Plus className="mr-2 h-4 w-4" />
            Create
          </Link>
        </Button>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-lg">All entries</CardTitle>
          <div className="relative w-full md:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={(event: { target: { value: string } }) => setSearchValue(event.target.value)}
              placeholder={`Search ${config.labels.plural.toLowerCase()}...`}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border/60">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
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
                      <td colSpan={Math.max(columns.length, 1)} className="px-4 py-10 text-center text-muted-foreground">
                        No documents found.
                      </td>
                    </tr>
                  ) : (
                    docs.map((doc, index) => {
                      const href = `/admin/collections/${config.slug}/${String(doc.id ?? "")}`;

                      return (
                        <tr
                          key={String(doc.id ?? index)}
                          className={cn(
                            "border-t border-border/60 transition-colors hover:bg-muted/30",
                            "cursor-pointer",
                          )}
                          onClick={() => {
                            if (doc.id !== undefined && doc.id !== null) {
                              router.push(href);
                            }
                          }}
                        >
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
                                  <span
                                    className={
                                      rawValue === "published"
                                        ? "inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800"
                                        : rawValue === "draft"
                                          ? "inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
                                          : "inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                                    }
                                  >
                                    {rawValue}
                                  </span>
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

          <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Page {currentPage} of {Math.max(totalPages, 1)}
            </p>

            <div className="flex items-center gap-2">
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
                <ChevronLeft className="mr-2 h-4 w-4" />
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
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
