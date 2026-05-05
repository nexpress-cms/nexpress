import * as React from "react";
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "./button.js";
import { cn } from "./utils.js";

type SortDirection = "asc" | "desc";

export interface DataTableColumn<TData> {
  key: keyof TData | string;
  header: React.ReactNode;
  cell?: (row: TData) => React.ReactNode;
  sortable?: boolean;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<TData extends Record<string, unknown>> {
  columns: DataTableColumn<TData>[];
  data: TData[];
  pageSize?: number;
  emptyMessage?: string;
  initialSort?: {
    column: DataTableColumn<TData>["key"];
    direction?: SortDirection;
  };
}

function safeStringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Arbitrary objects don't sort meaningfully; push them to the end via "".
  return "";
}

function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  return safeStringify(left).localeCompare(safeStringify(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function resolveCellValue<TData extends Record<string, unknown>>(row: TData, key: DataTableColumn<TData>["key"]) {
  if (typeof key === "string" && key in row) {
    return row[key as keyof TData];
  }

  return undefined;
}

function DataTable<TData extends Record<string, unknown>>({
  columns,
  data,
  pageSize = 10,
  emptyMessage = "No results.",
  initialSort,
}: DataTableProps<TData>) {
  const [page, setPage] = React.useState(0);
  const [sortState, setSortState] = React.useState<
    | {
        column: DataTableColumn<TData>["key"];
        direction: SortDirection;
      }
    | undefined
  >(
    initialSort
      ? {
          column: initialSort.column,
          direction: initialSort.direction ?? "asc",
        }
      : undefined,
  );

  const sortedData = React.useMemo(() => {
    if (!sortState) {
      return data;
    }

    const next = [...data];
    next.sort((left, right) => {
      const result = compareValues(
        resolveCellValue(left, sortState.column),
        resolveCellValue(right, sortState.column),
      );

      return sortState.direction === "asc" ? result : -result;
    });

    return next;
  }, [data, sortState]);

  const pageCount = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);

  React.useEffect(() => {
    if (page !== currentPage) {
      setPage(currentPage);
    }
  }, [currentPage, page]);

  const paginatedData = React.useMemo(() => {
    const start = currentPage * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [currentPage, pageSize, sortedData]);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-neutral-200/80 bg-white dark:border-neutral-800/80 dark:bg-neutral-950">
        <div className="overflow-x-auto">
          <table className="w-full caption-bottom text-[13px]">
            <thead className="border-b border-neutral-200/70 bg-neutral-50/60 dark:border-neutral-800/70 dark:bg-neutral-900/40">
              <tr>
                {columns.map((column) => {
                  const isSorted = sortState?.column === column.key;

                  return (
                    <th
                      key={String(column.key)}
                      className={cn(
                        "h-9 px-3.5 text-left align-middle text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400",
                        column.headerClassName,
                      )}
                    >
                      {column.sortable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-3 h-8 text-neutral-700 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-neutral-50"
                          onClick={() => {
                            setSortState((current) => {
                              if (current?.column !== column.key) {
                                return { column: column.key, direction: "asc" };
                              }

                              return {
                                column: column.key,
                                direction: current.direction === "asc" ? "desc" : "asc",
                              };
                            });
                            setPage(0);
                          }}
                        >
                          {column.header}
                          <ArrowUpDown
                            className={cn("size-4", isSorted && "text-neutral-950 dark:text-neutral-50")}
                          />
                        </Button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {paginatedData.length > 0 ? (
                paginatedData.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="border-b border-neutral-100 transition-colors last:border-b-0 hover:bg-neutral-50/70 dark:border-neutral-900 dark:hover:bg-neutral-900/40"
                  >
                    {columns.map((column) => (
                      <td
                        key={String(column.key)}
                        className={cn("px-3.5 py-2.5 align-middle text-neutral-700 dark:text-neutral-200", column.cellClassName)}
                      >
                        {column.cell ? column.cell(row) : String(resolveCellValue(row, column.key) ?? "")}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-28 px-4 text-center text-neutral-500 dark:text-neutral-400">
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12.5px] tabular-nums text-neutral-500 dark:text-neutral-400">
          Showing {paginatedData.length === 0 ? 0 : currentPage * pageSize + 1}–
          {Math.min((currentPage + 1) * pageSize, sortedData.length)} of {sortedData.length}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={currentPage === 0}
          >
            <ChevronLeft className="size-3.5" />
            Previous
          </Button>
          <div className="min-w-16 text-center text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
            Page {currentPage + 1} / {pageCount}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            disabled={currentPage >= pageCount - 1}
          >
            Next
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export { DataTable };
