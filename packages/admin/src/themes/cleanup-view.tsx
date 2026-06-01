"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { PageHeader } from "../layout/page-header.js";

/**
 * v0.3 (C) — admin "cleanup unknown blocks" workflow.
 *
 * After a `theme:uninstall`, theme switch, or plugin removal,
 * existing pages may carry block instances whose `type` no
 * longer maps to any registered renderer. The render layer
 * already shows these as red "unknown block" placeholders
 * (correctness preserved); this surface is the convenience
 * tool for clearing them in bulk.
 *
 * Lists unknown types with instance + doc counts. Operator can:
 *
 *   - "Remove all" — strip every unknown instance across the site.
 *   - Per-row "Remove" — strip only that type.
 *
 * Each cleanup run goes through the standard `saveDocument`
 * pipeline so revisions track the change and media-ref /
 * search-vector hooks fire correctly. Operators can revert
 * via the per-doc revision history if a removal was a mistake.
 */

interface UnknownTypeRow {
  type: string;
  instanceCount: number;
  docCount: number;
}

interface AffectedDoc {
  collection: string;
  docId: string;
  fieldName: string;
  removableTypes: string[];
  removedCount: number;
}

interface ScanReport {
  unknownTypes: UnknownTypeRow[];
  affected: AffectedDoc[];
  totalInstances: number;
  totalDocs: number;
}

export function ThemeCleanupView() {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [loading, setLoading] = useState(true);
  // The literal "__all__" is a sentinel for the bulk button (vs.
  // a per-row block type). It collapses into the `string` portion
  // of the union as far as TypeScript is concerned — left here as
  // a code-level marker, the runtime check is `=== "__all__"`.
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/blocks/unknown");
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to scan for unknown blocks."));
        setReport(null);
        return;
      }
      setReport(parseScanReport(payload));
    } catch {
      setError("Unable to scan for unknown blocks.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function cleanup(types: string[] | null) {
    const label = types === null ? "__all__" : types.join(",");
    setBusyType(label);
    setMessage(null);
    setError(null);
    try {
      const response = await npFetch("/api/admin/blocks/unknown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(types === null ? {} : { types }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setError(getErrorMessage(payload, "Cleanup failed."));
        return;
      }
      const removed =
        isRecord(payload) && typeof payload.removedInstances === "number"
          ? payload.removedInstances
          : 0;
      const docs =
        isRecord(payload) && typeof payload.updatedDocs === "number" ? payload.updatedDocs : 0;
      setMessage(
        `Removed ${removed} block instance${removed === 1 ? "" : "s"} from ${docs} doc${docs === 1 ? "" : "s"}.`,
      );
      await refresh();
    } catch {
      setError("Cleanup failed.");
    } finally {
      setBusyType(null);
    }
  }

  const affectedByType = useMemo(() => {
    if (!report) return new Map<string, AffectedDoc[]>();
    const out = new Map<string, AffectedDoc[]>();
    for (const doc of report.affected) {
      for (const t of doc.removableTypes) {
        const list = out.get(t) ?? [];
        list.push(doc);
        out.set(t, list);
      }
    }
    return out;
  }, [report]);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Cleanup unused blocks"
        description="Block instances whose type is no longer registered (after a theme uninstall, theme switch, or plugin removal). The render layer shows these as placeholder cards; this tool removes them in bulk."
        className="min-w-0"
      />

      {error ? (
        <div className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="break-words rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300">
          {message}
        </div>
      ) : null}

      <Card className="min-w-0">
        <CardHeader className="grid gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="break-words">Unknown block instances</CardTitle>
            <p className="break-words text-sm text-muted-foreground">
              {loading
                ? "Scanning collections…"
                : report && report.totalInstances > 0
                  ? `${report.totalInstances} instance${report.totalInstances === 1 ? "" : "s"} across ${report.totalDocs} doc${report.totalDocs === 1 ? "" : "s"}.`
                  : "Nothing to clean up."}
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:items-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-10 w-full sm:min-h-0 sm:w-auto"
              onClick={() => void refresh()}
              disabled={loading || busyType !== null}
            >
              Re-scan
            </Button>
            {report && report.totalInstances > 0 ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="min-h-10 w-full sm:min-h-0 sm:w-auto"
                onClick={() => void cleanup(null)}
                disabled={loading || busyType !== null}
              >
                {busyType === "__all__" ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-4 w-4" />
                )}
                Remove all
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-lg border border-border/60 bg-muted/40"
                />
              ))}
            </div>
          ) : !report || report.unknownTypes.length === 0 ? (
            <p className="break-words rounded-lg border border-dashed border-border/60 px-6 py-12 text-center text-sm text-muted-foreground">
              All block instances reference registered block types. ✓
            </p>
          ) : (
            <ul className="space-y-2">
              {report.unknownTypes.map((row) => {
                const affected = affectedByType.get(row.type) ?? [];
                const busy = busyType === row.type;
                return (
                  <li
                    key={row.type}
                    className="min-w-0 rounded-lg border border-border/60 bg-background/70 p-3"
                  >
                    <div className="grid min-w-0 gap-3 sm:flex sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                          <code className="min-w-0 break-all font-mono text-sm">{row.type}</code>
                        </div>
                        <p className="break-words text-xs text-muted-foreground">
                          {row.instanceCount} instance
                          {row.instanceCount === 1 ? "" : "s"} in {row.docCount} doc
                          {row.docCount === 1 ? "" : "s"}.
                        </p>
                        {affected.length > 0 ? (
                          <details className="min-w-0 text-xs text-muted-foreground">
                            <summary className="inline-flex min-h-10 cursor-pointer items-center hover:text-foreground sm:min-h-0">
                              Show docs
                            </summary>
                            <ul className="mt-1 min-w-0 space-y-0.5 pl-4">
                              {affected.slice(0, 8).map((d) => (
                                <li
                                  key={`${d.collection}-${d.docId}-${d.fieldName}`}
                                  className="break-words"
                                >
                                  <code className="break-all font-mono">{d.collection}</code> /{" "}
                                  <code className="break-all font-mono text-[10px]">
                                    {d.docId.slice(0, 8)}
                                  </code>{" "}
                                  · field <code className="break-all font-mono">{d.fieldName}</code>
                                </li>
                              ))}
                              {affected.length > 8 ? (
                                <li className="italic">…and {affected.length - 8} more</li>
                              ) : null}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-10 w-full sm:min-h-0 sm:w-auto"
                        onClick={() => void cleanup([row.type])}
                        disabled={loading || busyType !== null}
                      >
                        {busy ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function parseScanReport(payload: unknown): ScanReport {
  const empty: ScanReport = {
    unknownTypes: [],
    affected: [],
    totalInstances: 0,
    totalDocs: 0,
  };
  if (!isRecord(payload)) return empty;
  const unknownTypes = Array.isArray(payload.unknownTypes)
    ? payload.unknownTypes
        .map((row): UnknownTypeRow | null => {
          if (!isRecord(row)) return null;
          if (
            typeof row.type !== "string" ||
            typeof row.instanceCount !== "number" ||
            typeof row.docCount !== "number"
          )
            return null;
          return {
            type: row.type,
            instanceCount: row.instanceCount,
            docCount: row.docCount,
          };
        })
        .filter((r): r is UnknownTypeRow => r !== null)
    : [];
  const affected = Array.isArray(payload.affected)
    ? payload.affected
        .map((row): AffectedDoc | null => {
          if (!isRecord(row)) return null;
          if (
            typeof row.collection !== "string" ||
            typeof row.docId !== "string" ||
            typeof row.fieldName !== "string" ||
            !Array.isArray(row.removableTypes) ||
            typeof row.removedCount !== "number"
          )
            return null;
          return {
            collection: row.collection,
            docId: row.docId,
            fieldName: row.fieldName,
            removableTypes: row.removableTypes.filter((t): t is string => typeof t === "string"),
            removedCount: row.removedCount,
          };
        })
        .filter((d): d is AffectedDoc => d !== null)
    : [];
  return {
    unknownTypes,
    affected,
    totalInstances: typeof payload.totalInstances === "number" ? payload.totalInstances : 0,
    totalDocs: typeof payload.totalDocs === "number" ? payload.totalDocs : 0,
  };
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") return payload.error;
    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
